import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync, realpathSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname, basename } from "node:path"
import { beforeEach, afterEach, it, expect } from "vitest"
import { WorktreeDeclarationService } from "../src/main/lib/agent-orchestration/worktree-declarations"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
let directory: string, path: string, db: Database.Database, service: WorktreeDeclarationService
const scope = { projectId: "p", taskId: "t" }
function member(id: string, taskId = "t", chatId = "c") {
  db.prepare(
    "INSERT INTO agent_runs(id,chat_id,harness,permission_mode,status,worktree_path,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES(?,?,'codex','read-only','running',?,?,?,?,?,?,?,?,?)",
  ).run(id, chatId, directory, ...testRuntimeSnapshotSqlValues())
  db.prepare(
    "INSERT INTO orchestration_agents(id,task_id,chat_id,run_id,definition,status) VALUES(?,?,?,?,?,'running')",
  ).run("a-" + id, taskId, chatId, id, JSON.stringify({ name: id }))
}
function set(runId: string, intent: "read" | "write" | null, expectedRevision = 0) {
  return service.set({ ...scope, runId, intent, expectedRevision })
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-declarations-"))
  path = join(directory, "test.db")
  db = new Database(path)
  db.pragma("foreign_keys=ON")
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.exec(
    "INSERT INTO projects(id,name,path) VALUES('p','P','/synthetic'),('other','Other','/other'); INSERT INTO tasks(id,project_id,name) VALUES('t','p','T'),('t2','p','T2'); INSERT INTO chats(id,project_id,task_id,name) VALUES('c','p','t','C'),('c2','p','t2','C2')",
  )
  for (const [t, c] of [
    ["t", "c"],
    ["t2", "c2"],
  ])
    db.prepare(
      "INSERT INTO task_orchestrations(task_id,initiating_chat_id,status,max_parallel_agents,max_depth,stop_conditions,engine_snapshot_version,coordination_engine,coordination_engine_version,coordination_engine_source,coordination_engine_capability_snapshot,coordination_engine_provider_identity) VALUES(?,?,'running',2,4,'{}',?,?,?,?,?,?)",
    ).run(t, c, ...testCoordinationEngineSnapshotSqlValues())
  const st = statSync(directory, { bigint: true })
  db.prepare(
    "INSERT INTO filesystem_root_registrations(path,canonical_path,device_id,inode_id,bound_at) VALUES(?,?,?,?,0)",
  ).run(directory, realpathSync(directory), String(st.dev), String(st.ino))
  member("one")
  member("two")
  member("other-task", "t2", "c2")
  service = new WorktreeDeclarationService(db)
})
afterEach(() => {
  db.close()
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("flapstack-declarations-")
  )
    throw Error("Unsafe cleanup")
  rmSync(directory, { recursive: true, force: true })
})
it("persists project-wide read/write conflicts without changing permissions and survives restart", () => {
  expect(service.state(scope).declarations).toEqual([])
  set("one", "read")
  set("two", "read")
  expect(service.state(scope).conflicts).toEqual([])
  service.set({
    projectId: "p",
    taskId: "t2",
    runId: "other-task",
    intent: "write",
    expectedRevision: 0,
  })
  expect(service.state(scope).members).toHaveLength(2)
  expect(service.state(scope).conflicts[0].runs).toHaveLength(3)
  const before = service.state(scope).declarations
  db.close()
  db = new Database(path)
  service = new WorktreeDeclarationService(db)
  expect(service.state(scope).declarations).toEqual(before)
  expect(db.prepare("SELECT DISTINCT permission_mode,status FROM agent_runs").all()).toEqual([
    { permission_mode: "read-only", status: "running" },
  ])
})
it("protects CAS and absent-row ABA while restoring exact snapshots", () => {
  const first = set("one", "read")
  expect(() => set("one", "write")).toThrow("changed")
  const released = service.restore({
    ...scope,
    runId: "one",
    expectedRevision: 1,
    targetRevision: 0,
  })
  expect(released.declaration).toBeNull()
  expect(() => set("one", "write")).toThrow("changed")
  const restored = service.restore({
    ...scope,
    runId: "one",
    expectedRevision: 2,
    targetRevision: 1,
  })
  expect(restored.declaration).toEqual(first.declaration)
  expect(restored.revision).toBe(3)
  expect(() =>
    service.restore({ ...scope, runId: "one", expectedRevision: 2, targetRevision: 0 }),
  ).toThrow("changed")
})
it.each(["success", "failure", "cancelled"])(
  "retains %s history, permits release but forbids resurrection",
  (status) => {
    set("one", "write")
    db.prepare("UPDATE agent_runs SET status=? WHERE id=?").run(status, "one")
    expect(service.state(scope).declarations[0].activity).toBe("terminal")
    expect(() => set("one", "read", 1)).toThrow("pending")
    set("one", null, 1)
    expect(() =>
      service.restore({ ...scope, runId: "one", expectedRevision: 2, targetRevision: 1 }),
    ).toThrow("pending")
  },
)
it("rejects foreign scopes, unrelated runs, remote and rebound roots without active historical claims", () => {
  expect(() => service.state({ ...scope, projectId: "other" })).toThrow("outside")
  expect(() => set("other-task", "write")).toThrow("current run")
  expect(() => set("missing", "read")).toThrow("current run")
  set("one", "read")
  db.exec("UPDATE filesystem_root_registrations SET inode_id='different'")
  expect(service.state(scope).declarations[0].activity).toBe("unavailable")
  expect(() => set("two", "write")).toThrow("verified")
  expect(() =>
    service.restore({ ...scope, runId: "one", expectedRevision: 1, targetRevision: 1 }),
  ).toThrow("verified")
})
it("keeps retired exact run identity historical and permits explicit release", () => {
  set("one", "write")
  db.exec("UPDATE orchestration_agents SET run_id=NULL WHERE run_id='one'")
  expect(service.state(scope).declarations[0].activity).toBe("retired")
  set("one", null, 1)
  expect(() =>
    service.restore({ ...scope, runId: "one", expectedRevision: 2, targetRevision: 1 }),
  ).toThrow("current run")
})

it("excludes remote runs and caps retained history without resetting revision", () => {
  db.exec("UPDATE agent_runs SET provider_runtime_target='remote' WHERE id='two'")
  expect(() => set("two", "read")).toThrow("local")
  expect(service.state(scope).members.find((m) => m.runId === "two")?.eligible).toBe(false)
  for (let revision = 0; revision < 51; revision++)
    set("one", revision % 2 ? "read" : "write", revision)
  expect(
    db
      .prepare(
        "SELECT count(*) n,min(revision) oldest,max(revision) newest FROM orchestration_worktree_declarations",
      )
      .get(),
  ).toEqual({ n: 50, oldest: 2, newest: 51 })
  expect(() =>
    service.restore({ ...scope, runId: "one", expectedRevision: 51, targetRevision: 1 }),
  ).toThrow("no longer")
  expect(set("one", null, 51).revision).toBe(52)
})
