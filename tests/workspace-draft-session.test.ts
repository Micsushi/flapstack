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

it("retries an interrupted reviewed replacement with the same digest and UUID", async () => {
  const f = fixture()
  await f.session.open()
  f.session.setContent("my draft")
  f.changeDisk("reviewed version")
  await f.session.refreshDisk()
  vi.mocked(f.client.save).mockImplementationOnce(async (input) => {
    await f.save(input)
    throw new Error("Lost acknowledgement")
  })
  expect(await f.session.save("save", hash("reviewed version"))).toBe(false)
  const pending = vi.mocked(f.client.save).mock.calls[0][0]
  expect(await f.session.retry()).toBe(true)
  expect(vi.mocked(f.client.save).mock.calls[1][0]).toEqual(pending)
  expect(f.getWrites()).toBe(1)
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
    writes = 0
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
    open: vi.fn(async () => {
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
    read: vi.fn(async () => ({
      content: disk,
      sha256: hash(disk),
      byteLength: Buffer.byteLength(disk),
    })),
  }
  return {
    client,
    session: createWorkspaceDraftSession(target, client),
    update,
    save,
    getRow: () => row,
    getDisk: () => disk,
    getWrites: () => writes,
    changeDisk: (content: string) => {
      disk = content
    },
  }
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

it("autosaves only new typing after opt-in and a quiet debounce", async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.session.open()
  f.session.setContent("existing recovered draft")
  await f.session.flush()
  expect(f.session.setAutosave(true)).toBe(true)
  await vi.advanceTimersByTimeAsync(5000)
  expect(f.getWrites()).toBe(0)
  f.session.setContent("first new edit")
  await vi.advanceTimersByTimeAsync(500)
  f.session.setContent("latest edit")
  await vi.advanceTimersByTimeAsync(749)
  expect(f.getWrites()).toBe(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.getWrites()).toBe(1)
  expect(f.getDisk()).toBe("latest edit")
  expect(f.client.save).toHaveBeenCalledWith(expect.objectContaining({ intent: "autosave" }))
})

it("cancels pending autosave on disable and close, and never saves on reopening", async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.session.open()
  f.session.setAutosave(true)
  f.session.setContent("kept draft")
  f.session.setAutosave(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.getWrites()).toBe(0)
  f.session.setAutosave(true)
  f.session.setContent("new kept draft")
  await f.session.release()
  await f.session.open()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.getWrites()).toBe(0)
  expect(f.session.getSnapshot()).toMatchObject({ content: "new kept draft", autosave: false })
})

it("fences a queued autosave disabled while buffer persistence is delayed", async () => {
  vi.useFakeTimers()
  const f = fixture(),
    pending = gate()
  await f.session.open()
  f.session.setAutosave(true)
  vi.mocked(f.client.update).mockImplementationOnce(async (input) => {
    await pending.promise
    return f.update(input)
  })
  f.session.setContent("slow buffer")
  await vi.advanceTimersByTimeAsync(750)
  f.session.setAutosave(false)
  pending.release()
  await f.session.flush()
  expect(f.getWrites()).toBe(0)
  expect(f.getRow().content).toBe("slow buffer")
})

it("keeps the shared timer when another pane still owns the editor", async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.session.open()
  f.session.setAutosave(true)
  f.session.setContent("shared edit")
  expect(await f.session.release(() => false)).toBe(false)
  await vi.advanceTimersByTimeAsync(750)
  expect(f.getWrites()).toBe(1)
})

it("does not schedule autosave without capability or while conflicted", async () => {
  vi.useFakeTimers()
  const f = fixture()
  const originalOpen = f.client.open
  f.client.open = async (input) => ({ ...(await originalOpen(input)), autosaveAllowed: false })
  // The session retains the passed client object, not a capability guessed in the renderer.
  await f.session.open()
  expect(f.session.setAutosave(true)).toBe(false)
  f.session.setContent("explicit only")
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.getWrites()).toBe(0)
  expect(await f.session.save()).toBe(true)
  const other = fixture()
  await other.session.open()
  other.session.setAutosave(true)
  other.changeDisk("external")
  await other.session.refreshDisk()
  other.session.setContent("conflicted draft")
  await vi.advanceTimersByTimeAsync(1000)
  expect(other.getWrites()).toBe(0)
})

it("does not repeat uncertain autosaves or allow a timer to duplicate explicit Save", async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.session.open()
  f.session.setAutosave(true)
  f.session.setContent("explicit wins")
  await f.session.save()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.getWrites()).toBe(1)
  vi.mocked(f.client.save).mockRejectedValueOnce(new Error("Permission revoked"))
  f.session.setContent("preserved after denial")
  await vi.advanceTimersByTimeAsync(750)
  f.session.setContent("later retained text")
  await vi.advanceTimersByTimeAsync(5000)
  expect(f.client.save).toHaveBeenCalledTimes(2)
  expect(f.session.getSnapshot().content).toBe("later retained text")
  expect(f.session.needsRetry()).toBe(true)
})

it("coalesces queued typing and persists it without writing the file", async () => {
  const { session, client, getRow, getDisk } = fixture()
  await session.open()
  session.setContent("first")
  session.setContent("newest 雪\r\n")
  await session.flush()
  expect(client.update).toHaveBeenCalledTimes(1)
  expect(getRow().content).toBe("newest 雪\r\n")
  expect(getDisk()).toBe("original")
  expect(session.hasUnpersistedText()).toBe(false)
})

it("never replaces newer typing with an older update acknowledgement", async () => {
  const f = fixture(),
    pending = gate()
  vi.mocked(f.client.update).mockImplementationOnce(async (input) => {
    await pending.promise
    return f.update(input)
  })
  await f.session.open()
  f.session.setContent("submitted")
  await vi.waitFor(() => expect(f.client.update).toHaveBeenCalledOnce())
  f.session.setContent("newer typing")
  pending.release()
  await f.session.flush()
  expect(f.session.getSnapshot().content).toBe("newer typing")
  expect(f.getRow().content).toBe("newer typing")
})

it("queues typing behind file save and uses the acknowledged new revision", async () => {
  const f = fixture(),
    pending = gate()
  vi.mocked(f.client.save).mockImplementationOnce(async (input) => {
    await pending.promise
    return f.save(input)
  })
  await f.session.open()
  f.session.setContent("submitted")
  const saving = f.session.save()
  await vi.waitFor(() => expect(f.client.save).toHaveBeenCalledOnce())
  f.session.setContent("typed during save")
  pending.release()
  expect(await saving).toBe(true)
  expect(await f.session.flush()).toBe(true)
  expect(f.getDisk()).toBe("submitted")
  expect(f.getRow().content).toBe("typed during save")
  expect(f.session.getSnapshot().content).toBe("typed during save")
})

it("replays an interrupted update before persisting later typing", async () => {
  const f = fixture()
  vi.mocked(f.client.update).mockImplementationOnce(async (input) => {
    await f.update(input)
    throw new Error("Acknowledgement lost")
  })
  await f.session.open()
  f.session.setContent("submitted")
  expect(await f.session.flush()).toBe(false)
  f.session.setContent("later")
  expect(await f.session.retry()).toBe(true)
  expect(f.getRow().content).toBe("later")
  expect(f.session.getSnapshot().content).toBe("later")
  expect(vi.mocked(f.client.update).mock.calls[1]![0]).toEqual(
    vi.mocked(f.client.update).mock.calls[0]![0],
  )
})

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

it("keeps conflict text editable and persistent without another file write", async () => {
  const f = fixture()
  vi.mocked(f.client.save).mockResolvedValueOnce({
    ok: false,
    reason: "conflict",
    diskSha256: hash("external"),
  })
  await f.session.open()
  f.session.setContent("mine")
  expect(await f.session.save()).toBe(false)
  f.session.setContent("mine revised")
  await f.session.flush()
  expect(f.getRow().content).toBe("mine revised")
  expect(await f.session.save()).toBe(false)
  expect(f.client.save).toHaveBeenCalledOnce()
  expect(f.session.getSnapshot().conflict).toBe(true)
})

it("refreshes disk evidence without replacing a buffer or writing on reopen", async () => {
  const f = fixture()
  await f.session.open()
  f.session.setContent("mine")
  await f.session.flush()
  f.changeDisk("external")
  await f.session.refreshDisk()
  expect(f.session.getSnapshot()).toMatchObject({
    content: "mine",
    conflict: true,
    disk: { content: "external" },
  })
  f.changeDisk("original")
  await f.session.refreshDisk()
  expect(f.session.getSnapshot().conflict).toBe(true)
  f.changeDisk("external")
  await f.session.release()
  await f.session.open()
  expect(f.session.getSnapshot()).toMatchObject({ content: "mine", conflict: true })
  expect(f.client.save).not.toHaveBeenCalled()
})

it("does not release a pane whose buffer could not be persisted", async () => {
  const f = fixture()
  vi.mocked(f.client.update).mockRejectedValue(new Error("Storage unavailable"))
  await f.session.open()
  f.session.setContent("mine")
  expect(await f.session.release()).toBe(false)
  expect(f.client.release).not.toHaveBeenCalled()
  expect(f.session.hasUnpersistedText()).toBe(true)
  expect(f.session.getSnapshot().content).toBe("mine")
})

it("retains a remounted owner and fences editing during an in-flight release", async () => {
  const f = fixture(),
    pending = gate()
  await f.session.open()
  expect(await f.session.release(() => false)).toBe(false)
  expect(f.client.release).not.toHaveBeenCalled()
  vi.mocked(f.client.release).mockImplementationOnce(async () => {
    await pending.promise
    return { released: true }
  })
  const releasing = f.session.release()
  await vi.waitFor(() => expect(f.client.release).toHaveBeenCalledOnce())
  expect(f.session.setContent("too late")).toBe(false)
  const reopening = f.session.open()
  pending.release()
  await releasing
  expect(await reopening).toBe(true)
  expect(f.client.open).toHaveBeenCalledTimes(2)
  expect(f.session.getSnapshot().content).toBe("original")
})

it("rejects oversized or NUL input while preserving the last valid buffer", async () => {
  const f = fixture()
  await f.session.open()
  expect(f.session.setContent("bad\0text")).toBe(false)
  expect(f.session.setContent("bad\ud800text")).toBe(false)
  expect(f.session.setContent("雪".repeat(800_000))).toBe(false)
  expect(f.session.getSnapshot().content).toBe("original")
  expect(f.client.update).not.toHaveBeenCalled()
  expect(f.session.setContent("valid 😀")).toBe(true)
  await f.session.flush()
  expect(f.getRow().content).toBe("valid 😀")
})

it("reopens safely after a lost release acknowledgement", async () => {
  const f = fixture()
  vi.mocked(f.client.release).mockRejectedValueOnce(new Error("Acknowledgement lost"))
  await f.session.open()
  f.session.setContent("persisted")
  expect(await f.session.release()).toBe(false)
  expect(f.session.getSnapshot().phase).toBe("closed")
  expect(await f.session.open()).toBe(true)
  expect(f.session.getSnapshot().content).toBe("persisted")
  expect(f.session.needsRetry()).toBe(false)
})
