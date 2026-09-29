import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

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
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { gitCache } from "../src/main/lib/git/cache"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"
import * as reviewService from "../src/main/lib/diff-annotations/review"

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

it("rejects an image snapshot when the diff changes during its byte reads", async () => {
  const hash = createHash("sha256").update(state.diff).digest("hex")
  vi.spyOn(reviewService, "readDiffReview").mockResolvedValueOnce({
    kind: "image",
    before: null,
    after: null,
  })
  state.read
    .mockResolvedValueOnce({ success: true, diff: state.diff })
    .mockResolvedValueOnce({ success: true, diff: patch("changed.ts") })
  const stream = await caller.getDiffReview({
    chatId: "chat",
    diffHash: hash,
    fileKey: "image",
    offset: 0,
  })
  await expect(stream.next()).rejects.toThrow("Image diff changed")
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

it("propagates subscription cancellation to in-flight diff collection", async () => {
  let collecting!: () => void
  const started = new Promise<void>((resolve) => {
    collecting = resolve
  })
  const controller = new AbortController()
  state.read.mockImplementation(
    async (_root: string, _base: unknown, options: { signal: AbortSignal }) => {
      collecting()
      await new Promise<void>((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        }),
      )
    },
  )
  const cancelledCaller = chatsRouter.createCaller(
    { getWindow: () => null },
    { signal: controller.signal },
  )
  const stream = await cancelledCaller.getDiffReview({
    chatId: "chat",
    diffHash: "a".repeat(64),
    fileKey: "a",
    offset: 0,
  })
  const next = stream.next()
  await started
  controller.abort()
  await expect(next).rejects.toThrow()
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

it("does not prefetch traversal paths supplied by a diff", async () => {
  writeFileSync(join(container, "outside.txt"), "outside-content")
  state.diff = patch("../outside.txt")
  const result = await caller.getParsedDiff({ chatId: "chat" })
  expect("fileContents" in result && result.fileContents).toEqual({})
})

it("preserves empty content and skips oversized content", async () => {
  writeFileSync(join(root, "file.ts"), "")
  const result = await caller.getParsedDiff({ chatId: "chat" })
  expect("fileContents" in result && Object.values(result.fileContents)).toEqual([""])
  gitCache.invalidateWorktree(root)
  writeFileSync(join(root, "file.ts"), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
  const large = await caller.getParsedDiff({ chatId: "chat" })
  expect("fileContents" in large && large.fileContents).toEqual({})
})

it("rejects root replacement before serving cached content", async () => {
  writeFileSync(join(root, "file.ts"), "original")
  await caller.getParsedDiff({ chatId: "chat" })
  renameSync(root, join(container, "original-repo"))
  mkdirSync(root)
  await expect(caller.getParsedDiff({ chatId: "chat" })).rejects.toThrow()
})

it("checks root identity again after Git collection even for an unchanged response", async () => {
  writeFileSync(join(root, "file.ts"), "original")
  const initial = await caller.getParsedDiff({ chatId: "chat" })
  state.read.mockImplementation(async () => {
    renameSync(root, join(container, "original-repo"))
    mkdirSync(root)
    return { success: true, diff: state.diff }
  })
  await expect(
    caller.getParsedDiff({ chatId: "chat", knownDiffHash: initial.diffHash }),
  ).rejects.toThrow()
})

it("keeps unchanged responses and contents-free summaries small", async () => {
  writeFileSync(join(root, "file.ts"), "new")
  const initial = await caller.getParsedDiff({ chatId: "chat" })
  const expectedHash = createHash("sha256").update(state.diff).digest("hex")
  expect(initial.diffHash).toBe(expectedHash)
  expect("files" in initial && initial.files[0].observedDiffHash).toBe(expectedHash)
  expect(await caller.getParsedDiff({ chatId: "chat", knownDiffHash: initial.diffHash })).toEqual({
    unchanged: true,
    diffHash: initial.diffHash,
  })
  const summary = await caller.getParsedDiff({ chatId: "chat", includeContents: false })
  expect("fileContents" in summary && summary.fileContents).toEqual({})
  expect("files" in summary && summary.files[0].observedDiffHash).toBe(expectedHash)
})
