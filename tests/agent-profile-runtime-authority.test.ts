import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readDurableAgentProfileRuntimeAuthority } from "../src/main/lib/agent-profiles/runtime-authority"
import { DEFAULT_AGENT_CAPABILITY } from "../src/shared/agent-profiles"

describe("durable Agent Profile runtime authority", () => {
  it("keeps the named-agent active-run check inside the immediate follow-up transaction", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/lib/agent-profiles/standalone-launch.ts"),
      "utf8",
    )
    const followUp = source.slice(source.indexOf("async followUp("), source.indexOf("async retry("))
    const transaction = followUp.indexOf("db.transaction(() => {")
    const activeRunCheck = followUp.indexOf("SELECT id FROM agent_runs WHERE chat_id")

    expect(transaction).toBeGreaterThanOrEqual(0)
    expect(activeRunCheck).toBeGreaterThan(transaction)
  })

  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
      CREATE TABLE agent_profile_standalone_launches (run_id TEXT, snapshot_id TEXT);
      CREATE TABLE agent_profile_snapshots (id TEXT PRIMARY KEY, resolved_json TEXT);
      CREATE TABLE agent_profile_run_bindings (run_id TEXT PRIMARY KEY, chat_id TEXT, snapshot_id TEXT);
      CREATE TABLE orchestration_agents (run_id TEXT, definition TEXT);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY, prompt_message_id TEXT);
      CREATE TABLE orchestration_transition_events (
        run_id TEXT,
        entity_id TEXT,
        phase TEXT
      );
      CREATE TABLE agent_profile_workflow_bindings (
        workflow_run_id TEXT,
        step_id TEXT,
        snapshot_id TEXT
      );
    `)
  })

  afterEach(() => db.close())

  it("recovers a legacy workflow worker from its immutable binding snapshot", () => {
    seedLegacyWorkflowRun(db)

    expect(readDurableAgentProfileRuntimeAuthority(db, "run-1")).toEqual({
      kind: "authority",
      authority: {
        snapshotId: "snapshot-1",
        snapshotDigest: "a".repeat(64),
        profile: { profileId: "profile-1", version: 1 },
        allowedTools: ["describe"],
        allowedSkills: [],
        memoryPolicy: { mode: "none" },
        allowedDescendantProfileIds: ["profile-child"],
        maxDescendants: 1,
      },
    })
  })

  it("rejects an embedded workflow authority that differs from its binding snapshot", () => {
    seedLegacyWorkflowRun(db)
    const definition = workerDefinition()
    db.prepare("UPDATE orchestration_agents SET definition = ? WHERE run_id = 'run-1'").run(
      JSON.stringify({
        ...definition,
        profileRuntimeAuthority: {
          snapshotId: "snapshot-1",
          snapshotDigest: "b".repeat(64),
          profile: { profileId: "profile-1", version: 1 },
          allowedTools: ["describe"],
          allowedSkills: [],
          memoryPolicy: { mode: "none" },
          allowedDescendantProfileIds: ["profile-child"],
          maxDescendants: 1,
        },
      }),
    )

    expect(readDurableAgentProfileRuntimeAuthority(db, "run-1")).toEqual({ kind: "invalid" })
  })

  it("recovers a regular Chat run from its immutable binding snapshot", () => {
    db.prepare(
      `INSERT INTO agent_profile_snapshots (id, resolved_json)
       VALUES ('snapshot-regular', ?)`,
    ).run(
      JSON.stringify({
        digest: "c".repeat(64),
        profile: { profileId: "profile-regular", version: 3 },
        capability: {
          ...DEFAULT_AGENT_CAPABILITY,
          skills: ["review"],
        },
      }),
    )
    db.prepare(
      `INSERT INTO agent_profile_run_bindings (run_id, chat_id, snapshot_id)
       VALUES ('run-regular', 'chat-regular', 'snapshot-regular')`,
    ).run()

    expect(readDurableAgentProfileRuntimeAuthority(db, "run-regular")).toEqual({
      kind: "authority",
      authority: expect.objectContaining({
        snapshotId: "snapshot-regular",
        profile: { profileId: "profile-regular", version: 3 },
        allowedSkills: ["review"],
      }),
    })
  })
})

function seedLegacyWorkflowRun(db: Database.Database): void {
  db.prepare(
    "INSERT INTO agent_runs (id, prompt_message_id) VALUES ('run-1', 'workflow-run')",
  ).run()
  db.prepare("INSERT INTO orchestration_agents (run_id, definition) VALUES ('run-1', ?)").run(
    JSON.stringify(workerDefinition()),
  )
  db.prepare(
    `INSERT INTO agent_profile_snapshots (id, resolved_json)
     VALUES ('snapshot-1', ?)`,
  ).run(
    JSON.stringify({
      digest: "a".repeat(64),
      profile: { profileId: "profile-1", version: 1 },
      capability: {
        ...DEFAULT_AGENT_CAPABILITY,
        tools: ["describe"],
        allowedDescendantProfileIds: ["profile-child"],
        maxDescendants: 1,
      },
    }),
  )
  db.prepare(
    `INSERT INTO agent_profile_workflow_bindings
     (workflow_run_id, step_id, snapshot_id)
     VALUES ('workflow-1', 'implement', 'snapshot-1')`,
  ).run()
  db.prepare(
    `INSERT INTO orchestration_transition_events (run_id, entity_id, phase)
     VALUES ('run-1', 'workflow-1:implement', 'workflow-materialized')`,
  ).run()
}

function workerDefinition() {
  return {
    definitionId: "worker-definition",
    role: "implementer",
    prompt: "Implement the task.",
    harness: "codex",
    permissionMode: "read-only",
    worktreeStrategy: "inherit",
    dependencyAgentIds: [],
    completionCriteria: "Implementation complete.",
  }
}
