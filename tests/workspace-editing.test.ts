import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { build } from "esbuild"
import {
  mkdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  WorkspaceEditingService,
  WorkspaceEditConflictError,
} from "../src/main/lib/workspace-editing/service"
import {
  removeFileInsideRoot,
  renameFileInsideRoot,
  writeFileInsideRoot,
} from "../src/main/lib/path-safety"
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}))

let container: string, root: string, sqlite: Database.Database
let service: WorkspaceEditingService
let db: ReturnType<typeof createDb>
const scope = { projectId: "project", chatId: "chat" }
const original = "\uFEFForiginal 雪\r\n"
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const createDb = () => drizzle(sqlite, { schema })
const request = (content = "updated 雪\r\n") => ({
  ...scope,
  id: randomUUID(),
  relativePath: "file.txt",
  expectedSha256: hash(original),
  content,
  intent: "save" as const,
})

let draftWindowId = 1000
const draftOwner = () => {
  const windowId = ++draftWindowId
  return { windowId, isAlive: (id: number) => id === windowId }
}
const draftUpdate = (
  opened: Awaited<ReturnType<WorkspaceEditingService["openDraft"]>>,
  content = "unsaved 雪\r\n",
) => ({
  ...scope,
  draftId: opened.draft.id,
  leaseToken: opened.leaseToken,
  expectedRevision: opened.draft.revision,
  content,
})

const draftSave = (
  opened: Awaited<ReturnType<WorkspaceEditingService["openDraft"]>>,
  revision: number,
) => ({
  ...scope,
  draftId: opened.draft.id,
  leaseToken: opened.leaseToken,
  expectedRevision: revision,
  id: randomUUID(),
  intent: "save" as const,
})

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-workspace-edit-"))
  root = join(container, "repo")
  mkdirSync(root)
  writeFileSync(join(root, "file.txt"), original)
  sqlite = new Database(join(container, "test.db"))
  sqlite.pragma("journal_mode=WAL")
  sqlite.pragma("foreign_keys=ON")
  db = createDb()
  migrate(db, { migrationsFolder: resolve("drizzle") })
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({
      id: "chat",
      projectId: "project",
      worktreePath: root,
      permissionMode: "auto-edit-project-only",
    })
    .run()
  bindFilesystemRootIdentity(root, db)
  service = new WorkspaceEditingService(db)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (sqlite.open) sqlite.close()
  rmSync(container, { recursive: true, force: true })
})

it("keeps recovery reads scoped to the registered chat and original root", async () => {
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, draftOwner())
  db.insert(schema.chats)
    .values({ id: "other-chat", projectId: scope.projectId, worktreePath: root })
    .run()
  expect(service.listDrafts({ ...scope, chatId: "other-chat" })).toEqual([])
  expect(() =>
    service.readDraft({ ...scope, chatId: "other-chat", draftId: opened.draft.id }),
  ).toThrow("scope or root")
  expect(() =>
    service.readDraft({ ...scope, projectId: "other-project", draftId: opened.draft.id }),
  ).toThrow("scope")
  renameSync(root, join(container, "old-root"))
  mkdirSync(root)
  expect(() => service.listDrafts(scope)).toThrow()
  expect(() => service.readDraft({ ...scope, draftId: opened.draft.id })).toThrow()
  expect(db.select().from(schema.workspaceDrafts).get()!.content).toBe(original)
})

it("persists unsaved buffers across database reopen without touching disk", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const saved = await service.updateDraft(draftUpdate(opened), owner)
  expect(saved).toMatchObject({
    content: "unsaved 雪\r\n",
    revision: 1,
    baseSha256: hash(original),
  })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  service.releaseDraft(draftUpdate(opened), owner)
  sqlite.close()
  sqlite = new Database(join(container, "test.db"))
  db = createDb()
  service = new WorkspaceEditingService(db)
  const reopened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  expect(reopened.draft).toMatchObject({ id: opened.draft.id, revision: 1, content: saved.content })
  expect(reopened.conflict).toBe(false)
})

it("replaces only the explicitly reviewed disk version and preserves its undo", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  const external = "external change 雪\r\n"
  writeFileSync(join(root, "file.txt"), external)
  const input = { ...draftSave(opened, buffer.revision), reviewedDiskSha256: hash(external) }
  await expect(service.saveDraft({ ...input, intent: "autosave" }, owner)).rejects.toThrow(
    /explicit Save/,
  )
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(external)
  const saved = await service.saveDraft(input, owner)
  expect(saved.draft.baseSha256).toBe(hash(buffer.content))
  expect(saved.draft.content).toBe(buffer.content)
  expect(saved.draft.pendingSave).toBeNull()
  expect(saved.operation.beforeSha256).toBe(hash(external))
  expect(await service.saveDraft(input, owner)).toEqual(saved)
  await expect(
    service.saveDraft({ ...input, reviewedDiskSha256: hash(original) }, owner),
  ).rejects.toThrow(/reused/)
  await service.revert({ ...scope, id: randomUUID(), operationId: saved.operation.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(external)
})

it("rejects disk changes after review without rebasing or discarding the draft", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  writeFileSync(join(root, "file.txt"), "later change")
  await expect(
    service.saveDraft(
      { ...draftSave(opened, buffer.revision), reviewedDiskSha256: hash("reviewed change") },
      owner,
    ),
  ).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  expect(service.readDraft({ ...scope, draftId: buffer.id })).toMatchObject({
    content: buffer.content,
    baseSha256: buffer.baseSha256,
    revision: buffer.revision,
  })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("later change")
})

it("does not resume a write when a pending save never reached its journal", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  db.update(schema.workspaceDrafts)
    .set({
      pendingSave: JSON.stringify({
        id: randomUUID(),
        revision: buffer.revision,
        intent: "save",
      }),
    })
    .run()
  const reopened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  expect(reopened.draft).toMatchObject({
    content: buffer.content,
    baseSha256: hash(original),
    pendingSave: null,
  })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect(db.select().from(schema.workspaceEdits).all()).toEqual([])
})

it("denies draft persistence after permission revocation or root replacement", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  db.update(schema.chats).set({ permissionMode: "read-only" }).run()
  await expect(service.updateDraft(draftUpdate(opened), owner)).rejects.toThrow(/permit/)
  db.update(schema.chats).set({ permissionMode: "auto-edit-project-only" }).run()
  renameSync(root, `${root}-old`)
  mkdirSync(root)
  writeFileSync(join(root, "file.txt"), original)
  await expect(service.updateDraft(draftUpdate(opened), owner)).rejects.toThrow(/identity|root/i)
  expect(db.select().from(schema.workspaceDrafts).get()?.content).toBe(original)
})

it("saves exact bytes and reverses both save and undo across a database reopen", async () => {
  const input = request()
  const saved = await service.save(input)
  expect(saved.state).toBe("applied")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(input.content)
  sqlite.close()
  sqlite = new Database(join(container, "test.db"))
  db = createDb()
  service = new WorkspaceEditingService(db)
  const undo = await service.revert({ ...scope, id: randomUUID(), operationId: saved.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  await service.revert({ ...scope, id: randomUUID(), operationId: undo.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(input.content)
  const audit = JSON.stringify(
    sqlite.prepare("SELECT input_summary, result_summary FROM mcp_audit_records").all(),
  )
  expect(audit).not.toContain(original)
  expect(audit).not.toContain(input.content)
  expect(await service.history(scope)).toHaveLength(3)
})

it("reverses a zero-byte file's creation and removal across reopen", async () => {
  const content = ""
  const input = { ...scope, id: randomUUID(), relativePath: "created.txt", content }
  const created = await service.saveAs(input)
  expect(created).toMatchObject({ state: "applied", kind: "create" })
  expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(content)
  const undo = { ...scope, id: randomUUID(), operationId: created.id }
  const removed = await service.revert(undo)
  expect(removed).toMatchObject({ state: "applied", kind: "remove" })
  expect(existsSync(join(root, input.relativePath))).toBe(false)
  expect(await service.revert(undo)).toEqual(removed)
  sqlite.close()
  sqlite = new Database(join(container, "test.db"))
  db = createDb()
  service = new WorkspaceEditingService(db)
  await service.revert({ ...scope, id: randomUUID(), operationId: removed.id })
  expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(content)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it("renames exact bytes, replays a lost response and reverses the path across reopen", async () => {
  const input = {
    ...scope,
    id: randomUUID(),
    relativePath: "file.txt",
    expectedSha256: hash(original),
    newName: "renamed 雪.txt",
  }
  const renamed = await service.rename(input)
  expect(renamed).toMatchObject({
    kind: "rename",
    state: "applied",
    previousRelativePath: "file.txt",
  })
  expect(existsSync(join(root, "file.txt"))).toBe(false)
  expect(readFileSync(join(root, input.newName), "utf8")).toBe(original)
  expect(await service.rename(input)).toEqual(renamed)
  sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
  await expect(service.rename(input)).rejects.toThrow("permit")
  sqlite.prepare("UPDATE chats SET permission_mode = 'auto-edit-project-only'").run()
  await expect(service.rename({ ...input, newName: "different.txt" })).rejects.toThrow("reused")
  sqlite.close()
  sqlite = new Database(join(container, "test.db"))
  db = createDb()
  service = new WorkspaceEditingService(db)
  const undo = await service.revert({ ...scope, id: randomUUID(), operationId: renamed.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect(existsSync(join(root, input.newName))).toBe(false)
  await service.revert({ ...scope, id: randomUUID(), operationId: undo.id })
  expect(readFileSync(join(root, input.newName), "utf8")).toBe(original)
})

it("rolls rename back on audit failure but never replaces a recreated source", async () => {
  const input = {
    ...scope,
    id: randomUUID(),
    relativePath: "file.txt",
    expectedSha256: hash(original),
    newName: "renamed.txt",
  }
  sqlite.exec(
    "CREATE TRIGGER reject_edit_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  )
  await expect(service.rename(input)).rejects.toThrow("audit unavailable")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect(existsSync(join(root, input.newName))).toBe(false)
  sqlite.exec("DROP TRIGGER reject_edit_audit")
  expect((await service.rename(input)).state).toBe("failed")
  service = new WorkspaceEditingService(
    db,
    writeFileInsideRoot,
    removeFileInsideRoot,
    async (root, path, name, options) => {
      const result = await renameFileInsideRoot(root, path, name, options)
      writeFileSync(join(root, path), "external")
      return result
    },
  )
  await expect(service.rename({ ...input, id: randomUUID() })).rejects.toThrow()
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("external")
  expect(readFileSync(join(root, input.newName), "utf8")).toBe(original)
})

it("never overwrites an existing save-as target or externally changed created file", async () => {
  const input = { ...scope, id: randomUUID(), relativePath: "file.txt", content: "draft" }
  await expect(service.saveAs(input)).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  const created = await service.saveAs({ ...input, relativePath: "new.txt" })
  writeFileSync(join(root, "new.txt"), "external")
  await expect(
    service.revert({ ...scope, id: randomUUID(), operationId: created.id }),
  ).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("external")
  expect(await service.saveAs({ ...input, relativePath: "new.txt" })).toEqual(created)
  await expect(service.saveAs({ ...input, relativePath: "different.txt" })).rejects.toThrow(
    "reused",
  )
})

it("serializes competing editor saves and refuses the stale draft", async () => {
  const results = await Promise.allSettled([
    service.save(request("first")),
    new WorkspaceEditingService(db).save(request("second")),
  ])
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  const failed = results.find((result) => result.status === "rejected")
  expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(WorkspaceEditConflictError)
  expect(await service.history(scope)).toHaveLength(1)
})

it("rolls the file back when audit persistence fails and reconciles the failed request on retry", async () => {
  const input = request()
  sqlite.exec(
    "CREATE TRIGGER reject_edit_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  )
  await expect(service.save(input)).rejects.toThrow("audit unavailable")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect((await service.history(scope))[0].state).toBe("prepared")
  sqlite.exec("DROP TRIGGER reject_edit_audit")
  expect((await service.save(input)).state).toBe("failed")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it.each(["save", "rename-linked", "draft-ack-reviewed-external"] as const)(
  "recovers an actual child exit after %s commit",
  async (kind) => {
    const reviewedDraft = kind === "draft-ack-reviewed-external"
    if (reviewedDraft) {
      const owner = draftOwner()
      const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
      service.releaseDraft(draftUpdate(opened), owner)
      writeFileSync(join(root, "file.txt"), "reviewed external version")
    }
    const input = {
      ...request(),
      newName: "renamed.txt",
      ...(reviewedDraft ? { reviewedDiskSha256: hash("reviewed external version") } : {}),
    }
    const evidenceRoot = resolve(".local-evidence")
    mkdirSync(evidenceRoot, { recursive: true })
    const buildRoot = mkdtempSync(join(evidenceRoot, "workspace-edit-crash-"))
    try {
      const worker = join(buildRoot, "worker.mjs")
      await build({
        entryPoints: [resolve("tests/fixtures/workspace-edit-crash-worker.ts")],
        outfile: worker,
        bundle: true,
        packages: "external",
        platform: "node",
        format: "esm",
        target: "node22",
      })
      const exited = spawnSync(
        process.execPath,
        [worker, join(container, "test.db"), JSON.stringify(input), kind],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        },
      )
      expect({ status: exited.status, stderr: exited.stderr, error: exited.error }).toMatchObject({
        status: 73,
      })
      sqlite.close()
      sqlite = new Database(join(container, "test.db"))
      db = createDb()
      service = new WorkspaceEditingService(db)
      if (reviewedDraft) {
        expect((await service.history(scope))[0].state).toBe("applied")
        const file = join(root, "file.txt")
        writeFileSync(file, "external after interruption")
        const owner = draftOwner()
        const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
        expect(opened).toMatchObject({
          conflict: true,
          draft: {
            pendingSave: null,
            baseSha256: hash(input.content),
            content: input.content,
            revision: 2,
          },
        })
        const beforeReplay = statSync(file).ino
        const replay = await service.saveDraft(
          {
            ...draftSave(opened, 1),
            id: input.id,
            reviewedDiskSha256: input.reviewedDiskSha256,
          },
          owner,
        )
        expect(replay.operation.state).toBe("applied")
        expect(readFileSync(file, "utf8")).toBe("external after interruption")
        expect(statSync(file).ino).toBe(beforeReplay)
        expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({
          count: 1,
        })
      } else {
        expect((await service.history(scope))[0].state).toBe("prepared")
        if (kind === "rename-linked") {
          expect((await service.rename(input)).state).toBe("conflict")
          expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(original)
          expect(readFileSync(join(root, input.newName), "utf8")).toBe(original)
        } else {
          expect((await service.save(input)).state).toBe("applied")
          expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(input.content)
        }
      }
    } finally {
      rmSync(buildRoot, { recursive: true, force: true })
    }
  },
  20_000,
)

it("enforces chat ownership and permission changes before the filesystem commit", async () => {
  await expect(service.save({ ...request(), projectId: "foreign" })).rejects.toThrow("scope")
  sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
  await expect(service.save(request())).rejects.toThrow("permit")
  sqlite.prepare("UPDATE chats SET permission_mode = 'ask-before-edits'").run()
  await expect(service.save({ ...request(), intent: "autosave" })).rejects.toThrow("explicit Save")
  service = new WorkspaceEditingService(db, async (root, path, source, options) => {
    sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
    return writeFileInsideRoot(root, path, source, options)
  })
  await expect(service.save(request())).rejects.toThrow("permit")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it("never rolls a committed edit into a replacement root after authority drifts", async () => {
  const input = request()
  service = new WorkspaceEditingService(db, (root, path, source, options) =>
    writeFileInsideRoot(root, path, source, {
      ...options,
      afterCommit: async (targetPath) => {
        renameSync(root, join(container, "old-root"))
        mkdirSync(root)
        writeFileSync(join(root, path), "replacement")
        await options?.afterCommit?.(targetPath)
      },
    }),
  )
  await expect(service.save(input)).rejects.toThrow()
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("replacement")
  expect(readFileSync(join(container, "old-root", "file.txt"), "utf8")).toBe(input.content)
  expect(sqlite.prepare("SELECT state FROM workspace_edits WHERE id = ?").get(input.id)).toEqual({
    state: "prepared",
  })
  expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({ count: 0 })
})

it("rejects traversal, symlinked parents and replaced registered roots", async () => {
  const outside = join(container, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "file.txt"), original)
  symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
  await expect(
    service.save({ ...request(), relativePath: "../outside/file.txt" }),
  ).rejects.toThrow()
  await expect(service.save({ ...request(), relativePath: "linked/file.txt" })).rejects.toThrow()
  renameSync(root, join(container, "old-root"))
  mkdirSync(root)
  writeFileSync(join(root, "file.txt"), original)
  await expect(service.save(request())).rejects.toThrow()
  expect(readFileSync(join(outside, "file.txt"), "utf8")).toBe(original)
})
