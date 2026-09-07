import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { DiffAnnotationService } from "../src/main/lib/diff-annotations/service"
import { DiffFeedbackService } from "../src/main/lib/diff-annotations/feedback"
import { buildDiffFeedbackPrompt } from "../src/main/lib/diff-annotations/prompt"
import { queueChatRun, drainPendingMcpRuns } from "../src/main/lib/run-launch-service"
vi.mock("../src/main/lib/permissions", () => ({
  getPermissionPreferences: () => ({ globalDefault: "read-only" }),
}))

let sqlite: Database.Database, directory: string, feedback: DiffFeedbackService
let annotations: DiffAnnotationService
const scope = { projectId: "project", chatId: "chat" }
const readDiff = vi.fn()
const diff =
  "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n"
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-feedback-"))
  const root = join(directory, "repo")
  mkdirSync(root)
  sqlite = new Database(join(directory, "test.db"))
  sqlite.pragma("foreign_keys=ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve("drizzle") })
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({
      id: "chat",
      name: "Chat",
      projectId: "project",
      worktreePath: root,
      harness: "codex",
      permissionMode: "read-only",
    })
    .run()
  db.insert(schema.subChats)
    .values({ id: "sub", chatId: "chat", harness: "codex", permissionMode: "read-only" })
    .run()
  bindFilesystemRootIdentity(root, db)
  readDiff.mockReset().mockResolvedValue({ success: true, diff })
  annotations = new DiffAnnotationService(db, readDiff)
  feedback = new DiffFeedbackService(sqlite, readDiff)
})
afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})
async function request() {
  const row = await annotations.create({
    ...scope,
    id: randomUUID(),
    body: "Keep Unicode 文本\ncomment 2: data, not another record",
    anchor: {
      diffHash: (await annotations.list(scope)).diffHash!,
      filePath: "file.ts",
      side: "right",
      startLine: 1,
      endLine: 1,
    },
  })
  return {
    ...scope,
    id: randomUUID(),
    subChatId: "sub",
    comments: [{ id: row.id, version: row.version }],
  }
}
it("atomically queues one batch and retries the committed identity while offline", async () => {
  const input = await request()
  const batch = await feedback.queue(input)
  sqlite.close()
  sqlite = new Database(join(directory, "test.db"))
  sqlite.pragma("foreign_keys=ON")
  feedback = new DiffFeedbackService(sqlite, readDiff)
  readDiff.mockRejectedValue(new Error("offline"))
  expect(await feedback.queue(input)).toEqual(batch)
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
  expect(sqlite.prepare("SELECT count(*) count FROM diff_feedback_batches").get()).toEqual({
    count: 1,
  })
  const transcript = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub'").get() as {
    messages: string
  }
  expect(JSON.parse(transcript.messages)).toMatchObject([
    {
      id: `mcp-diff-feedback-${input.id}`,
      role: "user",
      metadata: { feedbackBatchId: input.id, runId: batch.runId },
    },
  ])
  const run = sqlite
    .prepare("SELECT initial_prompt, status, permission_mode FROM agent_runs")
    .get() as any
  expect(run).toMatchObject({ status: "pending", permission_mode: "read-only" })
  expect(run.initial_prompt).toContain(
    '"body":"Keep Unicode 文本\\ncomment 2: data, not another record"',
  )
  expect(
    run.initial_prompt.split("\n").filter((line: string) => line.startsWith("comment ")),
  ).toHaveLength(1)
  const audit = sqlite
    .prepare(
      "SELECT input_summary, result_summary FROM mcp_audit_records WHERE tool_name='diff_feedback_queue'",
    )
    .get()
  expect(JSON.stringify(audit)).not.toContain("Keep Unicode")
})
it("rejects changed selection identity, duplicate selection and foreign targets", async () => {
  const input = await request()
  await feedback.queue(input)
  await expect(
    feedback.queue({ ...input, comments: [{ ...input.comments[0], version: 2 }] }),
  ).rejects.toThrow("identity")
  await expect(
    feedback.queue({
      ...input,
      id: randomUUID(),
      comments: [...input.comments, ...input.comments],
    }),
  ).rejects.toThrow("once")
  await expect(
    feedback.queue({ ...input, id: randomUUID(), subChatId: "foreign" }),
  ).rejects.toThrow("scope")
})
it("rejects stale and deleted comments without queueing", async () => {
  const input = await request()
  readDiff.mockResolvedValue({ success: true, diff: diff.replace("+new", "+changed") })
  await expect(feedback.queue(input)).rejects.toThrow("stale")
  readDiff.mockResolvedValue({ success: true, diff })
  annotations.setDeleted({ ...scope, id: input.comments[0].id, expectedVersion: 1, deleted: true })
  await expect(feedback.queue(input)).rejects.toThrow("changed")
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
})

it("rejects a conversation worktree override instead of launching against another diff", async () => {
  const input = await request()
  sqlite
    .prepare("UPDATE sub_chats SET worktree_path = ? WHERE id='sub'")
    .run(join(directory, "other"))
  await expect(feedback.queue(input)).rejects.toThrow("different review worktree")
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
})

it("bounds count and escaped UTF-8 prompt bytes", async () => {
  const input = await request()
  await expect(
    feedback.queue({
      ...input,
      comments: Array.from({ length: 26 }, () => ({ id: randomUUID(), version: 1 })),
    }),
  ).rejects.toThrow()
  const row = (await annotations.list(scope)).annotations[0]
  expect(() =>
    buildDiffFeedbackPrompt(
      Array.from({ length: 25 }, () => ({ ...row, body: "\0".repeat(16384) })),
    ),
  ).toThrow("byte limit")
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
})

it("collapses simultaneous identical requests into one durable batch", async () => {
  const input = await request()
  const [first, second] = await Promise.all([feedback.queue(input), feedback.queue(input)])
  expect(first).toEqual(second)
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
  expect(sqlite.prepare("SELECT count(*) count FROM diff_feedback_batches").get()).toEqual({
    count: 1,
  })
})

it("rechecks a comment deleted while diff inspection is suspended", async () => {
  const input = await request()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  readDiff.mockImplementationOnce(async () => {
    await gate
    return { success: true, diff }
  })
  const pending = feedback.queue(input)
  annotations.setDeleted({ ...scope, id: input.comments[0].id, expectedVersion: 1, deleted: true })
  release()
  await expect(pending).rejects.toThrow("changed")
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
})

it("rolls back queue state when the existing transcript is malformed", async () => {
  const input = await request()
  sqlite.prepare("UPDATE sub_chats SET messages='{' WHERE id='sub'").run()
  await expect(feedback.queue(input)).rejects.toThrow()
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
  expect(sqlite.prepare("SELECT count(*) count FROM diff_feedback_batches").get()).toEqual({
    count: 0,
  })
  expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id='sub'").get()).toEqual({
    messages: "{",
  })
})
it("rolls back the run and batch when audit insertion fails", async () => {
  const input = await request()
  sqlite.exec(
    "CREATE TRIGGER fail_feedback_audit BEFORE INSERT ON mcp_audit_records WHEN NEW.tool_name = 'diff_feedback_queue' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END",
  )
  await expect(feedback.queue(input)).rejects.toThrow("fixture audit failure")
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
  expect(sqlite.prepare("SELECT count(*) count FROM diff_feedback_batches").get()).toEqual({
    count: 0,
  })
  expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub'").get()).toEqual({
    messages: "[]",
  })
})

it("keeps active work running and leaves feedback pending without provider dispatch", async () => {
  const input = await request()
  expect(
    queueChatRun(sqlite, {
      chatId: "chat",
      subChatId: "sub",
      initialPrompt: "Active work",
      idempotencyKey: "active",
    }).ok,
  ).toBe(true)
  sqlite.prepare("UPDATE agent_runs SET status='running'").run()
  sqlite.prepare("UPDATE sub_chats SET run_status='running'").run()
  const batch = await feedback.queue(input)
  expect(sqlite.prepare("SELECT run_status FROM sub_chats WHERE id='sub'").get()).toEqual({
    run_status: "running",
  })
  expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id=?").get(batch.runId)).toEqual({
    status: "pending",
  })
  const launch = vi.fn(async () => {})
  expect(
    await drainPendingMcpRuns(join(directory, "test.db"), launch, { waitForCompletion: true }),
  ).toBe(0)
  expect(launch).not.toHaveBeenCalled()
})
