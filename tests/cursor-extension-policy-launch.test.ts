import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-cursor-policy",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
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

vi.mock("../src/main/lib/cursor/binary", () => ({
  buildCursorEnv: (env: Record<string, string | undefined>) => env,
  CursorAgentNotFoundError: class CursorAgentNotFoundError extends Error {},
  resolveCursorRunTimeoutMs: () => 60_000,
  resolveCursorAgentBinary: () => "/tmp/cursor-agent",
}))

vi.mock("../src/main/lib/usage/secrets", () => ({
  getUsageSecret: () => null,
}))

import { closeDatabase } from "../src/main/lib/db"
import { providerExtensionId } from "../src/main/lib/provider-extensions"
import { cursorRouter } from "../src/main/lib/trpc/routers/cursor"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-cursor-policy-"))
  databasePath = join(directory, "agents.db")
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  mocks.spawn.mockReset()

  const commandPath = join(directory, ".cursor", "commands", "policy-alpha-task.md")
  mkdirSync(resolve(commandPath, ".."), { recursive: true })
  writeFileSync(commandPath, "# Disabled command\n")

  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
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
      "INSERT INTO chats (id, name, scope, harness, permission_mode, project_id, task_id, worktree_path) VALUES ('chat-policy', 'Cursor policy', 'task', 'cursor-agent', 'full-access', 'policy-project', 'policy-task', ?)",
    )
    .run(directory)
  sqlite
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages) VALUES ('sub-policy', 'chat-policy', 'cursor-agent', 'full-access', ?, 'pending', '[]')",
    )
    .run(directory)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at, runtime_snapshot_version,
        runtime_preference, runtime_preference_source, resolved_runtime,
        runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
        runtime_control_snapshot
      ) VALUES ('run-policy', 'chat-policy', 'sub-policy', 'cursor-agent', 'full-access', ?,
        'prompt-policy', 'Policy prompt', 'pending', 1,
        1, 'auto', 'product', 'flapstack-native', 'test-fixture', 'test-fixture',
        '{"schemaVersion":1}', '{"schemaVersion":1}')`,
    )
    .run(directory)
  sqlite
    .prepare(
      `INSERT INTO extension_enablement_policies
        (extension_id, harness, kind, native_scope, scope_type, scope_id, project_id, task_id, enabled)
       VALUES (?, 'cursor-agent', 'command', 'project', 'task', 'policy-task', 'policy-project', 'policy-task', 0)`,
    )
    .run(providerExtensionId("cursor", "command", commandPath))
  sqlite.close()
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("Cursor extension policy launch contract", () => {
  it("blocks an unsupported command disable before spawning cursor-agent", async () => {
    const stream = await cursorRouter.createCaller({ getWindow: () => null }).chat({
      runId: "run-policy",
      chatId: "chat-policy",
      subChatId: "sub-policy",
      prompt: "Policy prompt",
      cwd: directory,
    })
    const chunks = await collectStream(stream)

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          errorText: expect.stringContaining("no supported per-command native discovery filter"),
        }),
        expect.objectContaining({ type: "finish" }),
      ]),
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})

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
