import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { persistInteractiveRuntimeAssistantFallback } from "../src/main/lib/agent-runtime/interactive-chat"
import {
  codexRewindTargets,
  filterCodexDiscardedMessages,
  rewindCodexToUserMessage,
} from "../src/main/lib/agent-runtime/codex/rewind"
import { CodexProtocolResponseError } from "../src/main/lib/agent-runtime/codex/protocol-client"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { FakeCodexProtocolClient } from "./codex-runtime-test-helpers"

let db: Database.Database
let directory: string
let transcript: string
const request = { subChatId: "conversation", userMessageId: "u2" }
const turn = (id: string) => ({ id, status: "completed" })

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-rewind-"))
  db = new Database(join(directory, "agents.db"))
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  transcript = JSON.stringify(
    ["u1", "a1", "u2", "a2", "u3", "a3"].map((id) => ({
      id,
      role: id[0] === "u" ? "user" : "assistant",
    })),
  )
  db.prepare(
    "INSERT INTO chats(id,scope,harness,permission_mode) VALUES ('chat','global','codex','read-only')",
  ).run()
  db.prepare(
    "INSERT INTO sub_chats(id,chat_id,session_id,harness,messages) VALUES ('conversation','chat','thread-1','codex',?)",
  ).run(transcript)
  const activity = createAgentActivityStore(db)
  for (const i of [1, 2, 3]) {
    db.prepare(
      `INSERT INTO agent_runs(id,chat_id,sub_chat_id,harness,permission_mode,status,prompt_message_id,
        runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,
        runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot)
        VALUES (?,'chat','conversation','codex','read-only','success',?,?,?,?,?,?,?,?,?)`,
    ).run("run-" + i, "u" + i, ...testRuntimeSnapshotSqlValues("codex", "codex"))
    activity.append("run-" + i, {
      provider: "runtime",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerThreadId: "thread-1",
      providerTurnId: "turn-" + i,
      dedupKey: i === 1 ? "turn-started" : "runtime:turn-started",
      payload: { state: "turn-started" },
    })
  }
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function local() {
  return db
    .prepare(
      "SELECT session_id,messages,codex_rewind_intent FROM sub_chats WHERE id='conversation'",
    )
    .get() as {
    session_id: string
    messages: string
    codex_rewind_intent: string | null
  }
}

describe("native conversation rewind", () => {
  it.each([false, true])(
    "rejects a shared native thread before dispatch when the fork races: %s",
    async (duringRead) => {
      const fork = () => {
        db.exec("INSERT INTO chats(id,scope,harness) VALUES ('fork','global','codex')")
        db.exec(
          "INSERT INTO sub_chats(id,chat_id,session_id,harness) VALUES ('sibling','fork','thread-1','codex')",
        )
      }
      const client = new FakeCodexProtocolClient()
      if (duringRead) {
        client.responses.set("thread/turns/list", () => {
          fork()
          return { data: [turn("turn-3"), turn("turn-2"), turn("turn-1")], nextCursor: null }
        })
      } else {
        fork()
        expect(codexRewindTargets(db, "conversation").messageIds).toEqual([])
      }
      await expect(rewindCodexToUserMessage(db, request, () => client)).rejects.toThrow(
        /shares this Codex thread/,
      )
      expect(local().codex_rewind_intent).toBeNull()
      expect(local().messages).toBe(transcript)
      expect(client.requests.some((entry) => entry.method === "thread/revert")).toBe(false)
    },
  )

  it("paginates to the exact removed native turn, confirms readback and keeps the same thread", async () => {
    const client = new FakeCodexProtocolClient()
    let reverted = false
    const workspace = join(directory, "workspace")
    mkdirSync(workspace)
    const file = join(workspace, "keep.txt")
    writeFileSync(file, "keep")
    client.responses.set("thread/turns/list", (params: { cursor: string | null }) =>
      reverted
        ? { data: [turn("turn-1")], nextCursor: null }
        : params.cursor
          ? { data: [turn("turn-2"), turn("turn-1")], nextCursor: null }
          : { data: [turn("turn-3")], nextCursor: "opaque" },
    )
    client.responses.set("thread/revert", () => {
      expect(local().codex_rewind_intent).not.toBeNull()
      expect(local().messages).toBe(transcript)
      reverted = true
      return { thread: { id: "thread-1" } }
    })
    expect(codexRewindTargets(db, "conversation").messageIds.sort()).toEqual(["u1", "u2", "u3"])
    const now = await rewindCodexToUserMessage(db, request, () => client)
    expect(now.messages.map((message) => message.id)).toEqual(["u1", "a1"])
    expect(local()).toEqual({
      session_id: "thread-1",
      messages: JSON.stringify(now.messages),
      codex_rewind_intent: null,
    })
    expect(client.requests.find((r) => r.method === "thread/revert")?.params).toEqual({
      threadId: "thread-1",
      beforeTurnId: "turn-2",
    })
    const { discarded } = db
      .prepare("SELECT codex_rewind_discarded AS discarded FROM sub_chats WHERE id='conversation'")
      .get() as { discarded: string }
    const staleCopy = JSON.stringify([
      { id: "u2", role: "user" },
      { id: "other-renderer-answer-id", role: "assistant", metadata: { runId: "run-2" } },
      { id: "new", role: "user" },
    ])
    expect(JSON.parse(filterCodexDiscardedMessages(discarded, staleCopy))).toEqual([
      { id: "new", role: "user" },
    ])
    persistInteractiveRuntimeAssistantFallback(
      db,
      "run-2",
      "Late completion for the discarded turn.",
    )
    expect(local().messages).toBe(JSON.stringify(now.messages))
    expect(readFileSync(file, "utf8")).toBe("keep")
    expect(client.closed).toBe(true)
  })

  it("reconciles a lost result after reopening the database without replaying a confirmed revert", async () => {
    const lost = new FakeCodexProtocolClient()
    lost.responses.set("thread/turns/list", () => {
      if (lost.requests.some(({ method }) => method === "thread/revert"))
        throw new Error("server disconnected")
      return { data: [turn("turn-3"), turn("turn-2"), turn("turn-1")], nextCursor: null }
    })
    lost.responses.set("thread/revert", new Error("native result timed out"))
    await expect(rewindCodexToUserMessage(db, request, () => lost)).rejects.toThrow(
      /Could not confirm/,
    )
    expect(local().messages).toBe(transcript)
    expect(local().codex_rewind_intent).not.toBeNull()
    db.close()
    db = new Database(join(directory, "agents.db"))
    expect(codexRewindTargets(db, "conversation").pendingMessageId).toBe("u2")
    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_runs(id,chat_id,sub_chat_id,harness,permission_mode,status)
      VALUES ('blocked','chat','conversation','codex','read-only','pending')`,
        )
        .run(),
    ).toThrow(/Confirm the pending/)
    expect(() =>
      db.prepare("UPDATE sub_chats SET messages='[]' WHERE id='conversation'").run(),
    ).toThrow(/unconfirmed/)
    const recovered = new FakeCodexProtocolClient()
    recovered.responses.set("thread/turns/list", { data: [turn("turn-1")], nextCursor: null })
    await expect(rewindCodexToUserMessage(db, request, () => recovered)).resolves.toMatchObject({
      success: true,
    })
    expect(recovered.requests.some(({ method }) => method === "thread/revert")).toBe(false)
    expect(local().codex_rewind_intent).toBeNull()
  })

  it("keeps the transcript on explicit rejection and clears the settled journal", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("thread/turns/list", {
      data: [turn("turn-3"), turn("turn-2"), turn("turn-1")],
      nextCursor: null,
    })
    client.responses.set("thread/revert", new CodexProtocolResponseError("Rejected"))
    await expect(rewindCodexToUserMessage(db, request, () => client)).rejects.toThrow(
      /rejected the rewind/,
    )
    expect(local().messages).toBe(transcript)
    expect(local().codex_rewind_intent).toBeNull()
  })

  it("does not discard history from a different client or a currently running turn", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("thread/turns/list", { data: [turn("external"), turn("turn-2")] })
    await expect(rewindCodexToUserMessage(db, request, () => client)).rejects.toThrow(
      /outside the selected/,
    )
    expect(client.requests.some(({ method }) => method === "thread/revert")).toBe(false)
    db.prepare("UPDATE agent_runs SET status='running' WHERE id='run-3'").run()
    await expect(rewindCodexToUserMessage(db, request, () => client)).rejects.toThrow(
      /Stop the current/,
    )
    expect(local().messages).toBe(transcript)
  })
})
