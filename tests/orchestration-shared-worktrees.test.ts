import Database from "better-sqlite3"
import { afterEach, beforeEach, expect, it } from "vitest"
import {
  projectSharedWorktrees,
  sharedWorktreeKey,
} from "../src/main/lib/agent-orchestration/shared-worktrees"
import { disabledCustomPermissions } from "../src/shared/permission-capabilities"

let db: Database.Database
beforeEach(() => {
  db = new Database(":memory:")
  db.exec(`CREATE TABLE tasks(id TEXT,project_id TEXT);
    CREATE TABLE chats(id TEXT,task_id TEXT,project_id TEXT);
    CREATE TABLE orchestration_agents(id TEXT,task_id TEXT,run_id TEXT,chat_id TEXT,definition TEXT);
    CREATE TABLE agent_runs(id TEXT,chat_id TEXT,worktree_path TEXT,permission_mode TEXT,custom_permissions TEXT,status TEXT,provider_runtime_target TEXT);
    INSERT INTO tasks VALUES('task','project');
    INSERT INTO chats VALUES('chat-a','task','project'),('chat-b','task','project');
    INSERT INTO orchestration_agents VALUES('a','task','run-a','chat-a','{"name":"Builder"}'),('b','task','run-b','chat-b','{"name":"Reviewer"}');
    INSERT INTO agent_runs VALUES('run-a','chat-a','/registered/worktree','full-access',NULL,'running','local'),('run-b','chat-b','/registered/worktree','read-only',NULL,'pending','local');`)
})
afterEach(() => db.close())
it("projects exact current local run/chat identities and drops terminal/replaced runs", () => {
  expect(projectSharedWorktrees(db, "task").groups[0]?.runs).toMatchObject([
    { runId: "run-a", chatId: "chat-a", access: "may-edit" },
    { runId: "run-b", chatId: "chat-b", access: "read-only" },
  ])
  db.exec("UPDATE agent_runs SET status='success' WHERE id='run-a'")
  expect(projectSharedWorktrees(db, "task").groups).toEqual([])
  db.exec(
    "INSERT INTO agent_runs SELECT 'retry',chat_id,worktree_path,permission_mode,custom_permissions,'running',provider_runtime_target FROM agent_runs WHERE id='run-a'; UPDATE orchestration_agents SET run_id='retry' WHERE id='a'",
  )
  expect(projectSharedWorktrees(db, "task").groups[0]?.runs.map((run) => run.runId)).toEqual([
    "retry",
    "run-b",
  ])
})
it("excludes remote, cross-project, cross-task and mismatched chat identities", () => {
  for (const sql of [
    "UPDATE agent_runs SET provider_runtime_target='remote' WHERE id='run-b'",
    "UPDATE chats SET project_id='other' WHERE id='chat-b'",
    "UPDATE chats SET task_id='other' WHERE id='chat-b'",
    "UPDATE orchestration_agents SET chat_id='chat-a' WHERE id='b'",
  ]) {
    db.exec("SAVEPOINT fixture")
    db.exec(sql)
    expect(projectSharedWorktrees(db, "task").groups).toEqual([])
    db.exec("ROLLBACK TO fixture; RELEASE fixture")
  }
})
it("does not warn for distinct worktrees or two known read-only permissions", () => {
  db.exec("UPDATE agent_runs SET worktree_path='/registered/other' WHERE id='run-b'")
  expect(projectSharedWorktrees(db, "task").groups).toEqual([])
  db.exec("UPDATE agent_runs SET worktree_path='/registered/worktree',permission_mode='read-only'")
  expect(projectSharedWorktrees(db, "task").groups).toEqual([])
  db.prepare(
    "UPDATE agent_runs SET permission_mode='custom',custom_permissions=? WHERE id='run-a'",
  ).run(JSON.stringify(disabledCustomPermissions))
  expect(projectSharedWorktrees(db, "task").groups).toEqual([])
  db.prepare("UPDATE agent_runs SET custom_permissions=? WHERE id='run-a'").run(
    JSON.stringify({ ...disabledCustomPermissions, shell: true }),
  )
  expect(projectSharedWorktrees(db, "task").groups).toHaveLength(1)
})
it("keeps missing worktree and malformed permissions explicitly unknown", () => {
  db.exec(
    "UPDATE agent_runs SET permission_mode='custom',custom_permissions='broken' WHERE id='run-a'",
  )
  expect(projectSharedWorktrees(db, "task").groups[0]?.runs[0]?.access).toBe("unknown")
  db.exec("UPDATE agent_runs SET worktree_path=NULL WHERE id='run-a'")
  expect(projectSharedWorktrees(db, "task").unknown[0]?.runId).toBe("run-a")
})
it("normalizes saved Windows identities without filesystem access and preserves POSIX case", () => {
  expect(sharedWorktreeKey("C:/Repo/Tree/", "win32")).toBe(
    sharedWorktreeKey("c:\\repo\\tree", "win32"),
  )
  expect(sharedWorktreeKey("/Repo", "linux")).not.toBe(sharedWorktreeKey("/repo", "linux"))
  expect(sharedWorktreeKey("relative", "linux")).toBeNull()
})
