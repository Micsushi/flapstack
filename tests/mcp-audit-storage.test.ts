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
    const secretCorpus = [
      "AKIAIOSFODNN7EXAMPLE",
      "/tmp/client-secret-plain-value",
      "xoxb-123456789-secret",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "AIzaSyD-example-google-key",
      "-----BEGIN PRIVATE KEY----- secret-material",
      "postgres://user:password@example.test/database",
      "https://example.test/callback/client-secret-plain-value",
    ]
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
      corpus: secretCorpus,
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
      ...secretCorpus,
    ]) {
      expect(summary).not.toContain(secret)
    }
    expect(summary).toContain("sha256")
  })
})
