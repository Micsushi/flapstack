import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendMcpAuditRecord,
  findUnresolvedMcpDispatch,
} from "../src/main/lib/mcp-control/audit-storage"
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
  it("allows concurrent owner project registrations for distinct folders while blocking a matching retry", async () => {
    const owner = {
      callerKind: "external-owner" as const,
      chatId: "external-owner:fixture",
      permissionMode: "full-access" as const,
    }
    const firstPath = join(directory, "first-project")
    const secondPath = join(directory, "second-project")
    const junction = join(directory, "project-alias")
    mkdirSync(firstPath)
    mkdirSync(secondPath)
    symlinkSync(firstPath, junction, process.platform === "win32" ? "junction" : "dir")
    const aliases = [firstPath, junction, firstPath + sep + ".." + sep + "first-project"]
    if (process.platform === "win32") aliases.push(join(directory, "FIRST-PROJECT"))
    let releaseFirst!: () => void
    const pending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const execute = vi.fn(async ({ rawInput }: { rawInput: unknown }) => {
      const { path } = rawInput as { path: string }
      if (path === firstPath) await pending
      return { ok: true as const, data: { registered: true } }
    })
    const register = (invocationId: string, path: string, name: string) =>
      invokeMcpControlTool("create_project", owner, { path, name }, undefined, {
        ...dependencies(invocationId),
        resolveTarget: () => ({}),
        execute,
      })

    const first = register("first-project", firstPath, "First")
    try {
      expect(statuses("first-project")).toEqual(["allowed", "dispatch-started"])
      await expect(register("second-project", secondPath, "Second")).resolves.toMatchObject({
        ok: true,
      })
      for (const [index, alias] of aliases.entries()) {
        await expect(register("matching-retry-" + index, alias, "Renamed")).resolves.toMatchObject({
          ok: false,
          error: {
            code: "reconciliation-required",
            message: expect.stringContaining("first-project"),
          },
        })
      }
    } finally {
      releaseFirst()
    }
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(statuses("first-project")).toEqual(["allowed", "dispatch-started", "completed"])
    expect(statuses("second-project")).toEqual(["allowed", "dispatch-started", "completed"])
    const summaries = sqlite
      .prepare("SELECT input_summary FROM mcp_audit_records WHERE status='dispatch-started'")
      .pluck()
      .all() as string[]
    expect(new Set(summaries).size).toBe(2)
    for (const summary of summaries) {
      expect(JSON.parse(summary)).toEqual({
        canonicalPath: {
          byteLength: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      })
      expect(summary).not.toContain(directory)
    }
  })

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
