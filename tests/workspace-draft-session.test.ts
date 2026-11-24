import { createHash } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"
import { createWorkspaceDraftSession } from "../src/renderer/features/file-viewer/workspace-draft-session"

const target = { projectId: "project", chatId: "chat", relativePath: "file.txt" }
const hash = (content: string) => createHash("sha256").update(content).digest("hex")
type Client = Parameters<typeof createWorkspaceDraftSession>[1]
afterEach(() => vi.useRealTimers())
it("requires the displayed disk digest and explicit save to resolve a conflict", async () => {
  const f = fixture()
  await f.session.open()
  f.session.setContent("my draft")
  f.changeDisk("reviewed version")
  await f.session.refreshDisk()
  expect(f.session.getSnapshot().conflict).toBe(true)
  expect(await f.session.save()).toBe(false)
  expect(await f.session.save("autosave", hash("reviewed version"))).toBe(false)
  expect(await f.session.save("save", hash("older version"))).toBe(false)
  expect(f.client.save).not.toHaveBeenCalled()
  expect(await f.session.save("save", hash("reviewed version"))).toBe(true)
  expect(f.client.save).toHaveBeenCalledWith(
    expect.objectContaining({ reviewedDiskSha256: hash("reviewed version"), intent: "save" }),
  )
  expect(f.session.getSnapshot()).toMatchObject({ conflict: false, content: "my draft" })
})

function fixture() {
  let row = {
    id: "12345678-1234-4234-8234-123456789abc",
    ...target,
    rootIdentity: "root",
    canonicalPath: "/root/file.txt",
    content: "original",
    baseSha256: hash("original"),
    revision: 0,
    updatedAt: 1,
    pendingSave: null as string | null,
  }
  let lease = "",
    disk = "original",
    writes = 0,
    replacements = 0
  const discarded = vi.fn()
  const recorded = new Map<string, Awaited<ReturnType<Client["save"]>>>()
  const update: Client["update"] = async (input) => {
    if (input.leaseToken !== lease) throw new Error("Stale lease")
    if (input.expectedRevision !== row.revision) {
      if (row.revision === input.expectedRevision + 1 && row.content === input.content)
        return { ...row }
      throw new Error("Stale revision")
    }
    row = { ...row, content: input.content, revision: row.revision + 1 }
    return { ...row }
  }
  const save: Client["save"] = async (input) => {
    const old = recorded.get(input.id)
    if (old) return old
    if (input.expectedRevision !== row.revision) throw new Error("Stale revision")
    const beforeSha256 = row.baseSha256
    disk = row.content
    writes++
    row = { ...row, baseSha256: hash(disk), revision: row.revision + 1 }
    const result = {
      ok: true as const,
      draft: { ...row },
      operation: {
        id: input.id,
        relativePath: target.relativePath,
        state: "applied" as const,
        beforeSha256,
        afterSha256: row.baseSha256,
        kind: "save" as const,
        revertsId: null,
        previousRelativePath: null,
        createdAt: 1,
      },
    }
    recorded.set(input.id, result)
    return result
  }
  const client: Client = {
    open: vi.fn(async (input) => {
      if (
        input.recovery &&
        (input.recovery.draftId !== row.id ||
          input.recovery.leaseToken !== lease ||
          (row.content !== input.recovery.content &&
            row.content !== input.recovery.pendingUpdateContent))
      )
        throw new Error("The saved draft changed in another editor")
      lease = crypto.randomUUID()
      return {
        draft: { ...row },
        leaseToken: lease,
        diskSha256: hash(disk),
        conflict: hash(disk) !== row.baseSha256,
        autosaveAllowed: true,
      }
    }),
    update: vi.fn(update),
    save: vi.fn(save),
    release: vi.fn(async () => ({ released: true })),
    replace: vi.fn(async (input) => {
      if (input.draftId !== row.id || input.leaseToken !== lease) throw new Error("Stale lease")
      const replacement = input.replacement
      const content = replacement.kind === "discard" ? disk : replacement.content
      const baseSha256 =
        replacement.kind === "discard" ? replacement.reviewedDiskSha256 : replacement.baseSha256
      if (input.expectedRevision !== row.revision) {
        if (
          row.revision !== input.expectedRevision + 1 ||
          row.baseSha256 !== baseSha256 ||
          (replacement.kind === "discard"
            ? hash(row.content) !== baseSha256
            : row.content !== content)
        )
          throw new Error("Stale revision")
      } else {
        if (replacement.kind === "discard" && hash(disk) !== baseSha256)
          return { ok: false as const, reason: "conflict" as const }
        row = { ...row, content, baseSha256, revision: row.revision + 1 }
        replacements++
      }
      return {
        ok: true as const,
        draft: { ...row },
        disk: { content: disk, sha256: hash(disk), byteLength: Buffer.byteLength(disk) },
      }
    }),
    read: vi.fn(async () => ({
      content: disk,
      sha256: hash(disk),
      byteLength: Buffer.byteLength(disk),
    })),
  }
  return {
    client,
    session: createWorkspaceDraftSession(target, client, undefined, discarded),
    discarded,
    update,
    save,
    getRow: () => row,
    getDisk: () => disk,
    getWrites: () => writes,
    getReplacements: () => replacements,
    changeStoredDraft: (content: string) => {
      row = { ...row, content, revision: row.revision + 1 }
    },
    changeDisk: (content: string) => {
      disk = content
    },
  }
}

it("retries the same interrupted save UUID without losing later typing or writing twice", async () => {
  const f = fixture()
  vi.mocked(f.client.save).mockImplementationOnce(async (input) => {
    await f.save(input)
    throw new Error("Acknowledgement lost")
  })
  await f.session.open()
  f.session.setContent("submitted")
  expect(await f.session.save()).toBe(false)
  expect(f.session.getSnapshot().interruptedSave).toBe(true)
  f.session.setContent("later")
  expect(await f.session.retry()).toBe(true)
  expect(f.getWrites()).toBe(1)
  expect(f.getDisk()).toBe("submitted")
  expect(f.getRow().content).toBe("later")
  expect(f.session.getSnapshot().interruptedSave).toBe(false)
  expect(vi.mocked(f.client.save).mock.calls[1]![0]).toEqual(
    vi.mocked(f.client.save).mock.calls[0]![0],
  )
})
