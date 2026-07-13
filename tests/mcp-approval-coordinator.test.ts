import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createSqliteMcpApprovalCoordinator,
  decideMcpApproval,
  listPendingMcpApprovals,
} from "../src/main/lib/mcp-control/approval-coordinator"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import * as schema from "../src/main/lib/db/schema"

describe("MCP approval renderer coordination", () => {
  let directory: string
  let sqlite: Database.Database

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-approval-ui-"))
    sqlite = new Database(join(directory, "agents.db"))
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("publishes redacted context and resolves exactly once across processes", async () => {
    const database = drizzle(sqlite, { schema })
    const lifecycle = new McpApprovalLifecycle(createSqliteMcpApprovalCoordinator(database))
    const wait = lifecycle.request({
      id: "approval-1",
      invocationId: "invocation-1",
      caller: { chatId: "chat-1", runId: "run-1" },
      toolName: "archive_chat",
      tier: 2,
      input: { chatId: "chat-2", token: "sk_should_not_render" },
      timeoutMs: 2_000,
    })

    expect(listPendingMcpApprovals(database)).toMatchObject([
      {
        id: "approval-1",
        chatId: "chat-1",
        toolName: "archive_chat",
        risk: 2,
        targetLabel: expect.stringMatching(/^chatId: sha256:[a-f0-9]{64} bytes:6$/),
        inputSummary: expect.stringContaining("contextHash"),
      },
    ])
    expect(listPendingMcpApprovals(database)[0].inputSummary).not.toContain("sk_should_not_render")
    expect(
      decideMcpApproval(database, {
        id: "approval-1",
        decision: "approve",
        grantSession: true,
      }),
    ).toBe(true)
    expect(
      decideMcpApproval(database, {
        id: "approval-1",
        decision: "deny",
        grantSession: false,
      }),
    ).toBe(false)
    await expect(wait.decision).resolves.toMatchObject({ state: "approved", source: "user" })
    expect(listPendingMcpApprovals(database)).toEqual([])
    lifecycle.shutdown()
  })

  it("never reuses a durable decision after an approval id collision", async () => {
    const database = drizzle(sqlite, { schema })
    const first = new McpApprovalLifecycle(createSqliteMcpApprovalCoordinator(database))
    const original = first.request({
      id: "replayed-json-rpc-id",
      invocationId: "invocation-original",
      caller: { chatId: "chat-1", runId: "run-1" },
      toolName: "rename_item",
      tier: 2,
      input: { id: "chat-2", name: "Safe name" },
      timeoutMs: 2_000,
    })
    expect(
      decideMcpApproval(database, {
        id: "replayed-json-rpc-id",
        decision: "approve",
        grantSession: false,
      }),
    ).toBe(true)
    await expect(original.decision).resolves.toMatchObject({ state: "approved" })
    first.shutdown()

    const replay = new McpApprovalLifecycle(createSqliteMcpApprovalCoordinator(database))
    const mutated = replay.request({
      id: "replayed-json-rpc-id",
      invocationId: "invocation-mutated",
      caller: { chatId: "chat-1", runId: "run-1" },
      toolName: "archive_item",
      tier: 2,
      input: { id: "chat-3" },
      timeoutMs: 2_000,
    })
    await expect(mutated.decision).resolves.toMatchObject({
      state: "cancelled",
      source: "cancellation",
    })
    replay.shutdown()
  })

  it("shows bounded orchestration authority while hashing worker prose", () => {
    const database = drizzle(sqlite, { schema })
    const lifecycle = new McpApprovalLifecycle(createSqliteMcpApprovalCoordinator(database))
    lifecycle.request({
      id: "orchestration-approval",
      invocationId: "orchestration-invocation",
      caller: { chatId: "root-chat" },
      toolName: "orchestrate_task",
      tier: 3,
      timeoutMs: 2_000,
      input: orchestrationApprovalInput(),
    })

    const pending = listPendingMcpApprovals(database)[0]!
    const stored = JSON.parse(pending.inputSummary) as any
    expect(stored.summary).toMatchObject({
      task: { mode: "create", name: { byteLength: 14, sha256: expect.any(String) } },
      agentCount: 1,
      maxParallelAgents: 3,
      maxDepth: 5,
      stopConditions: {
        maxWallClockMs: 60_000,
        maxTotalTokens: 50_000,
        maxCostUsdMicros: 2_000_000,
        maxFailures: 2,
        maxBlockers: 3,
      },
      agents: [
        {
          role: { byteLength: 12, sha256: expect.any(String) },
          prompt: { byteLength: expect.any(Number), sha256: expect.any(String) },
          spec: { byteLength: expect.any(Number), sha256: expect.any(String) },
          completionCriteria: { byteLength: expect.any(Number), sha256: expect.any(String) },
          harness: "codex",
          provider: "openai",
          model: { byteLength: 11, sha256: expect.any(String) },
          reasoningEffort: "high",
          permissionMode: "custom",
          capabilityFlags: {
            projectWrite: true,
            shell: true,
            network: false,
            git: true,
            browser: false,
            secrets: false,
            subagents: true,
            thirdPartyMcp: false,
            productMcpRead: true,
            productMcpWrite: true,
            productMcpTier3: false,
          },
          worktreeStrategy: "attached-branch",
        },
      ],
    })
    for (const secret of [
      "Finish secrets",
      "release-lead",
      "Bearer prompt-secret",
      "spec-secret",
      "criteria-secret",
      "codex-secret-branch",
    ]) {
      expect(pending.inputSummary).not.toContain(secret)
    }
    lifecycle.shutdown()
  })
})

function orchestrationApprovalInput() {
  return {
    projectId: "project-1",
    task: { mode: "create" as const, name: "Finish secrets" },
    initiatingChatId: "root-chat",
    maxParallelAgents: 3,
    maxDepth: 5,
    stopConditions: {
      maxWallClockMs: 60_000,
      maxTotalTokens: 50_000,
      maxCostUsdMicros: 2_000_000,
      maxFailures: 2,
      maxBlockers: 3,
    },
    agents: [
      {
        agentId: "worker-1",
        role: "release-lead",
        name: "Release lead",
        prompt: "Bearer prompt-secret",
        spec: "spec-secret",
        harness: "codex" as const,
        provider: "openai",
        model: "gpt-5-codex",
        reasoningEffort: "high" as const,
        permissionMode: "custom" as const,
        customPermissions: {
          schemaVersion: 1 as const,
          projectWrite: true,
          shell: true,
          network: false,
          git: true,
          browser: false,
          secrets: false,
          subagents: true,
          thirdPartyMcp: false,
          productMcpRead: true,
          productMcpWrite: true,
          productMcpTier3: false,
        },
        worktreeStrategy: "attached-branch" as const,
        branch: "codex-secret-branch",
        dependencyAgentIds: [],
        completionCriteria: "criteria-secret",
      },
    ],
  }
}
