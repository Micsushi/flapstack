import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendMcpAuditRecord,
  findUnresolvedMcpDispatch,
} from "../src/main/lib/mcp-control/audit-storage"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let sqlite: Database.Database

const caller = { chatId: "chat-1", runId: "run-1", permissionMode: "ask-before-edits" as const }
const createChat = getMcpControlTool("create_chat")!
const originalStatus = createChat.status

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-invocation-audit-"))
  sqlite = new Database(join(directory, "agents.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  createChat.status = "implemented"
})

afterEach(() => {
  createChat.status = originalStatus
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

function dependencies(invocationId: string) {
  return {
    invocationId: () => invocationId,
    audit: {
      append: (record: Parameters<typeof appendMcpAuditRecord>[1]) =>
        appendMcpAuditRecord(drizzle(sqlite, { schema }), record),
      findUnresolvedDispatch: (lookup: Parameters<typeof findUnresolvedMcpDispatch>[1]) =>
        findUnresolvedMcpDispatch(drizzle(sqlite, { schema }), lookup),
    },
  }
}

function statuses(invocationId: string): string[] {
  return (
    sqlite
      .prepare("SELECT status FROM mcp_audit_records WHERE invocation_id = ? ORDER BY rowid")
      .all(invocationId) as Array<{ status: string }>
  ).map((row) => row.status)
}

describe("MCP invocation audit", () => {
  it("persists correlated append-only gate, approval, stale, failure, and completion events", async () => {
    await expect(
      invokeMcpControlTool(
        "ping",
        caller,
        { token: "never-store" },
        undefined,
        dependencies("completed"),
      ),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      invokeMcpControlTool(
        "create_chat",
        { ...caller, permissionMode: "read-only" },
        {},
        undefined,
        dependencies("denied"),
      ),
    ).resolves.toMatchObject({ ok: false })

    const deniedApprovals = new McpApprovalLifecycle()
    const denied = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      ...dependencies("approval-denied"),
      approvals: deniedApprovals,
      approvalId: () => "approval-denied",
    })
    deniedApprovals.deny("approval-denied")
    await denied
    deniedApprovals.shutdown()

    vi.useFakeTimers()
    const timedOutApprovals = new McpApprovalLifecycle()
    const timedOut = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      ...dependencies("timed-out"),
      approvals: timedOutApprovals,
      approvalId: () => "timed-out",
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await timedOut
    timedOutApprovals.shutdown()
    vi.useRealTimers()

    const staleApprovals = new McpApprovalLifecycle()
    const stale = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      ...dependencies("stale"),
      approvals: staleApprovals,
      approvalId: () => "stale",
      resolveCaller: vi
        .fn()
        .mockReturnValueOnce(caller)
        .mockImplementationOnce(() => {
          throw new Error("run ended")
        }),
    })
    staleApprovals.approve("stale")
    await stale
    staleApprovals.shutdown()

    await expect(
      invokeMcpControlTool("ping", caller, {}, undefined, {
        ...dependencies("failed"),
        execute: () => ({ ok: false, error: { code: "internal-error", message: "write failed" } }),
      }),
    ).resolves.toMatchObject({ ok: false })

    const grants = new McpApprovalLifecycle()
    const grantSource = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      ...dependencies("grant-source"),
      approvals: grants,
      approvalId: () => "grant-source",
      resolveTarget: () => ({}),
      execute: () => ({ ok: true, data: { created: false } }),
    })
    grants.approve("grant-source", { grantSession: true })
    await grantSource
    await expect(
      invokeMcpControlTool("create_chat", caller, {}, undefined, {
        ...dependencies("session-grant"),
        approvals: grants,
        approvalId: () => "session-grant",
        resolveTarget: () => ({}),
        execute: () => ({ ok: true, data: { created: false } }),
      }),
    ).resolves.toMatchObject({ ok: true })
    grants.shutdown()

    expect(statuses("completed")).toEqual(["allowed", "dispatch-started", "completed"])
    expect(statuses("denied")).toEqual(["denied"])
    expect(statuses("approval-denied")).toEqual(["approval-required", "denied"])
    expect(statuses("timed-out")).toEqual(["approval-required", "timed-out"])
    expect(statuses("stale")).toEqual(["approval-required", "stale"])
    expect(statuses("failed")).toEqual(["allowed", "dispatch-started", "failed"])
    expect(statuses("session-grant")).toEqual([
      "approval-required",
      "allowed",
      "dispatch-started",
      "completed",
    ])

    const persisted = sqlite
      .prepare("SELECT invocation_id, duration_ms, input_summary FROM mcp_audit_records")
      .all() as Array<{ invocation_id: string; duration_ms: number; input_summary: string }>
    expect(persisted).toHaveLength(21)
    expect(persisted.every((row) => row.invocation_id.length > 0 && row.duration_ms >= 0)).toBe(
      true,
    )
    expect(JSON.stringify(persisted)).not.toContain("never-store")
    const grantAudit = JSON.stringify(
      sqlite
        .prepare("SELECT result_summary FROM mcp_audit_records WHERE invocation_id = ?")
        .all("session-grant"),
    )
    expect(grantAudit).not.toContain("session-grant")
    expect(grantAudit).toContain("sha256")
  })

  it.each(["disk full", "no such table", "database is locked"])(
    "blocks every tier before dispatch when audit persistence fails: %s",
    async (message) => {
      for (const [toolName, input] of [
        ["ping", {}],
        ["pin_item", { kind: "chat", id: "chat-2", pinned: true }],
      ] as const) {
        const execute = vi.fn(() => ({ ok: true as const, data: { mutated: true } }))
        await expect(
          invokeMcpControlTool(
            toolName,
            { ...caller, permissionMode: "full-access" },
            input,
            undefined,
            {
              audit: {
                append: () => {
                  throw new Error(message)
                },
              },
              resolveTarget: () => ({}),
              execute,
            },
          ),
        ).resolves.toMatchObject({
          ok: false,
          error: { message: expect.stringContaining("mandatory pre-execution audit") },
        })
        expect(execute).not.toHaveBeenCalled()
      }
    },
  )

  it("leaves a durable allowed trail and returns reconciliation failure if completion audit fails", async () => {
    const append = vi
      .fn()
      .mockImplementationOnce((record) => appendMcpAuditRecord(drizzle(sqlite, { schema }), record))
      .mockImplementationOnce((record) => appendMcpAuditRecord(drizzle(sqlite, { schema }), record))
      .mockImplementationOnce(() => {
        throw new Error("database is locked")
      })
    const execute = vi.fn(() => ({ ok: true as const, data: { mutated: true } }))
    const result = await invokeMcpControlTool(
      "pin_item",
      { ...caller, permissionMode: "full-access" },
      { kind: "chat", id: "chat-2", pinned: true },
      undefined,
      { audit: { append }, resolveTarget: () => ({}), execute, invocationId: () => "outbox" },
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "reconciliation-required",
        message: expect.stringContaining("outbox"),
      },
    })
    expect(statuses("outbox")).toEqual(["allowed", "dispatch-started"])

    const retryExecute = vi.fn(() => ({ ok: true as const, data: { mutated: true } }))
    await expect(
      invokeMcpControlTool(
        "pin_item",
        { ...caller, permissionMode: "full-access" },
        { kind: "chat", id: "chat-2", pinned: true },
        undefined,
        {
          ...dependencies("blind-retry"),
          resolveTarget: () => ({}),
          execute: retryExecute,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "reconciliation-required", message: expect.stringContaining("outbox") },
    })
    expect(retryExecute).not.toHaveBeenCalled()
  })
})
