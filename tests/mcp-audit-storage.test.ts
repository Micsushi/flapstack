import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  appendMcpAuditRecord,
  redactMcpAuditSummary,
} from "../src/main/lib/mcp-control/audit-storage"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-audit-"))
  sqlite = new Database(join(directory, "agents.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP audit storage", () => {
  it("migrates a Stage 2 database, stores redacted immutable snapshots, and lists records", () => {
    appendMcpAuditRecord(drizzle(sqlite, { schema }), {
      id: "audit-1",
      status: "approval-required",
      caller: {
        chatId: "chat-1",
        runId: "run-1",
        permissionMode: "custom",
        customPermissions: { edit: true },
      },
      toolName: "create_thread",
      tier: 3,
      chatSnapshot: { id: "chat-1", name: "MCP work", apiKey: "sk_live_should_not_persist" },
      runSnapshot: { id: "run-1", status: "running", reasoning: "private thoughts" },
      input: { authorization: "Bearer very-secret", nested: { refreshToken: "refresh-secret" } },
      result: { message: "waiting for approval" },
      createdAt: new Date("2026-07-12T00:00:00.000Z"),
    })

    const row = sqlite
      .prepare("SELECT * FROM mcp_audit_records WHERE id = ?")
      .get("audit-1") as Record<string, string | number | null>
    expect(row).toMatchObject({
      status: "approval-required",
      caller_chat_id: "chat-1",
      caller_run_id: "run-1",
      tool_name: "create_thread",
      tier: 3,
    })
    const stored = JSON.stringify(row)
    expect(stored).not.toContain("very-secret")
    expect(stored).not.toContain("sk_live_should_not_persist")
    expect(stored).not.toContain("private thoughts")
    expect(
      sqlite.prepare("SELECT id FROM mcp_audit_records ORDER BY created_at DESC").all(),
    ).toEqual([{ id: "audit-1" }])
  })

  it("rejects updates and deletes so records remain append-only", () => {
    appendMcpAuditRecord(drizzle(sqlite, { schema }), {
      id: "audit-immutable",
      status: "denied",
      caller: { chatId: "chat-1" },
      toolName: "rename_chat",
      tier: 1,
    })
    expect(() => sqlite.prepare("UPDATE mcp_audit_records SET status = 'completed'").run()).toThrow(
      /append-only/i,
    )
    expect(() => sqlite.prepare("DELETE FROM mcp_audit_records").run()).toThrow(/append-only/i)
  })

  it("redacts credential-like keys, hidden reasoning, and bounded secret-looking strings", () => {
    const summary = redactMcpAuditSummary({
      token: "top-secret",
      hiddenReasoning: "never persist",
      prose: "Authorization: Bearer abc123",
      gitHub: "ghp_abcdefghijklmnopqrstuvwxyz",
    })
    expect(summary).toContain("[REDACTED]")
    expect(summary).not.toContain("top-secret")
    expect(summary).not.toContain("never persist")
    expect(summary).not.toContain("abc123")
    expect(summary).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz")
  })
})
