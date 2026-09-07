import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { DiffAnnotationService } from "../src/main/lib/diff-annotations/service"

let container: string, root: string, sqlite: Database.Database
let service: DiffAnnotationService
let diff: string
const scope = { projectId: "project", chatId: "chat" }
const readDiff = vi.fn()
const textDiff = (name = "file.ts", text = "new") =>
  `diff --git a/${name} b/${name}\nindex 1234567..7654321 100644\n--- a/${name}\n+++ b/${name}\n@@ -1,2 +1,2 @@\n-old\n+${text}\n context\n`
beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-diff-annotations-"))
  root = join(container, "repo")
  mkdirSync(root)
  sqlite = new Database(join(container, "test.db"))
  sqlite.pragma("foreign_keys=ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve("drizzle") })
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({ id: "chat", name: "Chat", projectId: "project", worktreePath: root })
    .run()
  bindFilesystemRootIdentity(root, db)
  diff = textDiff()
  readDiff.mockReset().mockImplementation(async () => ({ success: true, diff }))
  service = new DiffAnnotationService(db, readDiff)
})
afterEach(() => {
  sqlite.close()
  rmSync(container, { recursive: true, force: true })
})
async function input() {
  return {
    ...scope,
    id: randomUUID(),
    body: "Review this line",
    anchor: {
      diffHash: (await service.list(scope)).diffHash,
      filePath: "file.ts",
      side: "right" as const,
      startLine: 1,
      endLine: 2,
    },
  }
}

it("persists exact anchors across reopen and retries without duplicate comments or body audit", async () => {
  const value = await input()
  const row = await service.create(value)
  expect(await service.create(value)).toEqual({ ...row, freshness: "unverified" })
  expect(row).toMatchObject({
    version: 1,
    freshness: "current",
    filePath: "file.ts",
    startLine: 1,
    endLine: 2,
  })
  const audit = sqlite.prepare("SELECT input_summary, result_summary FROM mcp_audit_records").all()
  expect(audit).toHaveLength(1)
  expect(JSON.stringify(audit)).not.toContain(value.body)
  sqlite.close()
  sqlite = new Database(join(container, "test.db"))
  service = new DiffAnnotationService(drizzle(sqlite, { schema }), readDiff)
  expect((await service.list(scope)).annotations).toEqual([row])
  await expect(service.create({ ...value, body: "Different request" })).rejects.toThrow("reused")
})

it("replays a committed create after the diff changes or goes offline without resurrecting edits", async () => {
  const value = await input()
  const row = await service.create(value)
  const deleted = service.setDeleted({ ...scope, id: row.id, expectedVersion: 1, deleted: true })
  diff = textDiff("renamed.ts")
  expect(await service.create(value)).toEqual(deleted)
  readDiff.mockRejectedValue(new Error("offline"))
  expect(await service.create(value)).toEqual(deleted)
  await expect(service.create({ ...value, body: "Different request" })).rejects.toThrow("reused")
  expect(sqlite.prepare("SELECT count(*) count FROM mcp_audit_records").get()).toEqual({ count: 2 })
})

it("marks changed and renamed diffs stale until explicit re-anchor and checks edit versions", async () => {
  const value = await input(),
    row = await service.create(value)
  diff = textDiff("renamed.ts", "changed")
  const state = await service.list(scope)
  expect(state.annotations[0]).toMatchObject({ freshness: "stale", filePath: "file.ts" })
  await expect(
    service.revise({
      ...scope,
      id: row.id,
      expectedVersion: 1,
      body: "Edit",
      anchor: value.anchor,
    }),
  ).rejects.toThrow("Diff changed")
  const updated = await service.revise({
    ...scope,
    id: row.id,
    expectedVersion: 1,
    body: "Re-anchored",
    anchor: { ...value.anchor, diffHash: state.diffHash, filePath: "renamed.ts" },
  })
  expect(updated).toMatchObject({ version: 2, freshness: "current", filePath: "renamed.ts" })
  await expect(
    service.revise({
      ...scope,
      id: row.id,
      expectedVersion: 1,
      body: "Late edit",
      anchor: { ...value.anchor, diffHash: state.diffHash, filePath: "renamed.ts" },
    }),
  ).rejects.toThrow("Comment changed")
})

it("deletes and restores with CAS even when the worktree is unavailable", async () => {
  const row = await service.create(await input())
  readDiff.mockResolvedValue({ success: false, error: "offline" })
  expect(await service.list(scope)).toMatchObject({
    diffHash: null,
    error: expect.stringContaining("unverified"),
    annotations: [{ id: row.id, freshness: "unverified", body: row.body }],
  })
  const removed = service.setDeleted({ ...scope, id: row.id, expectedVersion: 1, deleted: true })
  expect(removed.deletedAt).not.toBeNull()
  expect(() =>
    service.setDeleted({ ...scope, id: row.id, expectedVersion: 1, deleted: false }),
  ).toThrow("Comment changed")
  const restored = service.setDeleted({ ...scope, id: row.id, expectedVersion: 2, deleted: false })
  expect(restored).toMatchObject({
    deletedAt: null,
    version: 3,
    freshness: "unverified",
    body: row.body,
  })
})

it("rejects cross-project access, unloaded lines, unsafe paths and oversized UTF-8 bodies", async () => {
  const value = await input(),
    row = await service.create(value)
  await expect(service.list({ ...scope, projectId: "another" })).rejects.toThrow("scope")
  expect(() =>
    service.setDeleted({
      ...scope,
      chatId: "another",
      id: row.id,
      expectedVersion: 1,
      deleted: true,
    }),
  ).toThrow("scope")
  await expect(
    service.create({
      ...value,
      id: randomUUID(),
      anchor: { ...value.anchor, startLine: 50, endLine: 50 },
    }),
  ).rejects.toThrow("outside")
  await expect(
    service.create({
      ...value,
      id: randomUUID(),
      anchor: { ...value.anchor, filePath: "../file.ts" },
    }),
  ).rejects.toThrow("relative")
  await expect(
    service.create({ ...value, id: randomUUID(), body: "雪".repeat(6000) }),
  ).rejects.toThrow("16 KiB")
})

it("rolls back comment writes when audit persistence fails", async () => {
  const value = await input()
  sqlite.exec(
    "CREATE TRIGGER reject_annotation_audit BEFORE INSERT ON mcp_audit_records BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END",
  )
  await expect(service.create(value)).rejects.toThrow("fixture audit failure")
  expect(sqlite.prepare("SELECT count(*) count FROM diff_annotations").get()).toEqual({ count: 0 })
})

it("rejects a root replacement during current-diff inspection", async () => {
  const value = await input()
  readDiff.mockImplementation(async () => {
    renameSync(root, join(container, "old-repo"))
    mkdirSync(root)
    return { success: true, diff }
  })
  await expect(service.create(value)).rejects.toThrow("identity changed")
  expect(sqlite.prepare("SELECT count(*) count FROM diff_annotations").get()).toEqual({ count: 0 })
})

it("anchors both sides of a real Git diff without changing worktree content", async () => {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" })
  git("init", "-b", "annotation-fixture")
  writeFileSync(join(root, "file.ts"), "old\ncontext\n")
  git("add", "file.ts")
  git("commit", "-m", "test fixture")
  writeFileSync(join(root, "file.ts"), "new\ncontext\n")
  const before = git("diff", "--no-ext-diff")
  service = new DiffAnnotationService(drizzle(sqlite, { schema }))
  const value = await input()
  expect((await service.create(value)).freshness).toBe("current")
  expect(
    (
      await service.create({
        ...value,
        id: randomUUID(),
        anchor: { ...value.anchor, side: "left" },
      })
    ).side,
  ).toBe("left")
  expect(git("diff", "--no-ext-diff")).toBe(before)
  expect(readFileSync(join(root, "file.ts"), "utf8")).toBe("new\ncontext\n")
})
