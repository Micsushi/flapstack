import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadInteractiveRuntimeAssistantParts,
  materializeInteractiveRuntimeRun,
  persistInteractiveRuntimeAssistantFallback,
  resolveInteractiveRuntime,
} from "../src/main/lib/agent-runtime/interactive-chat"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { DEFAULT_RUNTIME_CONTROLS, type AgentRuntimePreference } from "../src/shared/agent-runtime"
import { ClaudeRuntimeEventMapper } from "../src/main/lib/agent-runtime/claude-code/events"
import { RuntimeTextChatChunkMapper } from "../src/renderer/features/agents/lib/runtime-text-chat-chunks"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

let directory = ""
let database: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-interactive-runtime-"))
  database = new Database(join(directory, "agents.db"))
  migrateDatabase(drizzle(database, { schema }), database, resolve(process.cwd(), "drizzle"))
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("interactive Runtime launch bridge", () => {
  it.each([
    ["codex", "codex", "gpt-5.5", "high"],
    ["claude-code", "claude-code", "claude-opus-4-8", "max"],
  ] as const)(
    "materializes %s through its direct Runtime before central dispatch",
    (harness, runtime, model, reasoningEffort) => {
      seedChat(harness, "auto", [
        {
          id: "prompt-1",
          role: "user",
          parts: [{ type: "text", text: "Test direct Runtime" }],
        },
      ])

      expect(
        resolveInteractiveRuntime(database, {
          chatId: "chat",
          subChatId: "sub",
          harness,
          model,
          mode: "write",
          reasoningEffort,
          reasoningEnabled: true,
        }),
      ).toEqual({ resolvedRuntime: runtime, runtimePreference: runtime, direct: true })

      const run = materializeInteractiveRuntimeRun(database, {
        runId: "run",
        chatId: "chat",
        subChatId: "sub",
        harness,
        prompt: "Test direct Runtime",
        promptMessageId: "prompt-1",
        model,
        mode: "write",
        reasoningEffort,
        reasoningEnabled: true,
        codexThreadVisibility: "hidden",
      })

      expect(run).toMatchObject({
        runId: "run",
        harness,
        model,
        codexThreadVisibility: "hidden",
        runtimeLaunch: {
          resolvedRuntime: runtime,
          controls: { modelEffort: reasoningEffort },
        },
      })
      expect(
        database
          .prepare(
            `SELECT status, runtime_preference, resolved_runtime, initial_prompt
             FROM agent_runs WHERE id = 'run'`,
          )
          .get(),
      ).toEqual({
        status: "running",
        runtime_preference: runtime,
        resolved_runtime: runtime,
        initial_prompt: "Test direct Runtime",
      })
      expect(
        database.prepare("SELECT runtime_preference FROM chats WHERE id = 'chat'").get(),
      ).toEqual({
        runtime_preference: runtime,
      })
      const messages = JSON.parse(
        (
          database.prepare("SELECT messages FROM sub_chats WHERE id = 'sub'").get() as {
            messages: string
          }
        ).messages,
      ) as Array<{ id: string }>
      expect(messages.map((message) => message.id)).toEqual(["prompt-1"])
    },
  )

  it("keeps each Claude block once in live and saved output when the SDK compacts snapshots", () => {
    seedChat("claude-code", "auto", [])
    const runId = "claude-block-identity"
    materializeInteractiveRuntimeRun(database, {
      runId,
      chatId: "chat",
      subChatId: "sub",
      harness: "claude-code",
      prompt: "Read it",
      model: null,
      mode: "write",
      reasoningEffort: null,
      reasoningEnabled: true,
    })
    const mapper = new ClaudeRuntimeEventMapper(DEFAULT_RUNTIME_CONTROLS)
    const store = createAgentActivityStore(database)
    const live = new RuntimeTextChatChunkMapper(runId)
    const displayed: string[] = []
    let sequence = 0
    const emit = (sdk: Record<string, unknown>) => {
      for (const e of mapper.map({
        uuid: String(++sequence),
        session_id: "session",
        ...sdk,
      } as unknown as SDKMessage)) {
        store.append(runId, e)
        if (
          e.kind === "agent-text" &&
          (e.phase === "started" || e.phase === "delta" || e.phase === "completed")
        ) {
          for (const chunk of live.map({
            phase: e.phase,
            text: e.payload.text,
            providerItemId: e.providerItemId ?? null,
            providerMessageId: e.providerMessageId ?? null,
            contentIndex: e.contentIndex ?? null,
            sectionBoundary: e.sectionBoundary ?? null,
          })) {
            if (chunk.type === "text-start")
              expect(chunk.providerMetadata.runtime.phase).toBe("assistant_text")
            if (chunk.type === "text-delta") displayed.push(chunk.delta)
          }
        }
      }
    }
    const stream = (event: Record<string, unknown>) => emit({ type: "stream_event", event })
    stream({ type: "message_start", message: { id: "message" } })
    stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } })
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Checking." },
    })
    stream({ type: "content_block_stop", index: 0 })
    // Installed Claude emitted the compact snapshot before the raw stop. Each distinct
    // source block must survive even when the author repeats exactly the same prose.
    for (const index of [1, 3]) {
      if (index === 3) {
        stream({
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "read-1", name: "Read", input: {} },
        })
        stream({ type: "content_block_stop", index: 2 })
      }
      stream({ type: "content_block_start", index, content_block: { type: "text", text: "" } })
      stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: "Same." } })
      emit({
        type: "assistant",
        message: { id: "message", content: [{ type: "text", text: "Same." }] },
      })
      stream({ type: "content_block_stop", index })
    }
    const parts = loadInteractiveRuntimeAssistantParts(database, runId)
    expect(displayed).toEqual(["Same.", "Same."])
    expect(parts).toEqual([
      { type: "text", text: "Same.", providerMetadata: { runtime: { phase: "commentary" } } },
      { type: "text", text: "Same.", providerMetadata: { runtime: { phase: "assistant_text" } } },
    ])
    persistInteractiveRuntimeAssistantFallback(database, runId, parts)
    const row = database.prepare("SELECT messages FROM sub_chats WHERE id='sub'").get() as {
      messages: string
    }
    expect(JSON.parse(row.messages).at(-1).parts).toEqual(parts)
  })

  it("durably falls back to a normal assistant message before the renderer acknowledges it", () => {
    seedChat("claude-code", "auto", [
      { id: "hotline", role: "user", parts: [{ type: "text", text: "hotline off" }] },
    ])
    materializeInteractiveRuntimeRun(database, {
      runId: "runtime-fallback-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "claude-code",
      prompt: "Return a visible answer",
      model: "claude-opus-4-8",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })

    const before = JSON.parse(
      (
        database.prepare("SELECT messages FROM sub_chats WHERE id = 'sub'").get() as {
          messages: string
        }
      ).messages,
    )
    before.push({
      id: "queued-next",
      role: "user",
      parts: [{ type: "text", text: "Next feedback" }],
    })
    database
      .prepare("UPDATE sub_chats SET messages = ? WHERE id = 'sub'")
      .run(JSON.stringify(before))
    persistInteractiveRuntimeAssistantFallback(
      database,
      "runtime-fallback-run",
      "Spoken: Fixed.\nDisplayed:\nDetails",
    )
    persistInteractiveRuntimeAssistantFallback(database, "runtime-fallback-run", "Duplicate")

    const messages = JSON.parse(
      (
        database.prepare("SELECT messages FROM sub_chats WHERE id = 'sub'").get() as {
          messages: string
        }
      ).messages,
    ) as Array<Record<string, any>>
    expect(messages.at(-1)?.id).toBe("queued-next")
    expect(messages.filter((message) => message.role === "assistant")).toEqual([
      expect.objectContaining({
        parts: [{ type: "text", text: "Fixed.\n\nDetails" }],
        metadata: {
          runId: "runtime-fallback-run",
          transport: "claude-code-runtime",
        },
      }),
    ])
  })

  it("keeps mode-derived read-only permission on the run instead of poisoning Write", () => {
    seedChat("codex", "auto", [])
    const readRun = materializeInteractiveRuntimeRun(database, {
      runId: "read-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "codex",
      prompt: "Inspect only",
      model: "gpt-5.5",
      mode: "read",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })
    expect(readRun.permissionMode).toBe("read-only")
    expect(
      database.prepare("SELECT permission_mode FROM sub_chats WHERE id = 'sub'").get(),
    ).toEqual({ permission_mode: "full-access" })

    database.prepare("UPDATE agent_runs SET status = 'success' WHERE id = 'read-run'").run()
    const writeRun = materializeInteractiveRuntimeRun(database, {
      runId: "write-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "codex",
      prompt: "Make the change",
      model: "gpt-5.5",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })
    expect(writeRun.permissionMode).toBe("full-access")
    expect(
      database.prepare("SELECT permission_mode FROM agent_runs WHERE id = 'write-run'").get(),
    ).toEqual({ permission_mode: "full-access" })
  })

  it("rejects a second interactive run for the same conversation", () => {
    seedChat("codex", "auto", [])
    materializeInteractiveRuntimeRun(database, {
      runId: "existing",
      chatId: "chat",
      subChatId: "sub",
      harness: "codex",
      prompt: "Already running",
      model: "gpt-5.5",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })
    expect(() =>
      materializeInteractiveRuntimeRun(database, {
        runId: "existing",
        chatId: "chat",
        subChatId: "sub",
        harness: "codex",
        prompt: "Do not replay",
        model: "gpt-5.5",
        mode: "write",
        reasoningEffort: "high",
        reasoningEnabled: true,
      }),
    ).toThrow("already running")
    expect(() =>
      materializeInteractiveRuntimeRun(database, {
        runId: "run",
        chatId: "chat",
        subChatId: "sub",
        harness: "codex",
        prompt: "Do not overlap",
        model: "gpt-5.5",
        mode: "write",
        reasoningEffort: "high",
        reasoningEnabled: true,
      }),
    ).toThrow("already has an active Runtime run")
  })
})

function seedChat(
  harness: "codex" | "claude-code",
  runtimePreference: AgentRuntimePreference,
  messages: unknown[],
): void {
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project', 'Project', ?)")
    .run(directory)
  database
    .prepare(
      `INSERT INTO chats
       (id, name, project_id, scope, permission_mode, harness, model, runtime_preference,
        worktree_path)
       VALUES ('chat', 'Chat', 'project', 'project', 'full-access', ?, 'model', ?, ?)`,
    )
    .run(harness, runtimePreference, directory)
  database
    .prepare(
      `INSERT INTO sub_chats
       (id, chat_id, harness, model, permission_mode, worktree_path, messages, mode)
       VALUES ('sub', 'chat', ?, 'model', 'full-access', ?, ?, 'write')`,
    )
    .run(harness, directory, JSON.stringify(messages))
}
