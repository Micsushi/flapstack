import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, realpathSync, statSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { RecordsPlanPairService } from "../src/main/lib/project-records/plan-pair"
import type { ProjectRecordsClient } from "../src/main/lib/project-records/client"
import type { ProjectPlanSnapshot } from "../src/shared/plan-sources"
import { shouldAutoGenerateInitialResponse } from "../src/renderer/features/agents/main/chat-message-hydration"

vi.mock("../src/main/lib/project-records/plan-promotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/lib/project-records/plan-promotion")>()),
  proposePlanCandidate: vi.fn(async (_client, _snapshot, _input, receiptId) => ({
    proposalId: `proposal-${receiptId}`,
    version: 1,
  })),
}))
let sqlite: Database.Database, directory: string
let receipt: any, failBefore: boolean, loseResponse: boolean, offline: boolean
let commits: number
let disconnectAfterCommit: boolean
let archiveAfterCommit: boolean
const input = {
  reference: {
    sourceProjectId: "local",
    sourceId: "source",
    sourcePath: "plan.md",
    sourceFingerprint: "source-hash",
    candidateId: "candidate",
    candidateFingerprint: "candidate-hash",
  },
  destinationPath: "lanes/vault/tasks.md",
  projectId: "app",
  localProjectId: "local",
}
const snapshot = (): ProjectPlanSnapshot => ({
  projectId: "local",
  rootPath: directory,
  fingerprint: "root-hash",
  limitations: [],
  sources: [
    {
      id: "source",
      type: "markdown",
      path: "plan.md",
      fingerprint: "source-hash",
      stale: false,
      status: "current",
      limitations: [],
      errors: [],
      candidates: [
        {
          id: "candidate",
          fingerprint: "candidate-hash",
          kind: "checklist",
          title: "Keep answers",
          body: "Acceptance: reopening retains answers",
          path: "plan.md",
          line: 3,
          depth: 1,
          parentId: null,
          completed: false,
        },
      ],
    },
  ],
})
const client = {
  endpoint: "http://127.0.0.1:1234",
  read: vi.fn(async () => ({ revision: "a".repeat(64) })),
  operation: vi.fn(async (path: string, payload: any) => {
    if (offline) throw new Error("offline")
    const operation = path.split("/").at(-1)
    if (operation === "read") return receipt ?? { status: "absent", proposalId: payload.proposalId }
    if (operation === "prepare")
      return (receipt ??= {
        status: "prepared",
        proposalId: payload.proposalId,
        taskId: "TASK-pair",
        chatPair: payload.chatPair,
      })
    if (operation === "abort") {
      if (receipt.status !== "committed") receipt.status = "aborted"
      return receipt
    }
    if (operation === "commit") {
      if (failBefore) throw new Error("stale destination")
      if (receipt.status !== "committed") {
        commits++
        receipt.status = "committed"
      }
      if (archiveAfterCommit)
        sqlite.prepare("UPDATE projects SET archived_at=1 WHERE id='local'").run()
      if (loseResponse) {
        loseResponse = false
        offline = disconnectAfterCommit
        throw new Error("lost response")
      }
      return receipt
    }
    throw new Error("Unexpected operation")
  }),
} as unknown as ProjectRecordsClient
const service = () => new RecordsPlanPairService(sqlite, client)
const confirm = async () => {
  const current = service()
  const preview = await current.preview(snapshot(), input)
  return current.confirm(snapshot(), { ...input, expectedTarget: preview.expectedTarget })
}
const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-plan-pair-")))
  sqlite = new Database(join(directory, "fixture.db"))
  sqlite.pragma("foreign_keys = ON")
  migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") })
  sqlite.prepare("INSERT INTO projects(id,name,path) VALUES('local','Fixture',?)").run(directory)
  const stat = statSync(directory, { bigint: true })
  sqlite
    .prepare(
      "INSERT INTO filesystem_root_registrations(path,canonical_path,device_id,inode_id,bound_at) VALUES(?,?,?,?,0)",
    )
    .run(directory, directory, String(stat.dev), String(stat.ino))
  receipt = undefined
  failBefore = false
  loseResponse = false
  offline = false
  commits = 0
  disconnectAfterCommit = false
  archiveAfterCommit = false
  vi.clearAllMocks()
  vi.mocked(client.read)
    .mockReset()
    .mockResolvedValue({ revision: "a".repeat(64) } as never)
})
afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

it("concurrent confirmation creates one canonical pair and idle context; reopen preserves user history", async () => {
  const beforeFiles = readdirSync(directory)
  const [first, duplicate] = await Promise.all([confirm(), confirm()])
  expect(first).toEqual(duplicate)
  expect(commits).toBe(1)
  expect(count("chats")).toBe(1)
  expect(count("sub_chats")).toBe(1)
  expect(count("agent_runs")).toBe(0)
  expect(count("tasks")).toBe(0)
  const sub = sqlite.prepare("SELECT * FROM sub_chats").get() as any
  expect(sub.session_id).toBeNull()
  expect(sub.stream_id).toBeNull()
  expect(sub.run_status).toBeNull()
  expect(sub.messages).toContain("Acceptance: reopening retains answers")
  expect(sub.messages).toContain("TASK-pair")
  expect(sub.messages).toContain("grants no authority")
  expect(
    shouldAutoGenerateInitialResponse({
      messages: JSON.parse(sub.messages),
      pendingInitialGeneration: false,
      status: "ready",
      streamId: null,
    }),
  ).toBe(false)
  sqlite.prepare("UPDATE sub_chats SET messages='[]'").run()
  expect(await confirm()).toEqual(first)
  expect((sqlite.prepare("SELECT messages FROM sub_chats").get() as any).messages).toBe("[]")
  expect(readdirSync(directory)).toEqual(beforeFiles)
})

it("rejects a stale reviewed target or missing registered checkout before preparing", async () => {
  await expect(
    service().confirm(snapshot(), { ...input, expectedTarget: "0".repeat(64) }),
  ).rejects.toThrow("changed")
  sqlite.prepare("DELETE FROM filesystem_root_registrations").run()
  await expect(confirm()).rejects.toThrow("durable filesystem identity")
  expect(client.operation).not.toHaveBeenCalled()
  expect(count("chats")).toBe(0)
})

it("precommit failure aborts the prepared pair without any local Chat", async () => {
  failBefore = true
  await expect(confirm()).rejects.toThrow("cancelled")
  expect(receipt.status).toBe("aborted")
  expect(count("chats")).toBe(0)
  expect(count("agent_runs")).toBe(0)
})

it("lost commit response reconciles the original receipt without another task", async () => {
  loseResponse = true
  await confirm()
  expect(commits).toBe(1)
  expect(count("chats")).toBe(1)
})

it("committed task plus local insert failure recovers the exact reserved Chat after restart", async () => {
  sqlite.exec(
    "CREATE TRIGGER fail_chat BEFORE INSERT ON chats BEGIN SELECT RAISE(ABORT,'injected materialization failure'); END",
  )
  await expect(confirm()).rejects.toThrow("Task is committed")
  expect(commits).toBe(1)
  expect(count("chats")).toBe(0)
  expect(count("sub_chats")).toBe(0)
  const reserved = receipt.chatPair.chatId
  sqlite.exec("DROP TRIGGER fail_chat")
  sqlite.close()
  sqlite = new Database(join(directory, "fixture.db"))
  sqlite.pragma("foreign_keys = ON")
  expect((await service().recover())[0]?.recovered).toBe(true)
  expect((sqlite.prepare("SELECT id FROM chats").get() as any).id).toBe(reserved)
  expect(commits).toBe(1)
  expect(count("agent_runs")).toBe(0)
})

it("reopens the same committed pair after destination revision changes, without source re-evaluation", async () => {
  const first = await confirm()
  vi.mocked(client.read).mockResolvedValueOnce({ revision: "b".repeat(64) } as never)
  expect(await service().reopen(input)).toEqual(first)
  expect(commits).toBe(1)
  sqlite.prepare("DELETE FROM chats WHERE id=?").run(first.chatId)
  await expect(service().reopen(input)).rejects.toThrow("was removed")
  expect(count("chats")).toBe(0)
})

it("blocks project deletion only while pending, then permits normal deletion after recovery", async () => {
  sqlite.exec(
    "CREATE TRIGGER fail_chat BEFORE INSERT ON chats BEGIN SELECT RAISE(ABORT,'injected'); END",
  )
  await expect(confirm()).rejects.toThrow("recovering")
  expect(() => sqlite.prepare("DELETE FROM projects WHERE id='local'").run()).toThrow(
    "pending Task/Chat pair",
  )
  sqlite.exec("DROP TRIGGER fail_chat")
  await service().recover()
  sqlite.prepare("DELETE FROM projects WHERE id='local'").run()
  expect(count("chats")).toBe(0)
  expect(count("records_plan_pairs")).toBe(1)
})

it("unknown postcommit response keeps Chat hidden until reconnecting to its receipt", async () => {
  loseResponse = true
  disconnectAfterCommit = true
  await expect(confirm()).rejects.toThrow("recovery is pending")
  expect(commits).toBe(1)
  expect(count("chats")).toBe(0)
  expect(count("agent_runs")).toBe(0)
  offline = false
  expect((await service().recover())[0]?.recovered).toBe(true)
  expect(commits).toBe(1)
  expect(count("chats")).toBe(1)
})

it("local preparation failure never approves a task and retry creates only one pair", async () => {
  sqlite.exec(
    "CREATE TRIGGER fail_pair BEFORE INSERT ON records_plan_pairs BEGIN SELECT RAISE(ABORT,'injected pending failure'); END",
  )
  await expect(confirm()).rejects.toThrow("injected pending failure")
  expect(client.operation).not.toHaveBeenCalled()
  expect(count("chats")).toBe(0)
  sqlite.exec("DROP TRIGGER fail_pair")
  await confirm()
  expect(commits).toBe(1)
  expect(count("chats")).toBe(1)
})

it("a removed conversation cannot return a dangling reserved pair", async () => {
  const first = await confirm()
  sqlite.prepare("DELETE FROM sub_chats WHERE id=?").run(first.subChatId)
  await expect(service().reopen(input)).rejects.toThrow("conversation was removed")
  expect(count("chats")).toBe(1)
  expect(count("sub_chats")).toBe(0)
  expect(commits).toBe(1)
})

it("postcommit project changes defer materialization until the reviewed project is restored", async () => {
  archiveAfterCommit = true
  await expect(confirm()).rejects.toThrow("Task is committed")
  expect(count("chats")).toBe(0)
  expect(commits).toBe(1)
  archiveAfterCommit = false
  sqlite.prepare("UPDATE projects SET archived_at=NULL WHERE id='local'").run()
  expect((await service().recover())[0]?.recovered).toBe(true)
  expect(count("chats")).toBe(1)
  expect(commits).toBe(1)
})

it("a conversation reassigned to another Chat cannot be returned as the original pair", async () => {
  const first = await confirm()
  sqlite.prepare("INSERT INTO chats(id,project_id,name) VALUES('other-chat','local','Other')").run()
  sqlite.prepare("UPDATE sub_chats SET chat_id='other-chat' WHERE id=?").run(first.subChatId)
  await expect(service().reopen(input)).rejects.toThrow("association changed")
  expect(commits).toBe(1)
  expect(count("sub_chats")).toBe(1)
})
