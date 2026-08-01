import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import {
  AgentProfileChatBindingError,
  AgentProfileChatBindingService,
} from "../src/main/lib/agent-profiles/chat-binding"
import { createAgentProfileService } from "../src/main/lib/agent-profiles/service"
import { configureAgentPersonalityResolutionPort } from "../src/main/lib/agent-profiles/personality-resolution"

const migrations = resolve(process.cwd(), "drizzle")
const personalityId = "11111111-1111-4111-8111-111111111111"
let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  configureAgentPersonalityResolutionPort({
    resolve: () => ({
      metadata: {
        schemaVersion: 1,
        id: personalityId,
        version: 2,
        name: "Exact reviewer",
        scope: { type: "project", projectId: "project-a" },
        base: null,
        traits: {
          tone: "direct",
          verbosity: "terse",
          formatting: "markdown",
          responseStructure: "Outcome then evidence.",
          labels: ["review"],
          color: "#0034ff",
        },
      },
      body: "Use the exact immutable personality body.",
      digest: "f".repeat(64),
    }),
  })
  directory = mkdtempSync(join(tmpdir(), "flapstack-profile-chat-"))
  sqlite = new Database(join(directory, "profile-chat.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: migrations })
  sqlite.pragma("foreign_keys = ON")
  sqlite
    .prepare(
      `INSERT INTO projects
       (id, name, path, default_permission_mode)
       VALUES ('project-a', 'Project A', ?, 'ask-before-edits'),
              ('project-b', 'Project B', ?, 'read-only')`,
    )
    .run(join(directory, "a"), join(directory, "b"))
  sqlite
    .prepare(
      `INSERT INTO tasks
       (id, project_id, name, default_permission_mode)
       VALUES ('task-a', 'project-a', 'Task A', 'read-only')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
       (id, name, scope, project_id, task_id, permission_mode, harness, model)
       VALUES
       ('global-chat', 'Global', 'global', NULL, NULL, 'read-only', 'claude-code', NULL),
       ('project-chat', 'Project', 'project', 'project-a', NULL, 'ask-before-edits', 'claude-code', NULL),
       ('task-chat', 'Task', 'task', 'project-a', 'task-a', 'read-only', 'claude-code', NULL),
       ('other-chat', 'Other', 'project', 'project-b', NULL, 'read-only', 'claude-code', NULL)`,
    )
    .run()
  createAgentProfileService(sqlite).ensureStarterCatalog()
  for (const profileId of [
    "builtin.planner",
    "builtin.implementer",
    "builtin.reviewer",
    "builtin.verifier",
  ]) {
    sqlite
      .prepare(
        `INSERT INTO agent_profile_evaluations
         (id, profile_id, profile_version, runtime, model, state, fixture_set_json,
          evidence_json, evidence_digest, created_at)
         VALUES (?, ?, 1, 'claude-code', 'default-unpinned', 'supported',
                 '[]', '{}', ?, 1)`,
      )
      .run(`evaluation-${profileId}`, profileId, "e".repeat(64))
  }
})

afterEach(() => {
  configureAgentPersonalityResolutionPort(null)
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("regular Chat Agent Profile binding", () => {
  it("searches compatible exact versions and previews all launch dimensions without running", () => {
    const service = new AgentProfileChatBindingService(sqlite)

    for (const chatId of ["global-chat", "project-chat", "task-chat"]) {
      const choices = service.searchForChat(chatId, "planner")
      expect(choices).toContainEqual(
        expect.objectContaining({
          profile: { profileId: "builtin.planner", version: 1 },
          name: "Planner",
        }),
      )
      const preview = service.preview({
        chatId,
        profile: { profileId: "builtin.planner", version: 1 },
      })
      expect(preview).toMatchObject({
        profile: { profileId: "builtin.planner", version: 1 },
        capability: {
          harness: "claude-code",
          runtimePreference: "claude-code",
          permissionMode: "read-only",
          worktreeStrategy: "inherit",
          reasoningEffort: null,
          speedPreference: null,
          skills: [],
        },
        runtimeResolution: {
          preference: "claude-code",
          resolvedRuntime: "claude-code",
        },
      })
    }

    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    expect(sqlite.prepare("SELECT count(*) count FROM agent_profile_chat_bindings").get()).toEqual({
      count: 0,
    })
    expect(() =>
      service.bind({
        chatId: "global-chat",
        profile: { profileId: "builtin.planner", version: 1 },
        expectedDigest: "0".repeat(64),
      }),
    ).toThrow(/preview changed/i)
    expect(sqlite.prepare("SELECT count(*) count FROM agent_profile_chat_bindings").get()).toEqual({
      count: 0,
    })

    expect(
      service.previewForNewChat({
        scope: "task",
        projectId: "project-a",
        taskId: "task-a",
        permissionMode: "read-only",
        runtimePreference: "auto",
        profile: { profileId: "builtin.planner", version: 1 },
      }),
    ).toMatchObject({
      profile: { profileId: "builtin.planner", version: 1 },
      capability: { permissionMode: "read-only" },
    })
  })

  it("stores one exact snapshot, permits idle replacement, then freezes on first run", () => {
    const service = new AgentProfileChatBindingService(sqlite)
    const first = service.bind({
      chatId: "project-chat",
      profile: { profileId: "builtin.planner", version: 1 },
    })
    const replacement = service.bind({
      chatId: "project-chat",
      profile: { profileId: "builtin.reviewer", version: 1 },
    })
    expect(replacement.snapshotId).not.toBe(first.snapshotId)
    expect(() =>
      service.materializeForRun({
        chatId: "project-chat",
        runId: "wrong-provider-run",
        expectedHarness: "codex",
      }),
    ).toThrow(/requires claude-code/i)
    expect(
      sqlite
        .prepare("SELECT frozen_at frozenAt FROM agent_profile_chat_bindings WHERE chat_id = ?")
        .get("project-chat"),
    ).toEqual({ frozenAt: null })

    const run = service.materializeForRun({
      chatId: "project-chat",
      runId: "regular-run-1",
    })
    expect(run).toMatchObject({
      snapshotId: replacement.snapshotId,
      profile: { profileId: "builtin.reviewer", version: 1 },
      instructions: expect.stringContaining("Review the supplied change"),
      launch: {
        harness: "claude-code",
        reasoningEffort: null,
        speedPreference: null,
        serviceTier: null,
      },
    })
    expect(service.materializeForRun({ chatId: "project-chat", runId: "regular-run-1" })).toEqual(
      run,
    )
    expect(() =>
      service.bind({
        chatId: "project-chat",
        profile: { profileId: "builtin.planner", version: 1 },
      }),
    ).toThrow(/started Chat cannot change Agent Profile/i)
  })

  it("refuses to add or clear a profile after any legacy Chat run has started", () => {
    const service = new AgentProfileChatBindingService(sqlite)
    sqlite
      .prepare(
        `INSERT INTO agent_runs
         (id, chat_id, harness, permission_mode, status)
         VALUES ('legacy-run', 'project-chat', 'claude-code', 'read-only', 'success')`,
      )
      .run()

    expect(() =>
      service.bind({
        chatId: "project-chat",
        profile: { profileId: "builtin.planner", version: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "chat-started" }))
    expect(() => service.clear("project-chat")).toThrowError(
      expect.objectContaining({ code: "chat-started" }),
    )
  })

  it("rolls back the exact binding when the Chat capability update fails", () => {
    const service = new AgentProfileChatBindingService(sqlite)
    sqlite
      .prepare(
        `CREATE TRIGGER reject_profile_chat_capability
         BEFORE UPDATE OF harness, model, runtime_preference, permission_mode, custom_permissions
         ON chats BEGIN SELECT RAISE(ABORT, 'capability update rejected'); END`,
      )
      .run()

    expect(() =>
      service.bind({
        chatId: "project-chat",
        profile: { profileId: "builtin.planner", version: 1 },
      }),
    ).toThrow(/capability update rejected/)
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM agent_profile_chat_bindings WHERE chat_id = 'project-chat'",
        )
        .get(),
    ).toEqual({ count: 0 })
  })

  it("surfaces an archived idle selection before launch while preserving frozen provenance", () => {
    const service = new AgentProfileChatBindingService(sqlite)
    service.bind({
      chatId: "project-chat",
      profile: { profileId: "builtin.planner", version: 1 },
    })
    sqlite.prepare("UPDATE agent_profiles SET archived_at = 1 WHERE id = 'builtin.planner'").run()

    expect(service.get("project-chat")).toMatchObject({
      frozen: false,
      available: false,
      invalidReason: expect.stringMatching(/archived/i),
    })
    expect(() =>
      service.materializeForRun({ chatId: "project-chat", runId: "archived-idle-run" }),
    ).toThrow(/archived/i)

    sqlite
      .prepare("UPDATE agent_profiles SET archived_at = NULL WHERE id = 'builtin.planner'")
      .run()
    service.materializeForRun({ chatId: "project-chat", runId: "frozen-run" })
    sqlite.prepare("UPDATE agent_profiles SET archived_at = 1 WHERE id = 'builtin.planner'").run()
    expect(service.get("project-chat")).toMatchObject({
      frozen: true,
      available: true,
      invalidReason: null,
    })
  })

  it("enforces task-primary worktree strategy against the exact Chat checkout", () => {
    insertProjectProfile(sqlite)
    const service = new AgentProfileChatBindingService(sqlite)
    expect(() =>
      service.previewForNewChat({
        scope: "project",
        projectId: "project-a",
        permissionMode: "read-only",
        runtimePreference: "auto",
        profile: { profileId: "project-profile", version: 1 },
      }),
    ).toThrow(/task-primary worktree/i)
    sqlite
      .prepare(
        `UPDATE tasks
         SET primary_worktree_path = 'C:/exact/task-primary', primary_branch = 'task/task-a'
         WHERE id = 'task-a'`,
      )
      .run()
    sqlite.prepare("UPDATE chats SET worktree_path = 'C:/wrong' WHERE id = 'task-chat'").run()
    service.bind({
      chatId: "task-chat",
      profile: { profileId: "project-profile", version: 1 },
    })
    expect(() =>
      service.preview({
        chatId: "task-chat",
        profile: { profileId: "project-profile", version: 1 },
      }),
    ).toThrow(/task-primary worktree/i)
    expect(() =>
      service.materializeForRun({ chatId: "task-chat", runId: "wrong-worktree-run" }),
    ).toThrow(/task-primary worktree/i)

    sqlite
      .prepare("UPDATE chats SET worktree_path = 'C:/exact/task-primary' WHERE id = 'task-chat'")
      .run()
    expect(
      service.materializeForRun({ chatId: "task-chat", runId: "exact-worktree-run" }),
    ).toMatchObject({ launch: { worktreeStrategy: "task-primary" } })
  })

  it("fails visibly on incompatible scope, archive, missing snapshot, and run-id reuse", () => {
    insertProjectProfile(sqlite)
    const service = new AgentProfileChatBindingService(sqlite)
    expect(() =>
      service.bind({
        chatId: "other-chat",
        profile: { profileId: "project-profile", version: 1 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentProfileChatBindingError>>({
        code: "profile-incompatible",
      }),
    )
    expect(sqlite.prepare("SELECT count(*) count FROM agent_profile_chat_bindings").get()).toEqual({
      count: 0,
    })

    sqlite
      .prepare(
        `UPDATE tasks
         SET primary_worktree_path = 'C:/exact/task-primary', primary_branch = 'task/task-a'
         WHERE id = 'task-a'`,
      )
      .run()
    sqlite
      .prepare("UPDATE chats SET worktree_path = 'C:/exact/task-primary' WHERE id = 'task-chat'")
      .run()
    service.bind({
      chatId: "task-chat",
      profile: { profileId: "project-profile", version: 1 },
    })
    expect(
      service.materializeForRun({
        chatId: "task-chat",
        runId: "project-profile-run",
        expectedHarness: "claude-code",
      }),
    ).toMatchObject({
      instructions: expect.stringContaining("Use the exact immutable personality body."),
      personality: {
        ref: { personalityId, version: 2 },
        digest: "f".repeat(64),
      },
      launch: {
        reasoningEffort: "high",
        speedPreference: "standard",
        serviceTier: null,
        worktreeStrategy: "task-primary",
        skills: ["project-skill"],
      },
    })
    sqlite.prepare("UPDATE agent_profiles SET archived_at = 1 WHERE id = 'project-profile'").run()
    expect(() => service.materializeForRun({ chatId: "task-chat", runId: "archived-run" })).toThrow(
      /archived/i,
    )

    sqlite
      .prepare("UPDATE agent_profiles SET archived_at = NULL WHERE id = 'project-profile'")
      .run()
    sqlite.pragma("foreign_keys = OFF")
    sqlite
      .prepare(
        "UPDATE agent_profile_chat_bindings SET snapshot_id = 'missing' WHERE chat_id = 'task-chat'",
      )
      .run()
    sqlite.pragma("foreign_keys = ON")
    expect(() => service.materializeForRun({ chatId: "task-chat", runId: "missing-run" })).toThrow(
      /snapshot is missing/i,
    )

    service.bind({
      chatId: "project-chat",
      profile: { profileId: "builtin.planner", version: 1 },
    })
    service.materializeForRun({ chatId: "project-chat", runId: "shared-run-id" })
    expect(() =>
      service.materializeForRun({ chatId: "global-chat", runId: "shared-run-id" }),
    ).toThrow(/already belongs to another Chat/i)
  })
})

function insertProjectProfile(db: Database.Database) {
  const definition = {
    base: null,
    personality: null,
    inheritCapabilityFields: [],
    inheritPresentationFields: [],
    capability: {
      schemaVersion: 1,
      role: "project-specialist",
      instructions: "Use exact project policy.",
      harness: "claude-code",
      runtimePreference: "claude-code",
      modelPreference: null,
      reasoningEffort: "high",
      speedPreference: "standard",
      tools: [],
      skills: ["project-skill"],
      permissionMode: "read-only",
      customPermissions: null,
      memoryPolicy: { mode: "none" },
      worktreeStrategy: "task-primary",
      allowedDescendantProfileIds: [],
      maxDescendants: 0,
    },
    presentation: {
      schemaVersion: 1,
      tone: "direct",
      verbosity: "balanced",
      formatting: "markdown",
      responseStructure: "Lead with evidence.",
      characterLabel: null,
      voiceLabel: null,
      color: null,
    },
  }
  db.prepare(
    `INSERT INTO agent_profiles
     (id, name, description, category, scope_type, project_id, source,
      current_version, created_at, updated_at)
     VALUES ('project-profile', 'Project Specialist', 'Project only', 'specialist',
             'project', 'project-a', 'user', 1, 1, 1)`,
  ).run()
  db.prepare(
    `INSERT INTO agent_profile_versions
     (profile_id, version, base_profile_id, base_profile_version, capability_json,
      presentation_json, provenance_json, created_at)
     VALUES ('project-profile', 1, NULL, NULL, ?, ?, ?, 1)`,
  ).run(
    JSON.stringify(definition.capability),
    JSON.stringify(definition.presentation),
    JSON.stringify({
      kind: "local",
      sourceLabel: null,
      digest: "a".repeat(64),
      importedAt: null,
      trusted: true,
      disabledRequirements: [],
      personalityRef: { personalityId, version: 2 },
    }),
  )
}
