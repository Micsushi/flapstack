import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { beforeEach, afterEach, it, expect } from "vitest"
import { OrchestrationReviewService } from "../src/main/lib/agent-orchestration/review-links"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
let directory: string, path: string, db: Database.Database, service: OrchestrationReviewService
const scope = { projectId: "p", taskId: "t" }
const review = {
  reviewerRunId: "reviewer",
  verdict: "pass" as const,
  evidence: "Checked the saved output; test evidence is literal text.",
}
function run(id: string, chatId = "c", status = "success") {
  db.prepare(
    "INSERT INTO agent_runs(id,chat_id,harness,permission_mode,status,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES(?,?,'codex','read-only',?,?,?,?,?,?,?,?,?)",
  ).run(id, chatId, status, ...testRuntimeSnapshotSqlValues())
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-review-links-"))
  path = join(directory, "test.db")
  db = new Database(path)
  db.pragma("foreign_keys=ON")
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.exec(
    "INSERT INTO projects(id,name,path) VALUES('p','Project','/synthetic'),('other','Other','/other'); INSERT INTO tasks(id,project_id,name) VALUES('t','p','Task'),('other-task','other','Other'); INSERT INTO chats(id,project_id,task_id,name) VALUES('c','p','t','Chat'),('other-chat','other','other-task','Other')",
  )
  db.prepare(
    "INSERT INTO task_orchestrations(task_id,initiating_chat_id,status,max_parallel_agents,max_depth,stop_conditions,engine_snapshot_version,coordination_engine,coordination_engine_version,coordination_engine_source,coordination_engine_capability_snapshot,coordination_engine_provider_identity) VALUES('t','c','completed',2,4,'{}',?,?,?,?,?,?)",
  ).run(...testCoordinationEngineSnapshotSqlValues())
  run("source")
  run("reviewer")
  run("unlinked")
  run("outside", "other-chat")
  db.prepare(
    "INSERT INTO orchestration_agents(id,task_id,chat_id,run_id,definition,status) VALUES('a','t','c','source',?,'completed'),('b','t','c','reviewer',?,'completed')",
  ).run(
    JSON.stringify({ name: "Source", role: "builder" }),
    JSON.stringify({ name: "Reviewer", role: "reviewer" }),
  )
  service = new OrchestrationReviewService(db)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
it("starts unreviewed even with completed reviewer role and persists explicit manual evidence across restart", () => {
  expect(service.state(scope).reviews).toEqual([])
  expect(service.state(scope).members).toHaveLength(2)
  const saved = service.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review })
  expect(saved.review).toMatchObject({ ...review, attribution: "manual" })
  db.close()
  db = new Database(path)
  service = new OrchestrationReviewService(db)
  expect(service.state(scope).reviews).toEqual([saved])
  expect(db.prepare("SELECT status FROM task_orchestrations WHERE task_id='t'").get()).toEqual({
    status: "completed",
  })
})
it("checks actual project/task members, exact distinct IDs, terminal pass and bounded explicit evidence", () => {
  for (const reviewerRunId of ["source", "missing", "unlinked", "outside"])
    expect(() =>
      service.set({
        ...scope,
        sourceRunId: "source",
        expectedRevision: 0,
        review: { ...review, reviewerRunId },
      }),
    ).toThrow()
  expect(() => service.state({ ...scope, projectId: "other" })).toThrow("outside")
  expect(() =>
    service.set({
      ...scope,
      sourceRunId: "source",
      expectedRevision: 0,
      review: { ...review, evidence: "x".repeat(8001) },
    }),
  ).toThrow()
  db.exec("UPDATE agent_runs SET status='running' WHERE id='reviewer'")
  expect(() =>
    service.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review }),
  ).toThrow("finished")
  const pending = service.set({
    ...scope,
    sourceRunId: "source",
    expectedRevision: 0,
    review: { ...review, verdict: "inconclusive" },
  })
  expect(pending.review!.verdict).toBe("inconclusive")
  db.exec(
    "UPDATE agent_runs SET status='success' WHERE id='reviewer'; UPDATE agent_runs SET status='running' WHERE id='source'",
  )
  expect(() =>
    service.set({ ...scope, sourceRunId: "source", expectedRevision: pending.revision, review }),
  ).toThrow("finished")
  db.exec("UPDATE orchestration_agents SET chat_id='other-chat' WHERE id='b'")
  expect(() =>
    service.set({
      ...scope,
      sourceRunId: "source",
      expectedRevision: pending.revision,
      review: { ...review, verdict: "needs-work" },
    }),
  ).toThrow("actual runs")
})
it("CAS protects create, replacement and absent-row ABA through exact undo/redo", () => {
  const first = service.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review })
  const otherDb = new Database(path),
    other = new OrchestrationReviewService(otherDb)
  try {
    expect(() =>
      other.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review }),
    ).toThrow("changed")
    const cleared = service.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: first.revision,
      targetRevision: 0,
    })
    expect(cleared.review).toBeNull()
    expect(cleared.revision).toBe(2)
    expect(() =>
      other.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review }),
    ).toThrow("changed")
    const redone = other.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: cleared.revision,
      targetRevision: first.revision,
    })
    expect(redone.review).toEqual(first.review)
    expect(() =>
      service.restore({
        ...scope,
        sourceRunId: "source",
        expectedRevision: cleared.revision,
        targetRevision: 0,
      }),
    ).toThrow("changed")
    const edited = service.set({
      ...scope,
      sourceRunId: "source",
      expectedRevision: redone.revision,
      review: { ...review, verdict: "needs-work", evidence: "One issue remains." },
    })
    const undone = service.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: edited.revision,
      targetRevision: redone.revision,
    })
    expect(undone.review).toEqual(first.review)
  } finally {
    otherDb.close()
  }
})
it("retains historical exact IDs after retry and never applies their result to replacement run", () => {
  const saved = service.set({ ...scope, sourceRunId: "source", expectedRevision: 0, review })
  run("replacement")
  db.exec("UPDATE orchestration_agents SET run_id='replacement' WHERE id='a'")
  const state = service.state(scope)
  expect(state.members.some((m) => m.runId === "replacement")).toBe(true)
  expect(state.reviews).toEqual([saved])
  expect(state.reviews.some((r) => r.sourceRunId === "replacement")).toBe(false)
  expect(() =>
    service.set({ ...scope, sourceRunId: "source", expectedRevision: 1, review }),
  ).toThrow("actual runs")
  const clear = service.set({ ...scope, sourceRunId: "source", expectedRevision: 1, review: null })
  expect(
    service.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: clear.revision,
      targetRevision: 1,
    }).review,
  ).toEqual(saved.review)
})
it("bounds revision history and rejects unavailable restoration", () => {
  let revision = 0
  for (let n = 0; n < 53; n++)
    revision = service.set({
      ...scope,
      sourceRunId: "source",
      expectedRevision: revision,
      review: { ...review, verdict: "inconclusive" },
    }).revision
  expect(db.prepare("SELECT count(*) count FROM orchestration_run_reviews").get()).toEqual({
    count: 50,
  })
  expect(() =>
    service.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: revision,
      targetRevision: 1,
    }),
  ).toThrow("no longer available")
  expect(
    service.restore({
      ...scope,
      sourceRunId: "source",
      expectedRevision: revision,
      targetRevision: 0,
    }).revision,
  ).toBe(54)
})
