import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("node:os", async (load) => {
  const os = await load<typeof import("node:os")>()
  return { ...os, homedir: () => process.env.FLAPSTACK_CONFIG_DIR || os.homedir() }
})
vi.mock("../src/main/index", () => ({ getAuthManager: () => null }))
vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_CONFIG_DIR,
    isPackaged: false,
    getVersion: () => "test",
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {},
  shell: {},
}))
vi.mock("../src/main/lib/analytics", () => ({
  trackWorkspaceCreated: vi.fn(),
  trackPRCreated: vi.fn(),
  trackWorkspaceArchived: vi.fn(),
  trackWorkspaceDeleted: vi.fn(),
  trackProjectOpened: vi.fn(),
}))

import { invokeDesktopWorkflow } from "../src/main/lib/mcp-control/desktop-workflows"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { closeDatabase } from "../src/main/lib/db"

let dir: string, db: Database.Database
const caller = {
  chatId: "caller",
  projectId: "one",
  taskId: null,
  permissionMode: "full-access" as const,
}
const context = { invocationId: "test-call", approved: true }
const invoke = (name: string, raw: unknown) => invokeDesktopWorkflow(name, caller, raw, context)
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flapstack-workflow-"))
  vi.stubEnv("FLAPSTACK_CONFIG_DIR", dir)
  vi.stubEnv("FLAPSTACK_DB_PATH", join(dir, "agents.db"))
  db = new Database(process.env.FLAPSTACK_DB_PATH!)
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.exec(`INSERT INTO projects (id, name, path) VALUES ('one','Project one','/one'),('two','Project two','/two');
    INSERT INTO chats(id,name,scope,project_id,permission_mode,harness) VALUES ('caller','First','project','one','full-access','codex'),('outside','Other','project','two','full-access','codex');
    INSERT INTO sub_chats(id,chat_id,messages) VALUES ('a','caller','[]'),('b','outside','[]');`)
  db.prepare("UPDATE sub_chats SET messages=? WHERE id='a'").run(
    JSON.stringify([
      { id: "question", role: "user", parts: [{ type: "text", text: "Question" }] },
      {
        id: "answer",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Hidden thought" },
          { type: "text", text: "The reply." },
        ],
      },
    ]),
  )
})
afterEach(() => {
  closeDatabase()
  db.close()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

it("preserves the chat checkout and the newly created worktree when a run queues during creation", async () => {
  const root = join(dir, "queue-repo")
  mkdirSync(root)
  execFileSync("git", ["-C", root, "init", "--quiet", "--initial-branch=main"], {
    windowsHide: true,
  })
  bindFilesystemRootIdentity(root)
  db.prepare("UPDATE projects SET path=? WHERE id='one'").run(root)
  db.prepare("UPDATE chats SET worktree_path=? WHERE id='caller'").run(root)
  db.prepare("UPDATE sub_chats SET worktree_path=? WHERE id='a'").run(root)
  db.exec(`CREATE TRIGGER queue_on_checkout AFTER INSERT ON filesystem_root_registrations BEGIN
    INSERT INTO agent_runs(id,chat_id,sub_chat_id,harness,permission_mode,status,worktree_path,runtime_snapshot_version,runtime_preference_source)
    VALUES ('waiting','caller','a','codex','full-access','pending',(SELECT worktree_path FROM chats WHERE id='caller'),1,'chat');
    END;`)
  const request = { chatId: "caller", name: "queue-race", baseBranch: "main" }
  expect(await invoke("create_worktree", request)).toMatchObject({
    ok: false,
    error: { code: "conflict", message: expect.stringContaining("retained at") },
  })
  const retained = db
    .prepare("SELECT path FROM filesystem_root_registrations WHERE path<>?")
    .get(root) as { path: string }
  expect(existsSync(join(retained.path, ".git"))).toBe(true)
  expect(
    db
      .prepare(
        "SELECT worktree_path FROM chats WHERE id='caller' UNION SELECT worktree_path FROM sub_chats WHERE id='a' UNION SELECT worktree_path FROM agent_runs WHERE id='waiting'",
      )
      .all(),
  ).toEqual([{ worktree_path: root }])
  expect(await invoke("create_worktree", request)).toMatchObject({
    ok: false,
    error: { code: "conflict", message: expect.stringContaining("active runs") },
  })
})

it("forks only the selected visible history and rejects a conversation in another chat", async () => {
  const result = await invoke("fork_chat", { chatId: "caller", messageId: "question" })
  expect(result).toMatchObject({ ok: true, data: { messageCount: 1 } })
  const row = db
    .prepare("SELECT messages FROM sub_chats WHERE chat_id NOT IN ('caller','outside')")
    .get() as { messages: string }
  expect(JSON.parse(row.messages)).toMatchObject([{ role: "user" }])
  expect(
    await invoke("fork_chat", { chatId: "caller", subChatId: "b", messageId: "question" }),
  ).toMatchObject({ ok: false, error: { code: "stale-target" } })
  expect(
    await invoke("undo_run_changes", { chatId: "outside", runId: "foreign-run" }),
  ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
})
