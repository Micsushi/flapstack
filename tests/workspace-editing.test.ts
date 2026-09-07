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
import * as appDatabase from "../src/main/lib/db"
import { workspaceEditingRouter } from "../src/main/lib/trpc/routers/workspace-editing"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  WorkspaceEditingService,
  WorkspaceEditConflictError,
} from "../src/main/lib/workspace-editing/service"
import { removeFileInsideRoot, writeFileInsideRoot } from "../src/main/lib/path-safety"
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
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode
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
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode
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
      before_content, after_content, before_sha256, after_sha256, reverts_id, state, created_at + 1, kind, file_mode
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

it.each(["save", "create", "remove"] as const)(
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
      relativePath: kind === "save" ? "file.txt" : "new.txt",
      operationId: created?.id,
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
      expect((await service.history(scope))[0].state).toBe("prepared")
      const recovered =
        kind === "remove"
          ? await service.revert({ ...input, operationId: created!.id })
          : kind === "create"
            ? await service.saveAs(input)
            : await service.save(input)
      expect(recovered.state).toBe("applied")
      if (kind === "remove") expect(existsSync(join(root, input.relativePath))).toBe(false)
      else expect(readFileSync(join(root, input.relativePath), "utf8")).toBe(input.content)
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
