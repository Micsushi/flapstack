import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
import { captureCheckpoint, captureRunManifest } from "../src/main/lib/checkpoints"
import { moveStoredChat } from "../src/main/lib/projects/move-chat"
import { closeDatabase } from "../src/main/lib/db"
import { registerDesktopSpeechReceiver } from "../src/main/lib/speech/desktop-playback"

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

it("attaches a managed checkout to the chat and its inherited conversation, then reads its bounded diff", async () => {
  const root = join(dir, "repo")
  mkdirSync(root)
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { windowsHide: true })
  git("init", "--quiet", "--initial-branch=main")
  db.prepare("UPDATE projects SET path=? WHERE id='one'").run(root)
  db.prepare("UPDATE chats SET worktree_path=? WHERE id='caller'").run(root)
  db.prepare("UPDATE sub_chats SET worktree_path=? WHERE id='a'").run(root)
  bindFilesystemRootIdentity(root)
  const created = await invoke("create_worktree", {
    chatId: "caller",
    name: "managed",
    baseBranch: "main",
  })
  expect(created).toMatchObject({ ok: true, data: { chatId: "caller" } })
  const sub = db.prepare("SELECT worktree_path path FROM sub_chats WHERE id='a'").get() as {
    path: string
  }
  expect(sub.path.startsWith(dir)).toBe(true)
  expect(sub.path).not.toBe(root)
  writeFileSync(join(sub.path, "note.txt"), "after\n")
  execFileSync("git", ["-C", sub.path, "add", "--intent-to-add", "note.txt"], { windowsHide: true })
  expect(await invoke("list_changed_files", { chatId: "caller" })).toMatchObject({
    ok: true,
    data: { files: [{ newPath: "note.txt" }] },
  })
  const diff = await invoke("read_git_diff", { chatId: "caller", path: "note.txt" })
  expect(diff).toMatchObject({ ok: true, data: { diff: expect.stringContaining("+after") } })
  expect(
    await invoke("read_git_diff", { chatId: "caller", path: "note.txt", limit: 3 }),
  ).toMatchObject({ ok: true, data: { diff: "dif" } })
  db.prepare(
    "INSERT INTO agent_runs(id,chat_id,sub_chat_id,harness,permission_mode,status,worktree_path) VALUES ('linked','caller','a','codex','full-access','success',?)",
  ).run(sub.path)
  await captureCheckpoint("linked", sub.path, "before")
  writeFileSync(join(sub.path, "note.txt"), "newer\n")
  await captureCheckpoint("linked", sub.path, "after")
  await captureRunManifest("linked")
  expect(await invoke("undo_run_changes", { chatId: "caller", runId: "linked" })).toMatchObject({
    ok: true,
    data: { success: true },
  })
  expect(readFileSync(join(sub.path, "note.txt"), "utf8")).toBe("after\n")
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

it("keeps a moved chat's historical run in its original project checkout", async () => {
  const roots = ["one", "two"].map((id) => {
    const root = join(dir, id)
    mkdirSync(root)
    execFileSync("git", ["-C", root, "init", "--quiet", "--initial-branch=main"], {
      windowsHide: true,
    })
    bindFilesystemRootIdentity(root)
    db.prepare("UPDATE projects SET path=? WHERE id=?").run(root, id)
    return root
  })
  db.prepare("UPDATE chats SET worktree_path=? WHERE id='caller'").run(roots[0])
  db.prepare("UPDATE sub_chats SET worktree_path=? WHERE id='a'").run(roots[0])
  db.prepare(
    "INSERT INTO agent_runs(id,chat_id,sub_chat_id,harness,permission_mode,status,worktree_path) VALUES ('old','caller','a','codex','full-access','success',?)",
  ).run(roots[0])
  const file = join(roots[0], "note.txt")
  writeFileSync(file, "before\n")
  await captureCheckpoint("old", roots[0], "before")
  writeFileSync(file, "after\n")
  await captureCheckpoint("old", roots[0], "after")
  await captureRunManifest("old")
  moveStoredChat(db, { id: "caller", scope: "project", projectId: "two" }, true)
  const request = { chatId: "caller", runId: "old" }
  expect(
    await invokeDesktopWorkflow(
      "undo_run_changes",
      { ...caller, projectId: "two" },
      request,
      context,
    ),
  ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
  expect(readFileSync(file, "utf8")).toBe("after\n")
  const taskRoot = join(dir, "task-worktree")
  execFileSync("git", ["-C", roots[0], "commit", "--allow-empty", "-q", "-m", "Seed fixture"], {
    windowsHide: true,
  })
  execFileSync(
    "git",
    ["-C", roots[0], "worktree", "add", "--quiet", "--detach", taskRoot, "HEAD"],
    { windowsHide: true },
  )
  bindFilesystemRootIdentity(taskRoot)
  db.prepare(
    "INSERT INTO tasks(id,name,project_id,primary_worktree_path) VALUES ('assigned','Fixture','one',?)",
  ).run(taskRoot)
  moveStoredChat(db, { id: "caller", scope: "task", projectId: "one", taskId: "assigned" }, true)
  expect(
    await invokeDesktopWorkflow(
      "undo_run_changes",
      { ...caller, taskId: "assigned" },
      request,
      context,
    ),
  ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
  expect(readFileSync(file, "utf8")).toBe("after\n")
  moveStoredChat(db, { id: "caller", scope: "project", projectId: "one" }, true)
  expect(await invoke("undo_run_changes", request)).toMatchObject({
    ok: true,
    data: { success: true },
  })
  expect(readFileSync(file, "utf8")).toBe("before\n")
})

it("checks the selected conversation's explicit authority and rejects a malformed mode", async () => {
  const restricted = { ...caller, permissionMode: "read-only" as const }
  db.exec(
    "UPDATE chats SET permission_mode='read-only' WHERE id='caller';UPDATE sub_chats SET permission_mode='full-access' WHERE id='a'",
  )
  const request = { chatId: "caller", messageId: "question" }
  expect(await invokeDesktopWorkflow("fork_chat", restricted, request, context)).toMatchObject({
    ok: false,
    error: { code: "permission-denied" },
  })
  db.exec("UPDATE sub_chats SET permission_mode=NULL WHERE id='a'")
  expect(await invokeDesktopWorkflow("fork_chat", restricted, request, context)).toMatchObject({
    ok: true,
  })
  db.exec("UPDATE chats SET permission_mode='invalid' WHERE id='caller'")
  expect(await invoke("fork_chat", request)).toMatchObject({
    ok: false,
    error: { code: "permission-denied" },
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

it("replaces tags atomically and lets the caller restore the returned prior tag names", async () => {
  expect(
    await invoke("set_chat_tags", { chatId: "caller", tags: ["Manual", "manual"] }),
  ).toMatchObject({ ok: true, data: { tags: ["Manual"] } })
  const changed = await invoke("set_chat_tags", { chatId: "caller", tags: ["Reviewed"] })
  expect(changed).toMatchObject({
    ok: true,
    data: { previousTags: ["Manual"], tags: ["Reviewed"] },
  })
  expect(await invoke("set_chat_tags", { chatId: "outside", tags: ["No"] })).toMatchObject({
    ok: false,
    error: { code: "out-of-scope" },
  })
  await invoke("set_chat_tags", { chatId: "caller", tags: ["Manual"] })
  expect(
    db
      .prepare(
        "SELECT name FROM chat_tags JOIN chat_tag_assignments ON tag_id=id WHERE chat_id='caller'",
      )
      .all(),
  ).toEqual([{ name: "Manual" }])
})

it("binds the selected catalog version and preserves its exact capability snapshot in a fork", async () => {
  const profile = { profileId: "builtin.planner", version: 1 }
  expect(await invoke("list_agent_profiles", { chatId: "caller", query: "planner" })).toMatchObject(
    { ok: true, data: expect.arrayContaining([expect.objectContaining({ profile })]) },
  )
  db.prepare(
    `INSERT INTO agent_profile_evaluations (id,profile_id,profile_version,runtime,model,state,fixture_set_json,evidence_json,evidence_digest,created_at) VALUES ('evaluation',?,1,'claude-code','default-unpinned','supported','[]','{}',?,1)`,
  ).run(profile.profileId, "e".repeat(64))
  expect(await invoke("bind_agent_profile", { chatId: "caller", profile })).toMatchObject({
    ok: true,
    data: { profile },
  })
  expect(await invoke("fork_chat", { chatId: "caller", messageId: "answer" })).toMatchObject({
    ok: true,
  })
  const bindings = db
    .prepare("SELECT snapshot_id FROM agent_profile_chat_bindings ORDER BY chat_id")
    .all()
  expect(bindings).toHaveLength(2)
  expect(bindings[0]).toEqual(bindings[1])
  expect(await invoke("bind_agent_profile", { chatId: "caller", profile: null })).toMatchObject({
    ok: true,
    data: { profile: null, previous: profile },
  })
})

it("sends only assistant reply text to one playback window and stops the scoped request", async () => {
  const receive = vi.fn(),
    second = vi.fn()
  const end = registerDesktopSpeechReceiver(1, receive),
    endSecond = registerDesktopSpeechReceiver(2, second)
  try {
    expect(await invoke("speak_reply", { chatId: "caller", messageId: "answer" })).toMatchObject({
      ok: true,
      data: { playback: "requested" },
    })
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "speak", text: "The reply." }),
    )
    expect(second).not.toHaveBeenCalled()
    expect(await invoke("speak_reply", { chatId: "caller", messageId: "question" })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    })
    expect(await invoke("stop_speech", {})).toMatchObject({
      ok: true,
      data: { playback: "stop-requested" },
    })
    expect(receive).toHaveBeenLastCalledWith({ kind: "stop", requestedOnly: true })
    expect(await invoke("update_speech_settings", { rate: 1.5 })).toMatchObject({
      ok: false,
      error: { code: "out-of-scope" },
    })
  } finally {
    end()
    endSecond()
  }
})
