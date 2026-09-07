import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { build } from "esbuild"
import {
  mkdirSync,
  existsSync,
  chmodSync,
  linkSync,
  statSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as appDatabase from "../src/main/lib/db"
import { workspaceEditingRouter } from "../src/main/lib/trpc/routers/workspace-editing"
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
import { disabledCustomPermissions } from "../src/shared/permission-capabilities"

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

it("retries a lost draft-update reply without incrementing or replacing its buffer", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const input = draftUpdate(opened)
  const first = await service.updateDraft(input, owner)
  expect(await service.updateDraft(input, owner)).toEqual(first)
})

it("saves the owned draft through the existing journal and replays old save ids safely", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  const input = draftSave(opened, buffer.revision)
  const saved = await service.saveDraft(input, owner)
  expect(saved).toMatchObject({
    operation: { id: input.id, state: "applied" },
    draft: {
      baseSha256: hash(buffer.content),
      content: buffer.content,
      pendingSave: null,
      revision: 2,
    },
  })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(buffer.content)
  expect(await service.saveDraft(input, owner)).toEqual(saved)
  await expect(service.saveDraft({ ...input, expectedRevision: 2 }, owner)).rejects.toThrow(
    /reused/,
  )
  const edited = await service.updateDraft(
    { ...draftUpdate(opened, "later typing"), expectedRevision: 2 },
    owner,
  )
  const replay = await service.saveDraft(input, owner)
  expect(replay.draft.content).toBe(edited.content)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(buffer.content)
  await service.revert({ ...scope, id: randomUUID(), operationId: input.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it("keeps stale disk bytes and the draft when save conflicts", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  writeFileSync(join(root, "file.txt"), "external")
  await expect(service.saveDraft(draftSave(opened, buffer.revision), owner)).rejects.toBeInstanceOf(
    WorkspaceEditConflictError,
  )
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("external")
  expect(db.select().from(schema.workspaceDrafts).get()).toMatchObject({
    content: buffer.content,
    baseSha256: hash(original),
    pendingSave: null,
  })
})

it("requires explicit file saves in ask-before-edits mode", async () => {
  const owner = draftOwner()
  db.update(schema.chats).set({ permissionMode: "ask-before-edits" }).run()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  await expect(
    service.saveDraft({ ...draftSave(opened, buffer.revision), intent: "autosave" }, owner),
  ).rejects.toThrow(/explicit Save/)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect((await service.saveDraft(draftSave(opened, buffer.revision), owner)).operation.state).toBe(
    "applied",
  )
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

it("preserves the draft when save audit persistence fails", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  const input = draftSave(opened, buffer.revision)
  sqlite.exec(
    "CREATE TRIGGER reject_edit_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  )
  await expect(service.saveDraft(input, owner)).rejects.toThrow("audit unavailable")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect(db.select().from(schema.workspaceDrafts).get()).toMatchObject({
    content: buffer.content,
    baseSha256: hash(original),
    revision: buffer.revision,
    pendingSave: JSON.stringify({ id: input.id, revision: buffer.revision, intent: "save" }),
  })
  sqlite.exec("DROP TRIGGER reject_edit_audit")
  expect((await service.saveDraft(input, owner)).operation.state).toBe("failed")
  expect(db.select().from(schema.workspaceDrafts).get()!.pendingSave).toBeNull()
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it("holds its lease through a save even after its window closes", async () => {
  const ids = [++draftWindowId, ++draftWindowId]
  const alive = new Set(ids)
  const firstOwner = { windowId: ids[0]!, isAlive: (id: number) => alive.has(id) }
  const secondOwner = { ...firstOwner, windowId: ids[1]! }
  const otherRoot = join(container, "other-root")
  mkdirSync(otherRoot)
  linkSync(join(root, "file.txt"), join(otherRoot, "alias.txt"))
  db.insert(schema.chats)
    .values({
      id: "other-chat",
      projectId: scope.projectId,
      worktreePath: otherRoot,
      permissionMode: "auto-edit-project-only",
    })
    .run()
  bindFilesystemRootIdentity(otherRoot, db)
  let entered!: () => void, release!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const resume = new Promise<void>((resolve) => {
    release = resolve
  })
  service = new WorkspaceEditingService(db, async (...args) => {
    entered()
    await resume
    return writeFileInsideRoot(...args)
  })
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, firstOwner)
  const buffer = await service.updateDraft(draftUpdate(opened), firstOwner)
  const saving = service.saveDraft(draftSave(opened, buffer.revision), firstOwner)
  await waiting
  try {
    expect(service.releaseDraft(draftUpdate(opened), firstOwner)).toEqual({ released: false })
    alive.delete(firstOwner.windowId)
    await expect(
      service.openDraft({ ...scope, chatId: "other-chat", relativePath: "alias.txt" }, secondOwner),
    ).rejects.toThrow(/save is in progress/)
  } finally {
    release()
  }
  expect((await saving).operation.state).toBe("applied")
  expect(
    (
      await service.openDraft(
        { ...scope, chatId: "other-chat", relativePath: "alias.txt" },
        secondOwner,
      )
    ).draft.content,
  ).toBe(original)
})

it("does not guess the outcome of an expired pending save", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const buffer = await service.updateDraft(draftUpdate(opened), owner)
  const input = draftSave(opened, buffer.revision)
  await service.saveDraft(input, owner)
  db.update(schema.workspaceEdits)
    .set({ state: "expired", beforeContent: "", afterContent: "" })
    .run()
  db.update(schema.workspaceDrafts)
    .set({
      baseSha256: hash(original),
      revision: buffer.revision,
      pendingSave: JSON.stringify({
        id: input.id,
        revision: input.expectedRevision,
        intent: input.intent,
      }),
    })
    .run()
  const recovered = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  expect(recovered.conflict).toBe(true)
  expect(recovered.draft.pendingSave).not.toBeNull()
  await expect(
    service.saveDraft(draftSave(recovered, recovered.draft.revision), owner),
  ).rejects.toThrow(/expired draft save/)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(buffer.content)
})

it("fences stale pane updates/releases and rejects stale draft revisions", async () => {
  const owner = draftOwner()
  const first = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const second = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  expect(second.leaseToken).not.toBe(first.leaseToken)
  await expect(service.updateDraft(draftUpdate(first), owner)).rejects.toThrow(/not owned/)
  expect(service.releaseDraft(draftUpdate(first), owner)).toEqual({ released: false })
  await service.updateDraft(draftUpdate(second), owner)
  await expect(service.updateDraft(draftUpdate(second, "stale"), owner)).rejects.toThrow(/revision/)
  expect(db.select().from(schema.workspaceDrafts).get()?.content).toBe("unsaved 雪\r\n")
})

it("keeps a single live window owner across hard links and allows closed-window recovery", async () => {
  const alive = new Set([++draftWindowId, ++draftWindowId])
  const [firstId, secondId] = [...alive]
  const firstOwner = { windowId: firstId!, isAlive: (id: number) => alive.has(id) }
  const secondOwner = { ...firstOwner, windowId: secondId! }
  linkSync(join(root, "file.txt"), join(root, "alias.txt"))
  await service.openDraft({ ...scope, relativePath: "file.txt" }, firstOwner)
  await expect(
    service.openDraft({ ...scope, relativePath: "alias.txt" }, secondOwner),
  ).rejects.toThrow(/another window/)
  alive.delete(firstId!)
  expect(
    (await service.openDraft({ ...scope, relativePath: "alias.txt" }, secondOwner)).draft.content,
  ).toBe(original)
})

it("shares case aliases only when the filesystem identifies the same file", async () => {
  const ids = [++draftWindowId, ++draftWindowId]
  const firstOwner = { windowId: ids[0]!, isAlive: (id: number) => ids.includes(id) }
  const secondOwner = { ...firstOwner, windowId: ids[1]! }
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, firstOwner)
  if (existsSync(join(root, "FILE.TXT"))) {
    await expect(
      service.openDraft({ ...scope, relativePath: "FILE.TXT" }, secondOwner),
    ).rejects.toThrow(/another window/)
    const remounted = await service.openDraft({ ...scope, relativePath: "FILE.TXT" }, firstOwner)
    expect(remounted.draft.id).toBe(opened.draft.id)
  } else {
    writeFileSync(join(root, "FILE.TXT"), "distinct")
    const other = await service.openDraft({ ...scope, relativePath: "FILE.TXT" }, secondOwner)
    expect(other.draft.id).not.toBe(opened.draft.id)
    expect(other.draft.content).toBe("distinct")
  }
})

it("bounds live editors and frees capacity without deleting buffers", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  for (let index = 1; index <= 64; index++) {
    writeFileSync(join(root, `pane-${index}.txt`), "text")
    const action = service.openDraft({ ...scope, relativePath: `pane-${index}.txt` }, owner)
    if (index < 64) await action
    else await expect(action).rejects.toThrow(/Too many active editors/)
  }
  service.releaseDraft(draftUpdate(opened), owner)
  expect(
    (await service.openDraft({ ...scope, relativePath: "pane-64.txt" }, owner)).draft.content,
  ).toBe("text")
  expect(db.select().from(schema.workspaceDrafts).all()).toHaveLength(65)
})

it("preserves a draft and its base when the disk changes or disappears", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  await service.updateDraft(draftUpdate(opened), owner)
  writeFileSync(join(root, "file.txt"), "external")
  const reopened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  expect(reopened).toMatchObject({
    conflict: true,
    diskSha256: hash("external"),
    draft: { content: "unsaved 雪\r\n", baseSha256: hash(original) },
  })
  rmSync(join(root, "file.txt"))
  await service.updateDraft(draftUpdate(reopened, "still recoverable"), owner)
  expect(existsSync(join(root, "file.txt"))).toBe(false)
  expect(db.select().from(schema.workspaceDrafts).get()?.content).toBe("still recoverable")
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

it("bounds draft text and requires a real desktop caller", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  for (const content of ["\ud800", "a\0b", "雪".repeat(800_000)])
    await expect(service.updateDraft(draftUpdate(opened, content), owner)).rejects.toThrow()
  vi.spyOn(appDatabase, "getDatabase").mockImplementation(() => db)
  const caller = workspaceEditingRouter.createCaller({ getWindow: () => null })
  await expect(caller.openDraft({ ...scope, relativePath: "file.txt" })).rejects.toThrow(
    /desktop window/,
  )
  expect(db.select().from(schema.workspaceDrafts).get()?.content).toBe(original)
})

it("takes draft window identity from trusted context rather than renderer input", async () => {
  vi.spyOn(appDatabase, "getDatabase").mockImplementation(() => db)
  const open = vi
    .spyOn(WorkspaceEditingService.prototype, "openDraft")
    .mockRejectedValue(new Error("authority captured"))
  const caller = workspaceEditingRouter.createCaller({
    getWindow: () =>
      ({
        id: 42,
        isDestroyed: () => false,
      }) as never,
  })
  await expect(
    caller.openDraft({ ...scope, relativePath: "file.txt", windowId: 999 } as never),
  ).rejects.toThrow("authority captured")
  expect(open).toHaveBeenCalledWith(
    { ...scope, relativePath: "file.txt" },
    expect.objectContaining({ windowId: 42 }),
  )
})

it("does not grant a lease when its window closes during the asynchronous read", async () => {
  const owner = draftOwner()
  let checks = 0
  owner.isAlive = () => ++checks === 1
  await expect(service.openDraft({ ...scope, relativePath: "file.txt" }, owner)).rejects.toThrow(
    /window closed/,
  )
  expect(db.select().from(schema.workspaceDrafts).all()).toEqual([])
})

it("refuses a full draft store without invalidating the existing pane lease", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  db.transaction((tx) => {
    for (let index = 1; index < 1000; index++)
      tx.insert(schema.workspaceDrafts)
        .values({
          ...opened.draft,
          id: randomUUID(),
          canonicalPath: join(root, `retained-${index}`),
          content: "",
        })
        .run()
  })
  db.insert(schema.chats)
    .values({
      id: "other-chat",
      projectId: scope.projectId,
      worktreePath: root,
      permissionMode: "auto-edit-project-only",
    })
    .run()
  await expect(
    service.openDraft({ ...scope, chatId: "other-chat", relativePath: "file.txt" }, owner),
  ).rejects.toThrow(/storage is full/)
  expect((await service.updateDraft(draftUpdate(opened), owner)).content).toBe("unsaved 雪\r\n")
  expect(db.select().from(schema.workspaceDrafts).all()).toHaveLength(1000)
})

it("enforces the aggregate draft byte budget without dropping retained text", async () => {
  const owner = draftOwner()
  const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
  const chunk = "a".repeat(2 * 1024 * 1024)
  db.transaction((tx) => {
    for (let index = 0; index < 32; index++)
      tx.insert(schema.workspaceDrafts)
        .values({
          ...opened.draft,
          id: randomUUID(),
          canonicalPath: join(root, `retained-${index}`),
          content: index === 31 ? chunk.slice(Buffer.byteLength(original)) : chunk,
        })
        .run()
  })
  await expect(service.updateDraft(draftUpdate(opened, `${original}雪`), owner)).rejects.toThrow(
    /storage is full/,
  )
  expect(
    db
      .select()
      .from(schema.workspaceDrafts)
      .all()
      .reduce((total, row) => total + Buffer.byteLength(row.content), 0),
  ).toBe(64 * 1024 * 1024)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
})

it("exposes successful saves and structured stale-target conflicts through the beta API", async () => {
  vi.spyOn(appDatabase, "getDatabase").mockImplementation(() => db)
  const caller = workspaceEditingRouter.createCaller({ getWindow: () => null })
  expect(await caller.read({ ...scope, relativePath: "file.txt" })).toMatchObject({
    sha256: hash(original),
  })
  expect(await caller.save(request())).toMatchObject({ ok: true, operation: { state: "applied" } })
  expect(await caller.save(request("stale"))).toMatchObject({ ok: false, reason: "conflict" })
  expect(
    await caller.saveAs({
      ...scope,
      id: randomUUID(),
      relativePath: "copy.txt",
      content: original,
    }),
  ).toMatchObject({ ok: true, operation: { kind: "create" } })
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

it.each(["", original])(
  "saves a new file and reverses creation and removal (%#)",
  async (content) => {
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
  },
)

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

it("reverses case-only spelling changes without confusing aliases with separate files", async () => {
  const input = {
    ...scope,
    id: randomUUID(),
    relativePath: "file.txt",
    expectedSha256: hash(original),
    newName: "FILE.TXT",
  }
  const renamed = await service.rename(input)
  expect(readdirSync(root)).toEqual(["FILE.TXT"])
  expect(await service.rename(input)).toEqual(renamed)
  const undo = await service.revert({ ...scope, id: randomUUID(), operationId: renamed.id })
  expect(readdirSync(root)).toEqual(["file.txt"])
  await service.revert({ ...scope, id: randomUUID(), operationId: undo.id })
  expect(readdirSync(root)).toEqual(["FILE.TXT"])
  expect(readFileSync(join(root, "FILE.TXT"), "utf8")).toBe(original)
})

it("restores the original spelling after a failed case-only rename audit", async () => {
  const input = {
    ...scope,
    id: randomUUID(),
    relativePath: "file.txt",
    expectedSha256: hash(original),
    newName: "FILE.TXT",
  }
  sqlite.exec(
    "CREATE TRIGGER reject_edit_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  )
  await expect(service.rename(input)).rejects.toThrow("audit unavailable")
  expect(readdirSync(root)).toEqual(["file.txt"])
  sqlite.exec("DROP TRIGGER reject_edit_audit")
  expect((await service.rename(input)).state).toBe("failed")
})

it("rejects rename collisions, stale bytes and unsafe names", async () => {
  const input = {
    ...scope,
    id: randomUUID(),
    relativePath: "file.txt",
    expectedSha256: hash(original),
    newName: "existing.txt",
  }
  writeFileSync(join(root, input.newName), "external")
  await expect(service.rename(input)).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  await expect(service.rename({ ...input, newName: "../escape.txt" })).rejects.toThrow()
  await expect(
    service.rename({ ...input, newName: "fresh.txt", expectedSha256: hash("stale") }),
  ).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  expect(readFileSync(join(root, input.newName), "utf8")).toBe("external")
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

it.skipIf(process.platform === "win32")(
  "restores file permission bits when redoing creation",
  async () => {
    const created = await service.saveAs({
      ...scope,
      id: randomUUID(),
      relativePath: "new.txt",
      content: original,
    })
    chmodSync(join(root, "new.txt"), 0o751)
    const removed = await service.revert({ ...scope, id: randomUUID(), operationId: created.id })
    await service.revert({ ...scope, id: randomUUID(), operationId: removed.id })
    expect(statSync(join(root, "new.txt")).mode & 0o777).toBe(0o751)
  },
)

it("rejects a late save-as target and applies existing path and permission guards", async () => {
  const input = { ...scope, id: randomUUID(), relativePath: "new.txt", content: original }
  await expect(service.saveAs({ ...input, relativePath: "../escape.txt" })).rejects.toThrow()
  sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
  await expect(service.saveAs(input)).rejects.toThrow("permit")
  sqlite.prepare("UPDATE chats SET permission_mode = 'auto-edit-project-only'").run()
  service = new WorkspaceEditingService(db, async (root, path, source, options) => {
    writeFileSync(join(root, path), "external")
    return writeFileInsideRoot(root, path, source, options)
  })
  await expect(service.saveAs(input)).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("external")
})

it.each([false, true])(
  "handles removal audit failure without overwriting external recreation (%s)",
  async (external) => {
    const created = await service.saveAs({
      ...scope,
      id: randomUUID(),
      relativePath: "new.txt",
      content: original,
    })
    sqlite.exec(
      "CREATE TRIGGER reject_edit_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    )
    const undo = { ...scope, id: randomUUID(), operationId: created.id }
    if (external)
      service = new WorkspaceEditingService(
        db,
        writeFileInsideRoot,
        async (root, path, options) => {
          const result = await removeFileInsideRoot(root, path, options)
          writeFileSync(join(root, path), "external")
          return result
        },
      )
    await expect(service.revert(undo)).rejects.toThrow()
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe(external ? "external" : original)
    sqlite.exec("DROP TRIGGER reject_edit_audit")
    expect((await service.revert(undo)).state).toBe(external ? "conflict" : "failed")
  },
)

it("replays a lost response without another write or duplicate audit, even after external edits", async () => {
  const input = request()
  const saved = await service.save(input)
  writeFileSync(join(root, "file.txt"), "external")
  expect(await service.save(input)).toEqual(saved)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("external")
  expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({ count: 1 })
  await expect(service.save({ ...input, content: "different" })).rejects.toThrow("reused")
  await expect(
    service.revert({ ...scope, id: randomUUID(), operationId: saved.id }),
  ).rejects.toBeInstanceOf(WorkspaceEditConflictError)
})

it("expires old snapshots at the retention limit without losing idempotency or blocking the latest undo", async () => {
  const input = request()
  const first = await service.save(input)
  const copy = sqlite.prepare(`INSERT INTO workspace_edits
    SELECT ?, project_id, chat_id, root_path, root_identity, relative_path, request_hash,
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode, previous_relative_path
    FROM workspace_edits WHERE id = ?`)
  sqlite.transaction(() => {
    for (let i = 0; i < 999; i++) copy.run(randomUUID(), first.id)
  })()
  const latest = await service.save({ ...request("latest"), expectedSha256: hash(input.content) })
  expect((await service.save(input)).state).toBe("expired")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("latest")
  expect(
    sqlite
      .prepare("SELECT before_content, after_content FROM workspace_edits WHERE id = ?")
      .get(first.id),
  ).toEqual({ before_content: "", after_content: "" })
  await expect(
    service.revert({ ...scope, id: randomUUID(), operationId: first.id }),
  ).rejects.toThrow("retained undo")
  await service.revert({ ...scope, id: randomUUID(), operationId: latest.id })
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(input.content)
})

it.each([false, true])("replays undo after source expiry (interrupted=%s)", async (interrupted) => {
  const saved = await service.save(request())
  const copy = sqlite.prepare(`INSERT INTO workspace_edits
    SELECT ?, project_id, chat_id, root_path, root_identity, relative_path, request_hash,
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode, previous_relative_path
    FROM workspace_edits WHERE id = ?`)
  sqlite.transaction(() => {
    for (let i = 0; i < 999; i++) copy.run(randomUUID(), saved.id)
  })()
  const undo = { ...scope, id: randomUUID(), operationId: saved.id }
  if (interrupted) {
    const interruptedService = new WorkspaceEditingService(db, (root, path, source, options) =>
      writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined }),
    )
    await interruptedService.revert(undo)
  }
  const results = await Promise.all([service.revert(undo), service.revert(undo)])
  expect(results[0]).toEqual(results[1])
  expect(await service.revert(undo)).toEqual(results[0])
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
  await expect(service.revert({ ...undo, operationId: randomUUID() })).rejects.toThrow("reused")
  sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
  await expect(service.revert(undo)).rejects.toThrow("permit")
})

it("expires enough snapshots for the UTF-8 byte budget independently of record count", async () => {
  const content = "雪".repeat(699_050)
  const first = await service.save(request(content))
  const copy = sqlite.prepare(`INSERT INTO workspace_edits
    SELECT ?, project_id, chat_id, root_path, root_identity, relative_path, request_hash,
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode, previous_relative_path
    FROM workspace_edits WHERE id = ?`)
  sqlite.transaction(() => {
    for (let i = 0; i < 30; i++) copy.run(randomUUID(), first.id)
  })()
  await service.save({ ...request(content), expectedSha256: hash(content) })
  const usage = sqlite
    .prepare(
      `SELECT count(*) count,
    sum(state = 'expired') expired,
    sum(length(cast(before_content as blob)) + length(cast(after_content as blob))) bytes
    FROM workspace_edits`,
    )
    .get() as { count: number; expired: number; bytes: number }
  expect(usage.count).toBe(32)
  expect(usage.expired).toBe(2)
  expect(usage.bytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(content)
})

it("serializes duplicate reversals of a prepared source", async () => {
  service = new WorkspaceEditingService(db, (root, path, source, options) =>
    writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined }),
  )
  const saved = await service.save(request())
  service = new WorkspaceEditingService(db)
  const undo = { ...scope, id: randomUUID(), operationId: saved.id }
  const results = await Promise.all([service.revert(undo), service.revert(undo)])
  expect(results[0]).toEqual(results[1])
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
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

it("reports late content drift and missing targets as conflicts without losing drafts", async () => {
  service = new WorkspaceEditingService(db, async (root, path, source, options) => {
    writeFileSync(join(root, path), "external update")
    return writeFileInsideRoot(root, path, source, options)
  })
  await expect(service.save(request())).rejects.toBeInstanceOf(WorkspaceEditConflictError)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("external update")
  renameSync(join(root, "file.txt"), join(root, "moved.txt"))
  await expect(new WorkspaceEditingService(db).save(request())).rejects.toMatchObject({
    diskSha256: null,
  })
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

it("recovers a durable write interrupted before metadata completion without rewriting disk", async () => {
  const input = request()
  service = new WorkspaceEditingService(db, async (root, path, source, options) => {
    await writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined })
    sqlite.close()
    throw new Error("simulated process loss")
  })
  await expect(service.save(input)).rejects.toThrow("simulated process loss")
  sqlite = new Database(join(container, "test.db"))
  db = createDb()
  service = new WorkspaceEditingService(db)
  expect((await service.history(scope))[0].state).toBe("prepared")
  expect((await service.save(input)).state).toBe("applied")
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(input.content)
  expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({ count: 1 })
})

it.each([
  "save",
  "create",
  "remove",
  "rename",
  "rename-linked",
  "rename-case",
  "draft-save",
  "draft-ack",
  "draft-external",
  "draft-ack-external",
] as const)(
  "recovers an actual child exit after %s commit",
  async (kind) => {
    const created =
      kind === "remove"
        ? await service.saveAs({
            ...scope,
            id: randomUUID(),
            relativePath: "new.txt",
            content: original,
          })
        : null
    const input = {
      ...request(),
      relativePath:
        kind === "save" || kind.startsWith("rename") || kind.startsWith("draft-")
          ? "file.txt"
          : "new.txt",
      operationId: created?.id,
      newName: kind === "rename-case" ? "FILE.TXT" : "renamed.txt",
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
      if (kind.startsWith("draft-")) {
        expect((await service.history(scope))[0].state).toBe(
          kind.startsWith("draft-ack") ? "applied" : "prepared",
        )
        const external = kind.endsWith("external")
        const applied = !external || kind.startsWith("draft-ack")
        if (external) writeFileSync(join(root, "file.txt"), "external after interruption")
        const owner = draftOwner()
        const opened = await service.openDraft({ ...scope, relativePath: "file.txt" }, owner)
        expect(opened).toMatchObject({
          conflict: external,
          draft: {
            pendingSave: null,
            baseSha256: applied ? hash(input.content) : hash(original),
            content: input.content,
            revision: applied ? 2 : 1,
          },
        })
        const beforeReplay = statSync(join(root, "file.txt")).ino
        const replay = await service.saveDraft({ ...draftSave(opened, 1), id: input.id }, owner)
        expect(replay.operation.state).toBe(applied ? "applied" : "conflict")
        expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(
          external ? "external after interruption" : input.content,
        )
        expect(statSync(join(root, "file.txt")).ino).toBe(beforeReplay)
        expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({
          count: 1,
        })
        return
      }
      expect((await service.history(scope))[0].state).toBe("prepared")
      const recovered =
        kind === "remove"
          ? await service.revert({ ...input, operationId: created!.id })
          : kind === "create"
            ? await service.saveAs(input)
            : kind.startsWith("rename")
              ? await service.rename(input)
              : await service.save(input)
      expect(recovered.state).toBe(kind === "rename-linked" ? "conflict" : "applied")
      if (kind === "remove") expect(existsSync(join(root, input.relativePath))).toBe(false)
      else if (kind.startsWith("rename")) {
        expect(readdirSync(root).includes(input.relativePath)).toBe(kind === "rename-linked")
        expect(readFileSync(join(root, input.newName), "utf8")).toBe(original)
      } else expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(input.content)
    } finally {
      rmSync(buildRoot, { recursive: true, force: true })
    }
  },
  20_000,
)

it.each([false, true])(
  "keeps interrupted recovery truthful after external changes (missing=%s)",
  async (missing) => {
    const input = request()
    service = new WorkspaceEditingService(db, async (root, path, source, options) => {
      await writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined })
      sqlite.close()
      throw new Error("simulated process loss")
    })
    await expect(service.save(input)).rejects.toThrow()
    if (missing) renameSync(join(root, "file.txt"), join(root, "moved.txt"))
    else writeFileSync(join(root, "file.txt"), "external")
    sqlite = new Database(join(container, "test.db"))
    db = createDb()
    service = new WorkspaceEditingService(db)
    expect((await service.save(input)).state).toBe("conflict")
    writeFileSync(join(root, "other.txt"), original)
    expect((await service.save({ ...request(), relativePath: "other.txt" })).state).toBe("applied")
    if (!missing) expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("external")
  },
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

it.each(["beforeCommit", "afterCommit"] as const)(
  "rechecks permission at %s and preserves the original file on denial",
  async (phase) => {
    service = new WorkspaceEditingService(db, (root, path, source, options) =>
      writeFileInsideRoot(root, path, source, {
        ...options,
        [phase]: async (targetPath: string) => {
          sqlite.prepare("UPDATE chats SET permission_mode = 'read-only'").run()
          await options?.[phase]?.(targetPath)
        },
      }),
    )
    await expect(service.save(request())).rejects.toThrow("permit")
    expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
    expect((await service.history(scope))[0].state).toBe("failed")
  },
)

it("fails closed for incomplete custom policy and permits only an explicit project-write capability", async () => {
  for (const policy of [
    "invalid",
    JSON.stringify({ projectWrite: true }),
    JSON.stringify(disabledCustomPermissions),
  ]) {
    sqlite
      .prepare("UPDATE chats SET permission_mode = 'custom', custom_permissions = ?")
      .run(policy)
    await expect(service.save(request())).rejects.toThrow("Custom permissions")
  }
  sqlite
    .prepare("UPDATE chats SET custom_permissions = ?")
    .run(JSON.stringify({ ...disabledCustomPermissions, projectWrite: true }))
  expect((await service.save(request())).state).toBe("applied")
})

it("rejects queued saves when the registered root is replaced while the lock is held", async () => {
  let entered!: () => void
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const resume = new Promise<void>((resolve) => {
    release = resolve
  })
  service = new WorkspaceEditingService(db, async (root, path, source, options) => {
    entered()
    await resume
    return writeFileInsideRoot(root, path, source, options)
  })
  const first = service.save(request())
  await waiting
  const second = new WorkspaceEditingService(db).save(request("queued"))
  const results = Promise.allSettled([first, second])
  renameSync(root, join(container, "old-root"))
  mkdirSync(root)
  writeFileSync(join(root, "file.txt"), "replacement")
  release()
  expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"])
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("replacement")
  expect(readFileSync(join(container, "old-root", "file.txt"), "utf8")).toBe(original)
  expect(sqlite.prepare("SELECT count(*) count FROM workspace_edits").get()).toEqual({ count: 1 })
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

it.each(["\0", "\ud800", "雪".repeat(700_000)])(
  "rejects lossy, binary and oversized draft bytes (%#)",
  async (content) => {
    await expect(service.save(request(content))).rejects.toThrow()
    expect(readFileSync(join(root, "file.txt"), "utf8")).toBe(original)
    expect(await service.history(scope)).toHaveLength(0)
  },
)
