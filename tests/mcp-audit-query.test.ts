import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  appendMcpAuditRecord,
  listMcpAuditRecords,
} from "../src/main/lib/mcp-control/audit-storage"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-audit-query-"))
  sqlite = new Database(join(directory, "agents.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

function append(id: string, input: Parameters<typeof appendMcpAuditRecord>[1]) {
  appendMcpAuditRecord(drizzle(sqlite, { schema }), { id, ...input })
}

describe("MCP audit query", () => {
  beforeEach(() => {
    append("audit-1", {
      status: "allowed",
      caller: { chatId: "chat-claude", runId: "run-1" },
      toolName: "list_projects",
      tier: 0,
      input: { token: "never-return" },
      createdAt: new Date("2026-07-12T10:00:00.000Z"),
    })
    append("audit-2", {
      status: "completed",
      caller: { chatId: "chat-claude", runId: "run-1" },
      toolName: "list_projects",
      tier: 0,
      result: { reasoning: "never-return" },
      createdAt: new Date("2026-07-12T10:01:00.000Z"),
    })
    append("audit-3", {
      status: "denied",
      caller: { chatId: "chat-codex", runId: "run-2" },
      toolName: "create_chat",
      tier: 3,
      createdAt: new Date("2026-07-12T10:02:00.000Z"),
    })
    append("audit-4", {
      status: "failed",
      caller: { chatId: "chat-codex", runId: "run-2" },
      toolName: "create_chat",
      tier: 3,
      createdAt: new Date("2026-07-12T10:02:00.000Z"),
    })
  })

  it("filters by caller, tool, decision, and inclusive time bounds", () => {
    const db = drizzle(sqlite, { schema })
    expect(
      listMcpAuditRecords(db, {
        callerChatId: "chat-claude",
        toolName: "list_projects",
        decision: "completed",
        from: new Date("2026-07-12T10:01:00.000Z"),
        to: new Date("2026-07-12T10:01:00.000Z"),
      }).entries.map((entry) => entry.id),
    ).toEqual(["audit-2"])
  })

  it("uses a stable newest-first cursor with no hidden first-page ceiling", () => {
    const db = drizzle(sqlite, { schema })
    const first = listMcpAuditRecords(db, { limit: 2 })
    const second = listMcpAuditRecords(db, { cursor: first.nextCursor!, limit: 100 })

    expect(first.entries.map((entry) => entry.id)).toEqual(["audit-4", "audit-3"])
    expect(second.entries.map((entry) => entry.id)).toEqual(["audit-2", "audit-1"])
    expect(second.nextCursor).toBeNull()
  })

  it("returns only redacted detail summaries, never raw audit payload fields", () => {
    const entry = listMcpAuditRecords(drizzle(sqlite, { schema }), {
      decision: "completed",
    }).entries[0]!

    expect(entry).toMatchObject({
      detail: {
        callerSummary: expect.any(String),
        chatSummary: expect.any(String),
        runSummary: expect.any(String),
        inputSummary: expect.any(String),
        resultSummary: expect.any(String),
      },
    })
    expect(JSON.stringify(entry)).not.toContain("never-return")
    expect(entry.detail.resultSummary).toContain("[REDACTED]")
    expect(entry).not.toHaveProperty("input")
    expect(entry).not.toHaveProperty("result")
  })
})
