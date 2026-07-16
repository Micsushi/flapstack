import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadInteractiveRuntimeActivity,
  loadInteractiveRuntimeAssistantText,
  materializeInteractiveRuntimeRun,
  persistInteractiveRuntimeAssistantFallback,
  resolveInteractiveRuntime,
} from "../src/main/lib/agent-runtime/interactive-chat"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"

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
      ).toEqual({ resolvedRuntime: runtime, direct: true })

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
      })

      expect(run).toMatchObject({
        runId: "run",
        harness,
        model,
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
        runtime_preference: "auto",
        resolved_runtime: runtime,
        initial_prompt: "Test direct Runtime",
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

  it("leaves explicit Flapstack Native chats on the legacy interactive transport", () => {
    seedChat("codex", "flapstack-native", [])
    expect(
      resolveInteractiveRuntime(database, {
        chatId: "chat",
        subChatId: "sub",
        harness: "codex",
        model: "gpt-5.5",
        mode: "write",
      }),
    ).toEqual({ resolvedRuntime: "flapstack-native", direct: false })
  })

  it("projects authoritative completed Runtime text into the chat response", () => {
    seedChat("claude-code", "auto", [])
    materializeInteractiveRuntimeRun(database, {
      runId: "runtime-text-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "claude-code",
      prompt: "Return a visible answer",
      model: "claude-opus-4-8",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })
    database
      .prepare(
        `INSERT INTO agent_activity_events
         (event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
          kind, phase, display_class, privacy_class, received_at, payload_json, created_at)
         VALUES ('event-1', 'runtime-text-run', 'chat', 'sub', 'claude-code', 'claude-code',
                 'anthropic', 1, 'agent-text', 'completed', 'summary', 'public', 1, ?, 1)`,
      )
      .run(JSON.stringify({ text: "CLAUDE_RUNTIME_OK" }))

    expect(loadInteractiveRuntimeAssistantText(database, "runtime-text-run")).toBe(
      "CLAUDE_RUNTIME_OK",
    )
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

  it("carries image input to the direct Runtime launch without changing message storage", () => {
    seedChat("claude-code", "auto", [])
    const run = materializeInteractiveRuntimeRun(database, {
      runId: "runtime-image-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "claude-code",
      prompt: "Inspect this image",
      images: [{ base64Data: "aW1hZ2U=", mediaType: "image/png", filename: "image.png" }],
      model: "claude-opus-4-8",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })

    expect(run.images).toEqual([
      { base64Data: "aW1hZ2U=", mediaType: "image/png", filename: "image.png" },
    ])
  })

  it("streams durable Runtime text deltas once in storage order", () => {
    seedChat("codex", "auto", [])
    materializeInteractiveRuntimeRun(database, {
      runId: "runtime-delta-run",
      chatId: "chat",
      subChatId: "sub",
      harness: "codex",
      prompt: "Stream a visible answer",
      model: "gpt-5.5",
      mode: "write",
      reasoningEffort: "high",
      reasoningEnabled: true,
    })
    const insert = database.prepare(
      `INSERT INTO agent_activity_events
       (event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
        kind, phase, display_class, privacy_class, received_at, payload_json, created_at)
       VALUES (?, 'runtime-delta-run', 'chat', 'sub', 'codex', 'codex', 'openai', ?,
               'agent-text', 'delta', 'summary', 'public', ?, ?, ?)`,
    )
    insert.run("delta-1", 1, 1, JSON.stringify({ text: "Hello" }), 1)
    insert.run("delta-2", 2, 2, JSON.stringify({ text: " world" }), 2)

    const activity = loadInteractiveRuntimeActivity(database, "runtime-delta-run")
    expect(activity.events.map((event) => event.payload)).toEqual([
      { text: "Hello" },
      { text: " world" },
    ])
    expect(loadInteractiveRuntimeActivity(database, "runtime-delta-run", activity.cursor)).toEqual({
      cursor: activity.cursor,
      events: [],
    })
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
  runtimePreference: "auto" | "flapstack-native",
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
