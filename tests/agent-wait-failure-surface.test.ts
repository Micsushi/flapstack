import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ userDataPath: "/tmp/flapstack-agent-wait-initial" }))

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

import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"

const caller = chatsRouter.createCaller({ getWindow: () => null })
const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const titleEditorSource = readFileSync(
  "src/renderer/features/agents/ui/chat-title-editor.tsx",
  "utf8",
)

let container = ""
let sqlite: Database.Database

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-agent-wait-"))
  state.userDataPath = join(container, "user-data")
  mkdirSync(state.userDataPath)
  const databasePath = join(state.userDataPath, "agents.db")
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  for (const [chatId, name] of [
    ["waiter", "Coordinator"],
    ["target", "Worker"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, scope, permission_mode, harness) VALUES (?, ?, 'global', 'full-access', 'codex')",
      )
      .run(chatId, name)
  }
  sqlite
    .prepare(
      `INSERT INTO chat_waits
        (id, waiter_chat_id, waiter_run_id, target_chat_ids, idempotency_key, status, error,
         created_at, updated_at, completed_at)
       VALUES ('wait-1', 'waiter', 'run-1', '["target"]', 'key-1', 'failed',
         'A waiting chat or target was archived or removed.', 10, 11, 11)`,
    )
    .run()
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(() => {
  closeDatabase()
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

describe("failed agent waits reach the renderer", () => {
  it("exposes a failed wait with its bounded reason through listAgentMetadata", async () => {
    const metadata = await caller.listAgentMetadata()

    expect(metadata.waits).toEqual([
      expect.objectContaining({
        id: "wait-1",
        chatId: "waiter",
        targetNames: ["Worker"],
        status: "failed",
        error: "A waiting chat or target was archived or removed.",
      }),
    ])
  })

  it("stops surfacing the wait once the user dismisses it", async () => {
    await expect(caller.dismissAgentWait({ waitId: "wait-1" })).resolves.toEqual({
      dismissed: true,
    })
    expect((await caller.listAgentMetadata()).waits).toEqual([])

    // Dismissal is durable and idempotent, not a transient client-side hide.
    await expect(caller.dismissAgentWait({ waitId: "wait-1" })).resolves.toEqual({
      dismissed: false,
    })
    expect(sqlite.prepare("SELECT status FROM chat_waits WHERE id = 'wait-1'").get()).toEqual({
      status: "cancelled",
    })
  })

  it("keeps still-pending waits visible and undismissable", async () => {
    sqlite.prepare("UPDATE chat_waits SET status = 'waiting', error = NULL").run()

    expect((await caller.listAgentMetadata()).waits).toEqual([
      expect.objectContaining({ status: "waiting", error: null }),
    ])
    await expect(caller.dismissAgentWait({ waitId: "wait-1" })).resolves.toEqual({
      dismissed: false,
    })
    expect((await caller.listAgentMetadata()).waits).toHaveLength(1)
  })

  it("wires the header dismissal affordance to the durable mutation", () => {
    expect(activeChatSource).toContain("trpc.chats.dismissAgentWait.useMutation")
    expect(activeChatSource).toContain('chatAgentWait?.status === "failed"')
    expect(activeChatSource).toContain("onDismissAgentWait={handleDismissAgentWait}")
    expect(titleEditorSource).toContain("onDismiss={onDismissAgentWait}")
  })
})
