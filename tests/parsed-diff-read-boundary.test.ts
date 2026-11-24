import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { gitCache } from "../src/main/lib/git/cache"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"

const state = vi.hoisted(() => ({ userDataPath: "", diff: "", read: vi.fn() }))
vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath, getVersion: () => "0.0.0-test", isPackaged: false },
  BrowserWindow: { fromId: () => null, getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))
vi.mock("../src/main/index", () => ({ getAuthManager: () => null }))
vi.mock("../src/main/lib/analytics", () => ({
  trackPRCreated: vi.fn(),
  trackWorkspaceArchived: vi.fn(),
  trackWorkspaceCreated: vi.fn(),
  trackWorkspaceDeleted: vi.fn(),
  trackProjectOpened: vi.fn(),
}))
vi.mock("../src/main/lib/git", async (original) => ({
  ...(await original<typeof import("../src/main/lib/git")>()),
  getWorktreeDiff: (...args: unknown[]) => state.read(...args),
}))

let container: string, root: string, sqlite: Database.Database
const caller = chatsRouter.createCaller({ getWindow: () => null })
const patch = (name: string) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-diff-read-"))
  root = join(container, "repo")
  state.userDataPath = join(container, "user-data")
  mkdirSync(root)
  mkdirSync(state.userDataPath)
  process.env.FLAPSTACK_DB_PATH = join(state.userDataPath, "agents.db")
  sqlite = new Database(process.env.FLAPSTACK_DB_PATH)
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve("drizzle") })
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({ id: "chat", name: "Chat", projectId: "project", worktreePath: root })
    .run()
  bindFilesystemRootIdentity(root, db)
  state.diff = patch("file.ts")
  state.read.mockReset().mockImplementation(async () => ({ success: true, diff: state.diff }))
})
afterEach(() => {
  vi.restoreAllMocks()
  gitCache.invalidateWorktree(root)
  closeDatabase()
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

it("loads only a bounded section of the observed diff and rejects stale identities", async () => {
  state.diff = patch("file.ts")
  const snapshot = await caller.getParsedDiff({ chatId: "chat", includeContents: false })
  if (snapshot.unchanged) throw new Error("Expected snapshot")
  const stream = await caller.getDiffReview({
    chatId: "chat",
    diffHash: snapshot.diffHash,
    fileKey: snapshot.files[0]!.key,
    offset: 0,
  })
  const review = (await stream.next()).value
  expect(review?.kind).toBe("text")
  state.diff = patch("other.ts")
  await expect(
    (
      await caller.getDiffReview({
        chatId: "chat",
        diffHash: snapshot.diffHash,
        fileKey: snapshot.files[0]!.key,
        offset: 0,
      })
    ).next(),
  ).rejects.toThrow("Diff changed")
  await expect(
    (
      await caller.getDiffReview({
        chatId: "missing",
        diffHash: snapshot.diffHash,
        fileKey: "file",
        offset: 0,
      })
    ).next(),
  ).rejects.toThrow("scope")
})

it("does not prefetch content through a repository directory junction", async () => {
  const outside = join(container, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "private.txt"), "outside-content")
  symlinkSync(outside, join(root, "linked"), "junction")
  state.diff = patch("linked/private.txt")
  const result = await caller.getParsedDiff({ chatId: "chat" })
  expect("fileContents" in result && result.fileContents).toEqual({})
  expect(JSON.stringify(result)).not.toContain("outside-content")
})

it("rejects root replacement before serving cached content", async () => {
  writeFileSync(join(root, "file.ts"), "original")
  await caller.getParsedDiff({ chatId: "chat" })
  renameSync(root, join(container, "original-repo"))
  mkdirSync(root)
  await expect(caller.getParsedDiff({ chatId: "chat" })).rejects.toThrow()
})
