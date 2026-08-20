import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-edit-restoration-initial",
  restored: [] as string[],
}))

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath, getVersion: () => "0.0.0-test", isPackaged: false },
  BrowserWindow: { fromId: () => null, getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

vi.mock("../src/main/index", () => ({ getAuthManager: () => null }))

vi.mock("../src/main/lib/analytics", () => ({
  trackPRCreated: vi.fn(),
  trackWorkspaceArchived: vi.fn(),
  trackWorkspaceCreated: vi.fn(),
  trackWorkspaceDeleted: vi.fn(),
  trackProjectOpened: vi.fn(),
}))

vi.mock("../src/main/lib/checkpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/lib/checkpoints")>()
  return {
    ...actual,
    restoreCheckpoint: vi.fn(async (checkpointId: string) => {
      state.restored.push(checkpointId)
    }),
  }
})

import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"

const caller = chatsRouter.createCaller({ getWindow: () => null })
const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

let container = ""
let sqlite: Database.Database

const messages = [
  { id: "assistant-earlier", role: "assistant", parts: [], metadata: { sessionId: "session-1" } },
  { id: "user-latest", role: "user", parts: [{ type: "text", text: "Please refactor" }] },
  { id: "assistant-latest", role: "assistant", parts: [] },
]

function seedRun(beforeCheckpointId: string | null): void {
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, prompt_message_id, initial_prompt,
        status, before_checkpoint_id, started_at, runtime_snapshot_version, runtime_preference,
        runtime_preference_source, resolved_runtime, runtime_adapter_version,
        runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES ('run-1', 'chat-1', 'sub-1', 'codex', 'full-access', 'user-latest', 'Please refactor',
        'success', ?, unixepoch(), 1, 'codex-enhanced', 'product', 'codex', 'a', 'p', '{}', '{}')`,
    )
    .run(beforeCheckpointId)
}

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-edit-restoration-"))
  state.userDataPath = join(container, "user-data")
  state.restored = []
  mkdirSync(state.userDataPath)
  const databasePath = join(state.userDataPath, "agents.db")
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, permission_mode, harness) VALUES ('chat-1', 'Chat', 'global', 'full-access', 'codex')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-1', 'chat-1', 'codex', 'full-access', ?)",
    )
    .run(JSON.stringify(messages))
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(() => {
  closeDatabase()
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

describe("editLatestUserMessage restoration outcome", () => {
  it("reports a checkpoint restore when the run captured one", async () => {
    seedRun(null)
    sqlite
      .prepare(
        "INSERT INTO checkpoints (id, run_id, kind, worktree_path, git_commit) VALUES ('checkpoint-1', 'run-1', 'before', '/tmp/worktree', 'abc123')",
      )
      .run()
    sqlite
      .prepare("UPDATE agent_runs SET before_checkpoint_id = 'checkpoint-1' WHERE id = 'run-1'")
      .run()

    const result = await caller.editLatestUserMessage({
      subChatId: "sub-1",
      userMessageId: "user-latest",
    })

    expect(result).toMatchObject({
      success: true,
      filesRestored: true,
      restoration: "checkpoint",
    })
    expect(state.restored).toEqual(["checkpoint-1"])
    expect(result.messages.map((message: { id: string }) => message.id)).toEqual([
      "assistant-earlier",
    ])
  })

  it("reports a conversation-only rewind when no checkpoint exists", async () => {
    seedRun(null)

    const result = await caller.editLatestUserMessage({
      subChatId: "sub-1",
      userMessageId: "user-latest",
    })

    expect(result).toMatchObject({
      success: true,
      filesRestored: false,
      restoration: "conversation-only",
    })
    // The rewind still happens; only the file restore is absent.
    expect(state.restored).toEqual([])
    expect(result.messages.map((message: { id: string }) => message.id)).toEqual([
      "assistant-earlier",
    ])
    expect(
      JSON.parse(
        (
          sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-1'").get() as {
            messages: string
          }
        ).messages,
      ),
    ).toHaveLength(1)
  })

  it("warns in the renderer exactly when the server reports a conversation-only rewind", () => {
    expect(activeChatSource).toContain('result.restoration === "conversation-only"')
    expect(activeChatSource).toContain('toast.warning("Rewound the conversation only"')
    expect(activeChatSource).toContain("earlier file changes were kept on disk")
  })
})
