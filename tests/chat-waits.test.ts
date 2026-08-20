import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import {
  advanceChatWaits,
  dismissFailedChatWait,
  listAgentChatWaits,
  registerChatWait,
} from "../src/main/lib/chat-waits"
import { createChatTagStore } from "../src/main/lib/chat-tags"

let directory = ""
let databasePath = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-chat-waits-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.pragma("foreign_keys = ON")
  for (const [chatId, name] of [
    ["waiter", "Coordinator"],
    ["target", "Worker"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, scope, permission_mode, harness) VALUES (?, ?, 'global', 'full-access', 'codex')",
      )
      .run(chatId, name)
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES (?, ?, 'codex', 'full-access', '[]')",
      )
      .run(`sub-${chatId}`, chatId)
  }
  for (const [runId, chatId] of [
    ["run-waiter", "waiter"],
    ["run-target", "target"],
  ]) {
    sqlite
      .prepare(
        `INSERT INTO agent_runs
          (id, chat_id, sub_chat_id, harness, permission_mode, prompt_message_id,
           initial_prompt, status, runtime_snapshot_version, runtime_preference,
           runtime_preference_source, resolved_runtime, runtime_adapter_version,
           runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot)
         VALUES (?, ?, ?, 'codex', 'full-access', ?, 'Work', 'running', 1,
           'codex-enhanced', 'product', 'codex', 'test-adapter', 'test-protocol', '{}', '{}')`,
      )
      .run(runId, chatId, `sub-${chatId}`, `direct-${runId}`)
  }
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("agent chat waits", () => {
  it("keeps manual Waiting tags separate and resumes without cross-chat messages", () => {
    const waitingTag = createChatTagStore(sqlite)
      .list()
      .find((tag) => tag.name === "Waiting")!
    createChatTagStore(sqlite).assign({ chatId: "target", tagId: waitingTag.id })

    const registered = registerChatWait(sqlite, {
      waiterChatId: "waiter",
      waiterRunId: "run-waiter",
      targetChatIds: ["target"],
      idempotencyKey: "wait-on-worker",
    })
    expect(registered).toMatchObject({ ok: true, created: true, state: "waiting" })
    expect(listAgentChatWaits(sqlite)).toEqual([
      expect.objectContaining({
        chatId: "waiter",
        targetChatIds: ["target"],
        targetNames: ["Worker"],
      }),
    ])
    expect(advanceChatWaits(databasePath, 0)).toBe(0)

    sqlite
      .prepare(
        "UPDATE agent_runs SET status = 'success', completed_at = unixepoch() WHERE id IN ('run-waiter','run-target')",
      )
      .run()
    expect(advanceChatWaits(databasePath, 0)).toBe(0)
    expect(advanceChatWaits(databasePath, 0)).toBe(1)

    expect(listAgentChatWaits(sqlite)).toEqual([])
    expect(
      sqlite
        .prepare(
          `SELECT status, initial_prompt FROM agent_runs
           WHERE chat_id = 'waiter' AND prompt_message_id LIKE 'mcp-wait-resume-%'`,
        )
        .get(),
    ).toEqual({
      status: "pending",
      initial_prompt: expect.stringContaining("[FLAPSTACK WAIT COMPLETED]"),
    })
    expect(createChatTagStore(sqlite).listForChats(["target"]).get("target")).toEqual([
      expect.objectContaining({ name: "Waiting" }),
    ])
    expect(createChatTagStore(sqlite).listForChats(["waiter"]).get("waiter")).toEqual([])
  })

  it("replays a completed wait as settled instead of telling the agent to keep waiting", () => {
    const input = {
      waiterChatId: "waiter",
      waiterRunId: "run-waiter",
      targetChatIds: ["target"],
      idempotencyKey: "wait-replay",
    }
    expect(registerChatWait(sqlite, input)).toMatchObject({
      ok: true,
      created: true,
      state: "waiting",
      active: true,
    })

    sqlite
      .prepare(
        "UPDATE agent_runs SET status = 'success', completed_at = unixepoch() WHERE id IN ('run-waiter','run-target')",
      )
      .run()
    expect(advanceChatWaits(databasePath, 0)).toBe(0)
    expect(advanceChatWaits(databasePath, 0)).toBe(1)
    expect(sqlite.prepare("SELECT status FROM chat_waits").get()).toEqual({ status: "completed" })

    // The caller run must be active again for a replay to reach the lookup.
    sqlite
      .prepare(
        "UPDATE agent_runs SET status = 'running', completed_at = NULL WHERE id = 'run-waiter'",
      )
      .run()
    const replay = registerChatWait(sqlite, input)

    expect(replay).toMatchObject({
      ok: true,
      created: false,
      state: "completed",
      active: false,
      targetChatIds: ["target"],
    })
    // Idempotency is preserved: no second durable wait row is created.
    expect(sqlite.prepare("SELECT count(*) count FROM chat_waits").get()).toEqual({ count: 1 })
  })

  it("replays a failed wait as failed and surfaces it until dismissed", () => {
    const input = {
      waiterChatId: "waiter",
      waiterRunId: "run-waiter",
      targetChatIds: ["target"],
      idempotencyKey: "wait-that-fails",
    }
    expect(registerChatWait(sqlite, input)).toMatchObject({ ok: true, created: true })

    sqlite.prepare("UPDATE chats SET archived_at = unixepoch() WHERE id = 'target'").run()
    expect(advanceChatWaits(databasePath, 0)).toBe(0)
    expect(sqlite.prepare("SELECT status FROM chat_waits").get()).toEqual({ status: "failed" })

    const surfaced = listAgentChatWaits(sqlite)
    expect(surfaced).toEqual([
      expect.objectContaining({
        chatId: "waiter",
        status: "failed",
        error: "A waiting chat or target was archived or removed.",
      }),
    ])

    const replay = registerChatWait(sqlite, input)
    expect(replay).toMatchObject({ ok: true, created: false, state: "failed", active: false })
    expect(sqlite.prepare("SELECT count(*) count FROM chat_waits").get()).toEqual({ count: 1 })

    expect(dismissFailedChatWait(sqlite, surfaced[0].id)).toBe(true)
    expect(listAgentChatWaits(sqlite)).toEqual([])
    // Dismissal is idempotent and keeps the row durable for audit.
    expect(dismissFailedChatWait(sqlite, surfaced[0].id)).toBe(false)
    expect(sqlite.prepare("SELECT status FROM chat_waits").get()).toEqual({ status: "cancelled" })
  })

  it("bounds the surfaced failure text and never carries prompt content", () => {
    registerChatWait(sqlite, {
      waiterChatId: "waiter",
      waiterRunId: "run-waiter",
      targetChatIds: ["target"],
      idempotencyKey: "bounded-error",
    })
    sqlite
      .prepare("UPDATE chat_waits SET status = 'failed', error = ? WHERE waiter_chat_id = 'waiter'")
      .run(`SECRET-PROMPT-${"x".repeat(900)}`)

    const [surfaced] = listAgentChatWaits(sqlite)
    expect(surfaced.status).toBe("failed")
    expect(surfaced.error).toHaveLength(200)
    expect(surfaced).not.toHaveProperty("prompt")
    expect(JSON.stringify(surfaced)).not.toContain("x".repeat(201))
  })

  it("rejects circular wait dependencies", () => {
    expect(
      registerChatWait(sqlite, {
        waiterChatId: "waiter",
        waiterRunId: "run-waiter",
        targetChatIds: ["target"],
        idempotencyKey: "a-to-b",
      }),
    ).toMatchObject({ ok: true })
    expect(
      registerChatWait(sqlite, {
        waiterChatId: "target",
        waiterRunId: "run-target",
        targetChatIds: ["waiter"],
        idempotencyKey: "b-to-a",
      }),
    ).toMatchObject({ ok: false, code: "conflict" })
  })
})
