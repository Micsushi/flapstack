import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname, basename } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { shouldAutoGenerateInitialResponse } from "../src/renderer/features/agents/main/chat-message-hydration"
import { RecordTaskWorktreeService } from "../src/main/lib/project-records/task-worktree"

let directory: string, repo: string, sqlite: Database.Database
const input = {
  path: "projects/flapstack/features.md",
  recordId: "TASK-1",
  canonicalProjectId: "flapstack",
  localProjectId: "local",
  expectedRevision: "a".repeat(64),
  claimId: "claim-a",
}
const record = {
  id: input.recordId,
  title: "Fixture task",
  kind: "task" as const,
  state: "in_progress",
  history: [],
  description: "Keep canonical ownership",
  workSpec: { acceptance: ["One isolated Chat"], verification: ["Concurrent open fixture"] },
  executionAuthorization: { secret: "never-copy-authority" },
  projects: [{ id: "flapstack" }],
}
const client = { read: vi.fn(), operation: vi.fn() }
const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  }).trim()
const create = vi.fn(async (repository: string, branch: string, path: string, base: string) => {
  mkdirSync(dirname(path), { recursive: true })
  execFileSync("git", ["worktree", "add", path, "-b", branch, base], {
    cwd: repository,
    windowsHide: true,
    stdio: "pipe",
  })
  register(path)
})
function register(path: string) {
  const stat = statSync(path, { bigint: true })
  sqlite
    .prepare(
      "INSERT INTO filesystem_root_registrations(path,canonical_path,device_id,inode_id,bound_at) VALUES(?,?,?,?,0)",
    )
    .run(path, realpathSync(path), String(stat.dev), String(stat.ino))
}
const service = () =>
  new RecordTaskWorktreeService(
    sqlite,
    client,
    "http://127.0.0.1:1234",
    join(directory, "worktrees"),
    create,
    register,
  )
async function open(value = input) {
  const current = service()
  const preview = await current.preview(value)
  return current.open({ ...value, expectedTarget: preview.expectedTarget })
}
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-record-worktree-")))
  repo = join(directory, "repo")
  mkdirSync(repo)
  git(["init"])
  git(["commit", "--allow-empty", "-m", "Fixture"])
  git(["branch", "-M", "release/base"])
  sqlite = new Database(join(directory, "test.db"))
  sqlite.pragma("foreign_keys=ON")
  migrate(drizzle(sqlite), { migrationsFolder: resolve("drizzle") })
  sqlite.prepare("INSERT INTO projects(id,name,path) VALUES('local','Fixture',?)").run(repo)
  register(repo)
  client.read.mockReset().mockResolvedValue({
    schemaVersion: 1,
    path: input.path,
    revision: input.expectedRevision,
    document: { schemaVersion: 1, title: "Tasks", records: [record] },
  })
  client.operation.mockReset().mockResolvedValue({
    path: input.path,
    recordId: input.recordId,
    revision: input.expectedRevision,
    readiness: { currentClaim: true, claim: { id: input.claimId } },
  })
  create.mockClear()
})
afterEach(() => {
  sqlite.close()
  if (
    dirname(resolve(directory)) !== realpathSync(tmpdir()) ||
    !basename(directory).startsWith("flapstack-record-worktree-")
  )
    throw new Error("Unsafe fixture cleanup")
  rmSync(directory, { recursive: true, force: true })
})
it("coalesces concurrent clicks, reopens after restart and uses the isolated native run target", async () => {
  const [first, second] = await Promise.all([open(input), open(input)])
  expect(second).toEqual(first)
  expect(create).toHaveBeenCalledTimes(1)
  expect(await open(input)).toEqual(first)
  const chat = sqlite.prepare("SELECT * FROM chats WHERE id=?").get(first.chatId) as Record<
    string,
    unknown
  >
  expect(chat.worktree_path).toBe(first.worktreePath)
  expect(chat.task_id).toBeNull()
  expect(chat.project_id).toBe("local")
  expect(chat.base_branch).toBe("release/base")
  expect(create.mock.calls[0]?.[3]).toBe(git(["rev-parse", "HEAD"]))
  expect(chat.base_branch).not.toBe(create.mock.calls[0]?.[3])
  const saved = sqlite
    .prepare("SELECT messages, run_status FROM sub_chats WHERE chat_id=?")
    .get(first.chatId) as { messages: string; run_status: string | null }
  const messages = JSON.parse(saved.messages)
  expect(messages).toHaveLength(1)
  const text = messages[0].parts[0].text
  for (const value of [
    input.path,
    input.recordId,
    input.canonicalProjectId,
    input.expectedRevision,
    "One isolated Chat",
    "Concurrent open fixture",
    "Keep canonical ownership",
  ])
    expect(text).toContain(value)
  expect(text).not.toContain("never-copy-authority")
  expect(saved.run_status).toBeNull()
  expect(
    shouldAutoGenerateInitialResponse({
      messages,
      status: "ready",
      pendingInitialGeneration: false,
    }),
  ).toBe(false)
  expect((sqlite.prepare("SELECT count(*) n FROM agent_runs").get() as { n: number }).n).toBe(0)
  const edited = JSON.stringify([
    ...messages,
    { id: "user-followup", role: "user", parts: [{ type: "text", text: "Preserve my followup" }] },
  ])
  sqlite.prepare("UPDATE sub_chats SET messages=? WHERE chat_id=?").run(edited, first.chatId)
  await open(input)
  expect(
    (
      sqlite.prepare("SELECT messages FROM sub_chats WHERE chat_id=?").get(first.chatId) as {
        messages: string
      }
    ).messages,
  ).toBe(edited)

  expect((sqlite.prepare("SELECT count(*) n FROM chats").get() as { n: number }).n).toBe(1)
  expect(git(["worktree", "list", "--porcelain"])).toContain(
    first.worktreePath.replaceAll("\\", "/"),
  )
  sqlite.prepare("DELETE FROM projects WHERE id='local'").run()
  expect(
    (sqlite.prepare("SELECT count(*) n FROM record_task_worktrees").get() as { n: number }).n,
  ).toBe(0)
  expect(git(["worktree", "list", "--porcelain"])).toContain(
    first.worktreePath.replaceAll("\\", "/"),
  )
})
it("fails stale revisions and changed claims before any Git or chat creation", async () => {
  await expect(open({ ...input, expectedRevision: "b".repeat(64) })).rejects.toThrow("task changed")
  await expect(open({ ...input, claimId: "another-claim" })).rejects.toThrow("claim is stale")
  client.operation.mockResolvedValueOnce({
    path: input.path,
    recordId: input.recordId,
    revision: input.expectedRevision,
    readiness: { currentClaim: false, claim: { id: input.claimId } },
  })
  await expect(open(input)).rejects.toThrow("claim is stale")
  expect(create).not.toHaveBeenCalled()
  expect((sqlite.prepare("SELECT count(*) n FROM chats").get() as { n: number }).n).toBe(0)
})
it("recovers a worktree created before a crash without duplicating chats or Git mutations", async () => {
  create.mockImplementationOnce(async (repository, branch, path, base) => {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync("git", ["worktree", "add", path, "-b", branch, base], {
      cwd: repository,
      windowsHide: true,
      stdio: "pipe",
    })
    throw new Error("Simulated interruption after Git")
  })
  await expect(open(input)).rejects.toThrow("Simulated interruption")
  const pending = sqlite.prepare("SELECT worktree_path FROM record_task_worktrees").get() as {
    worktree_path: string
  }
  const marker = join(pending.worktree_path, "unowned.txt")
  writeFileSync(marker, "Preserve changed work")
  await expect(open(input)).rejects.toThrow("interrupted worktree changed")
  expect(
    sqlite
      .prepare("SELECT path FROM filesystem_root_registrations WHERE path=?")
      .get(pending.worktree_path),
  ).toBeUndefined()
  unlinkSync(marker)
  git(["switch", "-c", "other-base"])
  const recovered = await open(input)
  expect(recovered.chatId).toBeTruthy()
  expect(create).toHaveBeenCalledTimes(1)
  expect(
    (
      sqlite.prepare("SELECT base_branch FROM chats WHERE id=?").get(recovered.chatId) as {
        base_branch: string | null
      }
    ).base_branch,
  ).toBe("release/base")
  await expect(open({ ...input, localProjectId: "missing" })).rejects.toThrow("Select an active")
})
