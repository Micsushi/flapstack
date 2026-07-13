import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  it("stores redacted immutable snapshots and lists records", () => {
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

  it("upgrades an actual Stage 2 migration state with safe exposure and audit defaults", () => {
    const stage2Migrations = join(directory, "stage2-migrations")
    const sourceMigrations = resolve(process.cwd(), "drizzle")
    mkdirSync(join(stage2Migrations, "meta"), { recursive: true })

    const journal = JSON.parse(
      readFileSync(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
    ) as { version: string; dialect: string; entries: Array<{ idx: number; tag: string }> }
    const stage2Journal = {
      ...journal,
      entries: journal.entries.filter((entry) => entry.idx <= 15),
    }
    writeFileSync(
      join(stage2Migrations, "meta", "_journal.json"),
      `${JSON.stringify(stage2Journal, null, 2)}\n`,
    )
    for (const entry of stage2Journal.entries) {
      cpSync(join(sourceMigrations, `${entry.tag}.sql`), join(stage2Migrations, `${entry.tag}.sql`))
    }

    const upgradePath = join(directory, "stage2-upgrade.db")
    const upgradeDb = new Database(upgradePath)
    try {
      const upgradeDrizzle = drizzle(upgradeDb, { schema })
      migrate(upgradeDrizzle, { migrationsFolder: stage2Migrations })
      upgradeDb
        .prepare(
          "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('stage2-chat', 'Existing', 'global', 'read-only')",
        )
        .run()

      migrate(upgradeDrizzle, { migrationsFolder: sourceMigrations })

      expect(
        upgradeDb
          .prepare(
            "SELECT mcp_exposure_enabled, custom_permissions FROM chats WHERE id = 'stage2-chat'",
          )
          .get(),
      ).toEqual({ mcp_exposure_enabled: 0, custom_permissions: null })
      expect(
        upgradeDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_audit_records'",
          )
          .get(),
      ).toEqual({ name: "mcp_audit_records" })
      expect(
        upgradeDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'mcp_audit_records_no_delete'",
          )
          .get(),
      ).toEqual({ name: "mcp_audit_records_no_delete" })
    } finally {
      upgradeDb.close()
    }
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
      providerKeys: "sk-proj-projectsecret sk-ant-anthropicsecret",
      env: "OPENAI_API_KEY=environment-secret\nNORMAL=value",
      basic: "Basic dXNlcjpwYXNz",
      url: "https://user:password@example.test/v1?token=query-secret#fragment",
      nested: { arbitrary: ".env SECRET_TOKEN=deep-secret" },
    })
    expect(summary).toContain("[REDACTED]")
    expect(summary).not.toContain("top-secret")
    expect(summary).not.toContain("never persist")
    expect(summary).not.toContain("abc123")
    expect(summary).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz")
    for (const secret of [
      "projectsecret",
      "anthropicsecret",
      "environment-secret",
      "dXNlcjpwYXNz",
      "password",
      "query-secret",
      "deep-secret",
    ]) {
      expect(summary).not.toContain(secret)
    }
  })

  it("stores attachment name, size, and hash without durable contentText", () => {
    const contentText = "sk-proj-never-persist\nTOKEN=also-never-persist"
    appendMcpAuditRecord(drizzle(sqlite, { schema }), {
      id: "attachment-audit",
      status: "allowed",
      caller: { chatId: "chat-1" },
      toolName: "add_attachment",
      tier: 1,
      input: { chatId: "chat-1", name: ".env", kind: "text", contentText },
    })
    const row = sqlite
      .prepare("SELECT input_summary FROM mcp_audit_records WHERE id = ?")
      .get("attachment-audit") as { input_summary: string }
    expect(row.input_summary).toContain("byteLength")
    expect(row.input_summary).toContain("sha256")
    expect(row.input_summary).toContain(".env")
    expect(row.input_summary).not.toContain(contentText)
    expect(row.input_summary).not.toContain("never-persist")
  })
})
