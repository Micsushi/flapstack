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
        targetLabel: "chatId: chat-2",
        inputSummary: expect.stringContaining("[REDACTED]"),
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
})
