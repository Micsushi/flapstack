import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import {
  appendMcpAuditRecord,
  authorizeMcpDispatchRetry,
  findUnresolvedMcpDispatch,
  listMcpDispatchRecoveryClaims,
  reconcileMcpDispatchClaim,
  recoverMcpDispatchClaims,
} from "../src/main/lib/mcp-control/audit-storage"

let directory = ""
let databasePath = ""
let sqlite: Database.Database

const caller = { chatId: "chat-1", runId: "run-1", permissionMode: "full-access" as const }

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-audit-recovery-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  if (sqlite.open) sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP terminal audit recovery", () => {
  it("persists restart-safe recovery and distinguishes matching from different invocations", () => {
    appendClaim("search-original", "search", 0, { query: "alpha" })
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0 })).toBe(1)
    expect(listMcpDispatchRecoveryClaims(db())).toEqual([
      expect.objectContaining({
        invocationId: "search-original",
        state: "recovery-retryable",
        retrySafe: true,
      }),
    ])

    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "search-original",
        caller,
        toolName: "search",
        input: { query: "alpha" },
      }),
    ).toMatchObject({ relation: "same-invocation", state: "recovery-retryable" })
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "search-retry",
        caller,
        toolName: "search",
        input: { query: "alpha" },
      }),
    ).toMatchObject({ relation: "matching-retry", state: "recovery-retryable" })
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "different-input",
        caller,
        toolName: "search",
        input: { query: "beta" },
      }),
    ).toBeNull()

    sqlite.close()
    sqlite = new Database(databasePath)
    expect(listMcpDispatchRecoveryClaims(db())).toEqual([
      expect.objectContaining({ invocationId: "search-original", state: "recovery-retryable" }),
    ])
  })

  it("allows one explicit retry for retry-safe work and exhausts the matching fingerprint", () => {
    appendClaim("search-original", "search", 0, { query: "alpha" })
    recoverMcpDispatchClaims(db(), { staleAfterMs: 0 })
    expect(authorizeMcpDispatchRetry(db(), "search-original")).toBe(true)
    expect(authorizeMcpDispatchRetry(db(), "search-original")).toBe(false)
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "search-retry",
        caller,
        toolName: "search",
        input: { query: "alpha" },
      }),
    ).toBeNull()
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "search-concurrent-retry",
        caller,
        toolName: "search",
        input: { query: "alpha" },
      }),
    ).toMatchObject({ invocationId: "search-original", state: "retry-consumed" })

    appendClaim("search-retry", "search", 0, { query: "alpha" })
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0 })).toBe(1)
    expect(listMcpDispatchRecoveryClaims(db())).toEqual([
      expect.objectContaining({ invocationId: "search-retry", state: "recovery-exhausted" }),
    ])
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "search-third-attempt",
        caller,
        toolName: "search",
        input: { query: "alpha" },
      }),
    ).toMatchObject({ invocationId: "search-retry", state: "recovery-exhausted" })
  })

  it("keeps an exact non-idempotent unknown outcome blocked without poisoning other input", () => {
    appendClaim("pin-unknown", "pin_item", 2, { kind: "chat", id: "chat-2", pinned: true })
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0 })).toBe(1)
    expect(authorizeMcpDispatchRetry(db(), "pin-unknown")).toBe(false)
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "pin-retry",
        caller,
        toolName: "pin_item",
        input: { kind: "chat", id: "chat-2", pinned: true },
      }),
    ).toMatchObject({ invocationId: "pin-unknown", state: "recovery-unknown" })
    expect(
      findUnresolvedMcpDispatch(db(), {
        invocationId: "pin-other",
        caller,
        toolName: "pin_item",
        input: { kind: "chat", id: "chat-3", pinned: true },
      }),
    ).toBeNull()
    expect(reconcileMcpDispatchClaim(db(), "pin-unknown", "completed")).toBe(true)
    expect(listMcpDispatchRecoveryClaims(db())).toEqual([])
  })

  it("bounds each recovery sweep and does not repeatedly transition recovered claims", () => {
    appendClaim("bounded-a", "search", 0, { query: "a" })
    appendClaim("bounded-b", "search", 0, { query: "b" })
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0, limit: 1 })).toBe(1)
    expect(
      listMcpDispatchRecoveryClaims(db()).filter((claim) => claim.state === "dispatch-started"),
    ).toHaveLength(1)
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0, limit: 1 })).toBe(1)
    expect(recoverMcpDispatchClaims(db(), { staleAfterMs: 0, limit: 1 })).toBe(0)
  })
})

function db() {
  return drizzle(sqlite, { schema })
}

function appendClaim(
  invocationId: string,
  toolName: string,
  tier: 0 | 1 | 2 | 3,
  input: unknown,
): void {
  appendMcpAuditRecord(db(), {
    invocationId,
    status: "dispatch-started",
    caller,
    toolName,
    tier,
    input,
  })
}
