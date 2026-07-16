import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

const mocks = vi.hoisted(() => ({
  createACPProvider: vi.fn(),
  spawn: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-codex-terminal",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}))

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  createACPProvider: mocks.createACPProvider,
}))

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: mocks.streamText,
}))

vi.mock("../src/main/lib/checkpoints", () => ({
  captureCheckpoint: vi.fn(async (runId: string, _cwd: string | null, phase: string) => ({
    id: `${runId}-${phase}`,
  })),
  captureNoChangeManifest: vi.fn(async () => undefined),
}))

vi.mock("../src/main/lib/harness/launch-context", () => ({
  buildHarnessContextBundle: vi.fn(async () => ({
    context: "",
    metadata: { sourceFingerprint: "test" },
  })),
  getLastHarnessContextFingerprint: () => undefined,
  buildStartupInstructions: () => "",
  prependStartupContext: (prompt: string) => prompt,
}))

vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({ resolve: () => null }),
}))

vi.mock("../src/main/lib/claude/env", () => ({
  getClaudeShellEnvironment: () => ({}),
}))

import { closeDatabase } from "../src/main/lib/db"
import { recoverLegacyQueuedRunPrompts } from "../src/main/lib/db/migrate"
import { codexRouter } from "../src/main/lib/trpc/routers/codex"
import { drainPendingMcpRuns, type QueuedAgentRun } from "../src/main/lib/run-launch-service"
import { providerExtensionId } from "../src/main/lib/provider-extensions"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-codex-terminal-"))
  databasePath = join(directory, "agents.db")
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  seedPendingRun(sqlite)
  sqlite.close()

  mocks.createACPProvider.mockReset()
  mocks.spawn.mockReset()
  mocks.streamText.mockReset()
  mocks.createACPProvider.mockReturnValue({
    cleanup: vi.fn(),
    getSessionId: () => null,
    languageModel: () => ({}),
    tools: {},
  })
  mocks.spawn.mockImplementation(() => fakeCodexMcpListProcess())
  mocks.streamText.mockReturnValue({
    toUIMessageStream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "error", errorText: "Authentication required." })
          controller.enqueue({ type: "finish", finishReason: "stop" })
          controller.close()
        },
      }),
  })
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("Codex router terminal provider failure", () => {
  it("keeps auth failure authoritative through router completion and launch audit", async () => {
    await drainPendingMcpRuns(databasePath, launchThroughRealCodexRouter, {
      waitForCompletion: true,
    })

    const sqlite = new Database(databasePath)
    expect(
      sqlite.prepare("SELECT status, completed_at FROM agent_runs WHERE id = 'run-auth'").get(),
    ).toMatchObject({ status: "failure", completed_at: expect.any(Number) })
    expect(sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-auth'").get()).toEqual({
      run_status: "failure",
    })
    expect(
      sqlite
        .prepare(
          "SELECT status FROM mcp_audit_records WHERE invocation_id = 'auth-invocation' ORDER BY created_at, id",
        )
        .all(),
    ).toEqual(expect.arrayContaining([{ status: "completed" }, { status: "failed" }]))
    sqlite.close()
  })

  it("routes two recovered legacy prompts through Codex in transcript order", async () => {
    seedSecondPendingRun()
    const sqlite = new Database(databasePath)
    sqlite.prepare("UPDATE agent_runs SET initial_prompt = NULL WHERE id = 'run-auth'").run()
    sqlite.prepare("UPDATE sub_chats SET messages = ? WHERE id = 'sub-auth'").run(
      JSON.stringify([
        { id: "mcp-auth-prompt", role: "user", parts: [{ type: "text", text: "A" }] },
        { id: "mcp-second-prompt", role: "user", parts: [{ type: "text", text: "B" }] },
      ]),
    )
    expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(2)
    sqlite.close()

    mocks.streamText.mockImplementation((input: any) => {
      const content = input.messages?.[0]?.content
      const prompt = Array.isArray(content)
        ? content.map((part: any) => part.text ?? "").join("")
        : String(content ?? "")
      return {
        toUIMessageStream: (options: any) =>
          new ReadableStream({
            async start(controller) {
              await options.onFinish({
                responseMessage: {
                  id: `response-${prompt}`,
                  role: "assistant",
                  parts: [{ type: "text", text: `${prompt}-response`, state: "done" }],
                },
                isContinuation: false,
              })
              controller.enqueue({ type: "finish", finishReason: "stop" })
              controller.close()
            },
          }),
      }
    })

    await drainPendingMcpRuns(databasePath, launchThroughRealCodexRouter, {
      waitForCompletion: true,
    })
    await drainPendingMcpRuns(databasePath, launchThroughRealCodexRouter, {
      waitForCompletion: true,
    })

    expect(readVisibleTranscript()).toEqual(["A", "A-response", "B", "B-response"])
  })

  it("passes task-resolved skill and MCP policy into the real Codex ACP launch", async () => {
    seedCodexExtensionPolicy()

    await collectStream(
      await codexRouter.createCaller({ getWindow: () => null }).chat({
        runId: "run-auth",
        chatId: "chat-auth",
        subChatId: "sub-auth",
        prompt: "Test provider policy",
        cwd: directory,
        mode: "write",
      }),
    )

    expect(mocks.createACPProvider).toHaveBeenCalledTimes(1)
    const providerOptions = mocks.createACPProvider.mock.calls[0]![0]
    const config = JSON.parse(providerOptions.env.CODEX_CONFIG)
    expect(config.skills.config).toContainEqual({
      path: join(directory, ".agents", "skills", "policy-alpha-task", "SKILL.md"),
      enabled: false,
    })
    expect(config.mcp_servers["policy-alpha-mcp"]).toMatchObject({ enabled: false })
    expect(providerOptions.session.mcpServers).not.toContainEqual(
      expect.objectContaining({ name: "policy-alpha-mcp" }),
    )
  })
})

function seedCodexExtensionPolicy(): void {
  const skillPath = join(directory, ".agents", "skills", "policy-alpha-task", "SKILL.md")
  const enabledSkillPath = join(directory, ".agents", "skills", "policy-beta-enabled", "SKILL.md")
  const configPath = join(directory, ".codex", "config.toml")
  mkdirSync(resolve(skillPath, ".."), { recursive: true })
  mkdirSync(resolve(enabledSkillPath, ".."), { recursive: true })
  mkdirSync(resolve(configPath, ".."), { recursive: true })
  writeFileSync(
    skillPath,
    "---\nname: policy-alpha-task\ndescription: disabled fixture\n---\nfixture\n",
  )
  writeFileSync(
    enabledSkillPath,
    "---\nname: policy-beta-enabled\ndescription: enabled fixture\n---\nfixture\n",
  )
  writeFileSync(
    configPath,
    '[mcp_servers."policy-alpha-mcp"]\ncommand = "disabled-fixture"\n\n[mcp_servers."policy-beta-mcp"]\ncommand = "enabled-fixture"\n',
  )

  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('policy-project', 'Policy', ?)")
    .run(directory)
  sqlite
    .prepare(
      "INSERT INTO tasks (id, project_id, name) VALUES ('policy-task', 'policy-project', 'Policy task')",
    )
    .run()
  sqlite
    .prepare(
      "UPDATE chats SET scope = 'task', project_id = 'policy-project', task_id = 'policy-task' WHERE id = 'chat-auth'",
    )
    .run()
  const insertPolicy = sqlite.prepare(
    `INSERT INTO extension_enablement_policies
      (extension_id, harness, kind, native_scope, scope_type, scope_id, project_id, task_id, enabled)
     VALUES (?, 'codex', ?, 'project', 'task', 'policy-task', 'policy-project', 'policy-task', 0)`,
  )
  insertPolicy.run(providerExtensionId("codex", "skill", skillPath), "skill")
  insertPolicy.run(providerExtensionId("codex", "mcp", `${configPath}#policy-alpha-mcp`), "mcp")
  sqlite.close()
}

async function launchThroughRealCodexRouter(run: QueuedAgentRun): Promise<void> {
  const stream = await codexRouter.createCaller({ getWindow: () => null }).chat({
    runId: run.runId,
    chatId: run.chatId,
    subChatId: run.subChatId,
    prompt: run.prompt,
    cwd: run.worktreePath!,
    mode: "write",
  })
  const chunks = await collectStream(stream)
  const terminalError = chunks.find(
    (chunk) => chunk?.type === "error" || chunk?.type === "auth-error",
  )
  if (terminalError) throw new Error(terminalError.errorText || "Codex provider failed")
}

async function collectStream(stream: any): Promise<any[]> {
  const chunks: any[] = []
  if (stream?.[Symbol.asyncIterator]) {
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.subscribe({
      next: (chunk: any) => chunks.push(chunk),
      error: rejectPromise,
      complete: resolvePromise,
    })
  })
  return chunks
}

function seedPendingRun(sqlite: Database.Database): void {
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, harness, permission_mode, worktree_path) VALUES ('chat-auth', 'Codex auth', 'global', 'codex', 'full-access', ?)",
    )
    .run(directory)
  sqlite
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages) VALUES ('sub-auth', 'chat-auth', 'codex', 'full-access', ?, 'pending', '[]')",
    )
    .run(directory)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES ('run-auth', 'chat-auth', 'sub-auth', 'codex', 'full-access', ?,
        'mcp-auth-prompt', 'Test provider auth failure', 'pending', 1,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(directory, ...testRuntimeSnapshotSqlValues())
  sqlite
    .prepare(
      `INSERT INTO mcp_audit_records (
        id, invocation_id, status, caller_chat_id, tool_name, tier, caller_snapshot,
        chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms, created_at
      ) VALUES ('auth-source', 'auth-invocation', 'completed', 'caller-chat',
        'launch_run', 3, '{}', '{}', '{}', '{}', ?, 0, 1)`,
    )
    .run(JSON.stringify({ runId: "run-auth" }))
}

function seedSecondPendingRun(): void {
  const sqlite = new Database(databasePath)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
        prompt_message_id, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES ('run-second', 'chat-auth', 'sub-auth', 'codex', 'full-access', ?,
        'mcp-second-prompt', 'pending', 2, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(directory, ...testRuntimeSnapshotSqlValues())
  sqlite.close()
}

function readVisibleTranscript(): string[] {
  const sqlite = new Database(databasePath)
  const row = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-auth'").get() as {
    messages: string
  }
  sqlite.close()
  return JSON.parse(row.messages).flatMap((message: any) =>
    message.parts.filter((part: any) => part.type === "text").map((part: any) => part.text),
  )
}

function fakeCodexMcpListProcess(): any {
  const stdoutListeners: Array<(chunk: Buffer) => void> = []
  const closeListeners: Array<(code: number) => void> = []
  const stdout = {
    on(event: string, listener: (chunk: Buffer) => void) {
      if (event === "data") stdoutListeners.push(listener)
      return stdout
    },
  }
  const stderr = {
    on() {
      return stderr
    },
  }
  const child = {
    stdout,
    stderr,
    once(event: string, listener: (value: any) => void) {
      if (event === "close") closeListeners.push(listener)
      return child
    },
  }
  queueMicrotask(() => {
    for (const listener of stdoutListeners) listener(Buffer.from("[]"))
    for (const listener of closeListeners) listener(0)
  })
  return child
}
