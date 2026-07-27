import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_CAPABILITY, DEFAULT_AGENT_PRESENTATION } from "../src/shared/agent-profiles"
import * as schema from "../src/main/lib/db/schema"
import {
  getStage4ProfileState,
  getStage4RuntimeState,
  mutateStage4Profile,
  mutateStage4Runtime,
  sanitizeStage4ControlBoundary,
} from "../src/main/lib/mcp-test-control/stage4-runtime-profiles"
import {
  cleanupPersistedStage4Ownership,
  configureStage4OwnershipJournal,
  getOwnedStage4ProfileState,
  mutateOwnedStage4Profile,
  registerStage4Fixture,
  resetStage4OwnershipForTests,
  simulateStage4OwnershipRestartForTests,
} from "../src/main/lib/mcp-test-control/stage4-ownership"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"

vi.mock("../src/main/lib/main-run-launcher", () => ({
  getMainRuntimeLaunchService: (path: string) => ({
    cancel: async (runId: string) => {
      const db = new Database(path)
      try {
        db.prepare(
          "UPDATE agent_runs SET status = 'cancelled', completed_at = unixepoch() WHERE id = ?",
        ).run(runId)
      } finally {
        db.close()
      }
      return true
    },
    reconcileRun: async () => ({ state: "completed" }),
  }),
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

let directory: string
let databasePath: string
let database: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-stage4-control-"))
  databasePath = join(directory, "agents.db")
  database = new Database(databasePath)
  database.pragma("foreign_keys = ON")
  migrate(drizzle(database, { schema }), { migrationsFolder: resolve("drizzle") })
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
    .run(resolve("."))
  database
    .prepare(
      `INSERT INTO chats
       (id, name, project_id, scope, permission_mode, harness, runtime_preference,
        initiator_chat_id, ancestor_chat_ids, worktree_path, created_at, updated_at)
       VALUES ('chat-1', 'Runtime chat', 'project-1', 'project', 'read-only', 'codex',
        'auto', 'chat-1', '[]', ?, 1, 1)`,
    )
    .run(resolve("."))
  database
    .prepare(
      `INSERT INTO sub_chats
       (id, chat_id, name, mode, harness, permission_mode, worktree_path, messages,
        created_at, updated_at)
       VALUES ('sub-1', 'chat-1', 'Runtime chat', 'write', 'codex', 'read-only', ?,
        '[]', 1, 1)`,
    )
    .run(resolve("."))
})

afterEach(() => {
  resetStage4OwnershipForTests()
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("Stage 4 Runtime test control", () => {
  it("uses production defaults, chat lifecycle, diagnostics, and durable activity stores", () => {
    expect(
      mutateStage4Runtime(database, {
        action: "write-default",
        payload: {
          scope: { type: "global", id: null },
          harness: "codex",
          preference: "codex-enhanced",
          expectedVersion: 0,
        },
      }),
    ).toMatchObject({ preference: "codex-enhanced", version: 1 })
    expect(
      mutateStage4Runtime(database, {
        action: "set-empty-chat",
        payload: { chatId: "chat-1", preference: "codex" },
      }),
    ).toEqual({ chatId: "chat-1", runtimePreference: "codex" })

    const fixture = mutateStage4Runtime(database, {
      action: "seed-activity",
      payload: { projectId: "project-1", chatId: "chat-1", subChatId: "sub-1" },
    })
    expect(fixture).toMatchObject({ present: true, eventCount: 26 })

    const state = getStage4RuntimeState(database, {
      chatId: "chat-1",
      runId: (fixture as { runs: Array<{ id: string }> }).runs[0]!.id,
      activityLimit: 5,
    })
    expect(state.defaults).toEqual([
      expect.objectContaining({ harness: "codex", preference: "codex-enhanced" }),
    ])
    expect(state.diagnostics).toMatchObject({
      chatId: "chat-1",
      activity: { count: 26 },
    })
    expect(state.activity).toMatchObject({ events: expect.arrayContaining([expect.any(Object)]) })

    expect(
      mutateStage4Runtime(database, {
        action: "cleanup-activity",
        payload: { projectId: "project-1", chatId: "chat-1", subChatId: "sub-1" },
      }),
    ).toMatchObject({ present: false, eventCount: 0 })
    expect(
      mutateStage4Runtime(database, {
        action: "delete-default",
        payload: {
          scope: { type: "global", id: null },
          harness: "codex",
          expectedVersion: 1,
        },
      }),
    ).toEqual({ deleted: true })
  })

  it("creates a new continuation for started chats and rejects in-place mutation", () => {
    database
      .prepare("UPDATE sub_chats SET messages = ? WHERE id = 'sub-1'")
      .run(
        JSON.stringify([{ id: "a", role: "assistant", parts: [{ type: "text", text: "done" }] }]),
      )
    expect(() =>
      mutateStage4Runtime(database, {
        action: "set-empty-chat",
        payload: { chatId: "chat-1", preference: "codex-enhanced" },
      }),
    ).toThrow(/Continue with the selected Runtime/)

    const continuation = mutateStage4Runtime(database, {
      action: "continue-chat",
      payload: {
        sourceChatId: "chat-1",
        preference: "codex-enhanced",
        requestId: "stage4-runtime-live-proof",
      },
    })
    expect(continuation).toMatchObject({
      sourceChatId: "chat-1",
      runtimePreference: "codex-enhanced",
      created: true,
    })
    expect(
      mutateStage4Runtime(database, {
        action: "undo-continuation",
        payload: {
          sourceChatId: "chat-1",
          targetChatId: (continuation as { chatId: string }).chatId,
        },
      }),
    ).toEqual({ undone: true })
  })
})

describe("Stage 4 Agent Profile test control", () => {
  it("recovers a real AgentProfileDto project scope after an ownership restart", async () => {
    configureStage4OwnershipJournal(directory)
    await (async () => {
      const fixtureHandle = registerStage4Fixture({
        projectId: "project-1",
        chatId: "chat-1",
        subChatId: "sub-1",
        harness: "codex",
      })
      mutateStage4Profile(database, databasePath, { action: "ensure-starters", payload: {} })
      const starter = getStage4ProfileState(database, databasePath, {
        action: "get",
        payload: { profileId: "builtin.planner", version: 1 },
      }) as { version: { definition: unknown } }
      await mutateOwnedStage4Profile(
        {
          action: "create",
          payload: {
            fixtureHandle,
            name: "Real DTO recovery",
            description: "Real production AgentProfileDto scope",
            category: "test",
            definition: starter.version.definition,
          },
        },
        (input) =>
          mutateStage4Profile(
            database,
            databasePath,
            input as Parameters<typeof mutateStage4Profile>[2],
          ),
        (input) =>
          getStage4ProfileState(
            database,
            databasePath,
            input as Parameters<typeof getStage4ProfileState>[2],
          ),
      )
    })()
    simulateStage4OwnershipRestartForTests()

    const recovered = await cleanupPersistedStage4Ownership({
      mutateRuntime: (input) =>
        mutateStage4Runtime(database, input as Parameters<typeof mutateStage4Runtime>[1]),
      readRuntime: (input) => getStage4RuntimeState(database, input),
      mutateProfile: (input) =>
        mutateStage4Profile(
          database,
          databasePath,
          input as Parameters<typeof mutateStage4Profile>[2],
        ),
      profileStatus: (profileId) => {
        const row = database
          .prepare(
            "SELECT project_id projectId, current_version currentVersion, archived_at archivedAt FROM agent_profiles WHERE id = ?",
          )
          .get(profileId) as
          | { projectId: string | null; currentVersion: number; archivedAt: number | null }
          | undefined
        return {
          missing: !row,
          archived: Boolean(row?.archivedAt),
          currentVersion: row?.currentVersion ?? null,
          projectId: row?.projectId ?? null,
        }
      },
      fixtureRelationshipValid: ({ projectId, chatId, subChatId }) =>
        Boolean(
          database
            .prepare(
              `SELECT 1 FROM chats c
               JOIN sub_chats s ON s.chat_id = c.id
               WHERE c.id = ? AND c.project_id = ? AND s.id = ?`,
            )
            .get(chatId, projectId, subChatId),
        ),
      continuationRelationshipValid: () => true,
      standaloneRelationshipValid: () => true,
      workflowRelationshipValid: () => true,
      launchMissing: () => true,
      chatMissingOrArchived: (chatId) => {
        const row = database
          .prepare("SELECT archived_at archivedAt FROM chats WHERE id = ?")
          .get(chatId) as { archivedAt: number | null } | undefined
        return !row || Boolean(row.archivedAt)
      },
      taskMissingOrArchived: () => true,
      archiveChat: (chatId) =>
        database.prepare("UPDATE chats SET archived_at = 1 WHERE id = ?").run(chatId),
      archiveTask: () => undefined,
    })

    expect(recovered).toMatchObject({
      inspectedFixtures: 1,
      cleanedFixtures: 1,
      remainingFixtures: 0,
      errors: [],
    })
    expect(
      database
        .prepare(
          "SELECT count(*) count FROM agent_profiles WHERE name = 'Real DTO recovery' AND archived_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ count: 1 })
  })

  it("owns follow-up, retry, updated-profile continuation, stop, and cleanup by handles", async () => {
    configureStage4OwnershipJournal(directory)
    const fixtureHandle = registerStage4Fixture({
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      harness: "codex",
    })
    const mutateOwned = (action: string, payload: Record<string, unknown>) =>
      mutateOwnedStage4Profile(
        { action, payload: { fixtureHandle, ...payload } },
        (input) =>
          mutateStage4Profile(
            database,
            databasePath,
            input as Parameters<typeof mutateStage4Profile>[2],
          ),
        (input) =>
          getStage4ProfileState(
            database,
            databasePath,
            input as Parameters<typeof getStage4ProfileState>[2],
          ),
      )
    const readOwned = (action: string, payload: Record<string, unknown>) =>
      getOwnedStage4ProfileState({ action, payload: { fixtureHandle, ...payload } }, (input) =>
        getStage4ProfileState(
          database,
          databasePath,
          input as Parameters<typeof getStage4ProfileState>[2],
        ),
      )

    const starters = (await mutateOwned("ensure-starters", {})) as {
      starterProfileHandles: string[]
    }
    expect(starters.starterProfileHandles.length).toBeGreaterThan(0)
    const definition = {
      base: null,
      inheritCapabilityFields: [],
      inheritPresentationFields: [],
      capability: structuredClone(DEFAULT_AGENT_CAPABILITY),
      presentation: structuredClone(DEFAULT_AGENT_PRESENTATION),
    }
    const created = (await mutateOwned("create", {
      name: "Owned lifecycle profile",
      description: "Exercises every standalone lifecycle action",
      category: "test",
      definition,
    })) as { profileHandle: string }
    expect(
      readOwned("list", {
        query: "Owned lifecycle profile",
        includeArchived: true,
      }),
    ).toEqual([
      expect.objectContaining({
        name: "Owned lifecycle profile",
        profileHandle: expect.any(String),
      }),
    ])

    const preview = readOwned("standalone-preview", {
      profileHandle: created.profileHandle,
    }) as { previewHandle: string }
    const launched = (await mutateOwned("standalone-launch", {
      previewHandle: preview.previewHandle,
    })) as { launchHandle: string; id: string; chatId: string }
    await expect(mutateOwned("standalone-stop", { launchId: launched.id })).rejects.toThrow(
      /rejects raw launchId/i,
    )
    await expect(
      mutateOwned("standalone-stop", { launchHandle: launched.launchHandle }),
    ).resolves.toMatchObject({ stopped: true, launchHandle: launched.launchHandle })

    const followed = (await mutateOwned("standalone-follow-up", {
      launchHandle: launched.launchHandle,
      prompt: "Continue the owned lifecycle proof.",
    })) as { launchHandle: string; id: string; chatId: string }
    expect(followed).toMatchObject({
      launchHandle: launched.launchHandle,
      chatId: launched.chatId,
    })
    expect(followed.id).not.toBe(launched.id)
    await mutateOwned("standalone-stop", { launchHandle: launched.launchHandle })

    const retried = (await mutateOwned("standalone-retry", {
      launchHandle: launched.launchHandle,
    })) as { launchHandle: string; id: string; chatId: string }
    expect(retried).toMatchObject({
      launchHandle: launched.launchHandle,
      chatId: launched.chatId,
    })
    expect(retried.id).not.toBe(followed.id)
    await mutateOwned("standalone-stop", { launchHandle: launched.launchHandle })

    await mutateOwned("update", {
      profileHandle: created.profileHandle,
      definition,
    })
    const continuationPreview = readOwned("standalone-preview", {
      launchHandle: launched.launchHandle,
      profileHandle: created.profileHandle,
      includeParentChat: true,
    }) as { previewHandle: string }
    const continued = (await mutateOwned("standalone-continue-with-updated-profile", {
      launchHandle: launched.launchHandle,
      previewHandle: continuationPreview.previewHandle,
    })) as {
      previousLaunchHandle: string
      launchHandle: string
      id: string
      chatId: string
    }
    expect(continued.previousLaunchHandle).toBe(launched.launchHandle)
    expect(continued.launchHandle).not.toBe(launched.launchHandle)
    expect(continued.chatId).not.toBe(launched.chatId)

    simulateStage4OwnershipRestartForTests()
    const recovered = await cleanupPersistedStage4Ownership({
      mutateRuntime: (input) =>
        mutateStage4Runtime(database, input as Parameters<typeof mutateStage4Runtime>[1]),
      readRuntime: (input) => getStage4RuntimeState(database, input),
      mutateProfile: (input) =>
        mutateStage4Profile(
          database,
          databasePath,
          input as Parameters<typeof mutateStage4Profile>[2],
        ),
      profileStatus: (profileId) => {
        const row = database
          .prepare(
            `SELECT project_id projectId, current_version currentVersion, archived_at archivedAt
             FROM agent_profiles WHERE id = ?`,
          )
          .get(profileId) as
          | { projectId: string | null; currentVersion: number; archivedAt: number | null }
          | undefined
        return {
          missing: !row,
          archived: Boolean(row?.archivedAt),
          currentVersion: row?.currentVersion ?? null,
          projectId: row?.projectId ?? null,
        }
      },
      fixtureRelationshipValid: ({ projectId, chatId, subChatId }) =>
        Boolean(
          database
            .prepare(
              `SELECT 1 FROM chats c JOIN sub_chats s ON s.chat_id = c.id
               WHERE c.id = ? AND c.project_id = ? AND s.id = ?`,
            )
            .get(chatId, projectId, subChatId),
        ),
      continuationRelationshipValid: () => true,
      standaloneRelationshipValid: ({ projectId, launchId, chatId }) =>
        Boolean(
          database
            .prepare(
              `SELECT 1 FROM agent_profile_standalone_launches l
               JOIN chats c ON c.id = l.chat_id
               WHERE l.id = ? AND l.chat_id = ? AND c.project_id = ?`,
            )
            .get(launchId, chatId, projectId),
        ),
      workflowRelationshipValid: () => true,
      launchMissing: (launchId) =>
        !database
          .prepare("SELECT 1 FROM agent_profile_standalone_launches WHERE id = ?")
          .get(launchId),
      chatMissingOrArchived: (chatId) => {
        const row = database
          .prepare("SELECT archived_at archivedAt FROM chats WHERE id = ?")
          .get(chatId) as { archivedAt: number | null } | undefined
        return !row || Boolean(row.archivedAt)
      },
      taskMissingOrArchived: () => true,
      archiveChat: (chatId) =>
        database.prepare("UPDATE chats SET archived_at = 1 WHERE id = ?").run(chatId),
      archiveTask: () => undefined,
    })
    expect(recovered).toMatchObject({
      inspectedFixtures: 1,
      cleanedFixtures: 1,
      remainingFixtures: 0,
      errors: [],
    })
  })

  it("redacts secret-like legacy profile content from read results", () => {
    expect(sanitizeStage4ControlBoundary("ask-before-edits")).toBe("ask-before-edits")
    mutateStage4Profile(database, databasePath, { action: "ensure-starters", payload: {} })
    const row = database
      .prepare(
        "SELECT capability_json FROM agent_profile_versions WHERE profile_id = 'builtin.planner' AND version = 1",
      )
      .get() as { capability_json: string }
    const capability = JSON.parse(row.capability_json)
    capability.instructions = "api_key=supersecretcredential"
    database.prepare("DROP TRIGGER agent_profile_versions_no_update").run()
    database
      .prepare(
        "UPDATE agent_profile_versions SET capability_json = ? WHERE profile_id = 'builtin.planner' AND version = 1",
      )
      .run(JSON.stringify(capability))

    const state = getStage4ProfileState(database, databasePath, {
      action: "get",
      payload: { profileId: "builtin.planner", version: 1 },
    })
    expect(JSON.stringify(state)).not.toContain("supersecretcredential")
    expect(JSON.stringify(state)).toContain("[redacted]")
  })

  it("covers import, versioning, resolution, duplicate, archive, and export", async () => {
    mutateStage4Profile(database, databasePath, {
      action: "ensure-starters",
      payload: {},
    })
    const exported = mutateStage4Profile(database, databasePath, {
      action: "export",
      payload: { profiles: [{ profileId: "builtin.planner", version: 1 }] },
    }) as { bundle: string }
    const preview = mutateStage4Profile(database, databasePath, {
      action: "preview-import",
      payload: { bundle: exported.bundle, sourceLabel: "Stage 4 MCP acceptance" },
    }) as { previewId: string; digest: string }
    const imported = mutateStage4Profile(database, databasePath, {
      action: "confirm-import",
      payload: {
        previewId: preview.previewId,
        expectedDigest: preview.digest,
        conflict: "duplicate",
        projectId: "project-1",
      },
    }) as Array<{ id: string; currentVersion: number }>
    const profileId = imported[0]!.id

    const current = getStage4ProfileState(database, databasePath, {
      action: "get",
      payload: { profileId, version: 1 },
    }) as { version: { definition: unknown } }
    const updated = mutateStage4Profile(database, databasePath, {
      action: "update",
      payload: {
        profileId,
        expectedVersion: 1,
        identity: { name: "Imported Planner v2" },
        definition: current.version.definition,
      },
    }) as { profile: { currentVersion: number } }
    expect(updated.profile.currentVersion).toBe(2)

    const resolved = getStage4ProfileState(database, databasePath, {
      action: "resolve",
      payload: {
        profile: { profileId, version: 2 },
        overrides: null,
        policy: {
          permissionMode: "read-only",
          customPermissions: null,
          allowedTools: null,
          allowedSkills: null,
          allowedModels: null,
          allowedRuntimes: null,
          maxDescendants: 0,
        },
      },
    })
    expect(resolved).toMatchObject({ profile: { profileId, version: 2 }, conflicts: [] })

    const duplicated = mutateStage4Profile(database, databasePath, {
      action: "duplicate",
      payload: {
        profile: { profileId, version: 2 },
        name: "Planner copy",
        scope: { type: "project", projectId: "project-1" },
      },
    }) as { profile: { id: string; currentVersion: number } }
    expect(duplicated.profile.id).not.toBe(profileId)
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "archive",
        payload: { profileId: duplicated.profile.id, expectedVersion: 1 },
      }),
    ).toMatchObject({ archivedAt: expect.any(Number) })
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "restore",
        payload: { profileId: duplicated.profile.id, expectedVersion: 1 },
      }),
    ).toMatchObject({ archivedAt: null })
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "list",
        payload: { projectId: "project-1" },
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: duplicated.profile.id })]))
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "list",
        payload: {
          projectId: "project-1",
          query: "Planner copy",
          includeArchived: true,
        },
      }),
    ).toEqual([expect.objectContaining({ id: duplicated.profile.id, archivedAt: null })])
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "audit",
        payload: { profileId: duplicated.profile.id },
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ action: "restored" })]))
  })

  it("binds workflow profiles and prepares a standalone launch without dispatching a provider", async () => {
    seedWorkflow()
    mutateStage4Profile(database, databasePath, { action: "ensure-starters", payload: {} })
    const starter = getStage4ProfileState(database, databasePath, {
      action: "get",
      payload: { profileId: "builtin.planner", version: 1 },
    }) as { version: { definition: unknown } }
    const created = mutateStage4Profile(database, databasePath, {
      action: "create",
      payload: {
        name: "Stage 4 MCP planner",
        description: "Production lifecycle proof",
        category: "test",
        scope: { type: "project", projectId: "project-1" },
        definition: starter.version.definition,
      },
    }) as { profile: { id: string } }
    const binding = {
      schemaVersion: 1,
      workflowRunId: "workflow-1",
      stepId: "implement",
      profile: { profileId: created.profile.id, version: 1 },
      workflowRole: "planner",
      inputSchema: null,
      outputSchema: { result: { type: "string" } },
      overrides: null,
    }
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "workflow-bind",
        payload: { binding, expectedVersion: 0 },
      }),
    ).toMatchObject({ version: 1, snapshotId: null })
    const workflowPreview = getStage4ProfileState(database, databasePath, {
      action: "workflow-preview",
      payload: { workflowRunId: "workflow-1", stepId: "implement" },
    })
    expect(workflowPreview).toMatchObject({ profile: { profileId: created.profile.id } })
    const workflowBundle = mutateStage4Profile(database, databasePath, {
      action: "workflow-export",
      payload: { workflowRunId: "workflow-1", stepId: "implement" },
    }) as { bundle: string }
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "workflow-import",
        payload: {
          bundle: workflowBundle.bundle,
          workflowRunId: "workflow-2",
          stepId: "implement",
          expectedVersion: 0,
        },
      }),
    ).toMatchObject({ version: 1 })
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "workflow-get",
        payload: { workflowRunId: "workflow-1", stepId: "implement" },
      }),
    ).toMatchObject({ version: 1 })
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "workflow-list",
        payload: { workflowRunId: "workflow-1" },
      }),
    ).toEqual([expect.objectContaining({ version: 1 })])
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "workflow-fork",
        payload: {
          sourceWorkflowRunId: "workflow-2",
          sourceStepId: "implement",
          targetWorkflowRunId: "workflow-3",
          targetStepId: "implement",
        },
      }),
    ).toMatchObject({ version: 1 })
    expect(
      mutateStage4Profile(database, databasePath, {
        action: "workflow-confirm",
        payload: { workflowRunId: "workflow-1", stepId: "implement", expectedVersion: 1 },
      }),
    ).toMatchObject({ snapshot: { profile: { profileId: created.profile.id } } })

    const standalonePreview = getStage4ProfileState(database, databasePath, {
      action: "standalone-preview",
      payload: {
        requestId: "standalone-stage4-proof",
        source: { kind: "studio", projectId: "project-1" },
        profile: { profileId: created.profile.id, version: 1 },
        context: { includeTask: false, includeParentChat: false },
        overrides: null,
        orchestrationTaskId: null,
        confirmedSnapshotDigest: "0".repeat(64),
      },
    }) as { digest: string }
    const standalone = await mutateStage4Profile(database, databasePath, {
      action: "standalone-launch",
      payload: {
        requestId: "standalone-stage4-proof",
        source: { kind: "studio", projectId: "project-1" },
        profile: { profileId: created.profile.id, version: 1 },
        context: { includeTask: false, includeParentChat: false },
        overrides: null,
        orchestrationTaskId: null,
        confirmedSnapshotDigest: standalonePreview.digest,
      },
    })
    expect(standalone).toMatchObject({
      requestId: "standalone-stage4-proof",
      state: "pending",
      runStatus: "pending",
    })
    expect(
      getStage4ProfileState(database, databasePath, {
        action: "standalone-get",
        payload: { launchId: (standalone as { id: string }).id },
      }),
    ).toMatchObject({ requestId: "standalone-stage4-proof" })
    const unchangedContinuation = {
      requestId: "standalone-stage4-unchanged-continuation",
      source: { kind: "chat", chatId: (standalone as { chatId: string }).chatId },
      profile: { profileId: created.profile.id, version: 1 },
      context: { includeTask: false, includeParentChat: true },
      overrides: null,
      orchestrationTaskId: null,
      confirmedSnapshotDigest: "0".repeat(64),
    }
    const unchangedPreview = getStage4ProfileState(database, databasePath, {
      action: "standalone-preview",
      payload: unchangedContinuation,
    }) as { digest: string }
    await expect(
      mutateStage4Profile(database, databasePath, {
        action: "standalone-continue-with-updated-profile",
        payload: {
          launchId: (standalone as { id: string }).id,
          launch: {
            ...unchangedContinuation,
            confirmedSnapshotDigest: unchangedPreview.digest,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "run-active" })
    await expect(
      mutateStage4Profile(database, databasePath, {
        action: "standalone-stop",
        payload: { launchId: (standalone as { id: string }).id },
      }),
    ).resolves.toMatchObject({ stopped: true })
    await expect(
      mutateStage4Profile(database, databasePath, {
        action: "standalone-continue-with-updated-profile",
        payload: {
          launchId: (standalone as { id: string }).id,
          launch: {
            ...unchangedContinuation,
            confirmedSnapshotDigest: unchangedPreview.digest,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "launch-blocked" })
  })
})

function seedWorkflow(): void {
  database
    .prepare(
      `INSERT INTO tasks
     (id, project_id, name, description, default_permission_mode,
      primary_worktree_path, created_at, updated_at)
     VALUES ('task-1', 'project-1', 'Task', 'Task context', 'read-only', ?, 1, 1)`,
    )
    .run(resolve("."))
  database
    .prepare(
      `INSERT INTO chats
     (id, name, project_id, task_id, scope, permission_mode, harness,
      initiator_chat_id, ancestor_chat_ids, created_at, updated_at)
     VALUES ('workflow-chat', 'Workflow', 'project-1', 'task-1', 'task', 'read-only',
      'codex', 'workflow-chat', '[]', 1, 1)`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO task_orchestrations
     (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
      engine_snapshot_version, coordination_engine, coordination_engine_version,
      coordination_engine_source, coordination_engine_capability_snapshot,
      coordination_engine_provider_identity, created_at, updated_at)
     VALUES ('task-1', 'workflow-chat', 'running', 1, 8, '{}', ?, ?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(...testCoordinationEngineSnapshotSqlValues())
  database
    .prepare(
      `INSERT INTO orchestration_workflow_runs
     (id, task_id, status, definition_json, created_at, updated_at)
     VALUES ('workflow-1', 'task-1', 'running', ?, 1, 1)`,
    )
    .run(
      JSON.stringify({
        schemaVersion: 1,
        engine: "workflow",
        agents: [
          {
            agentId: "template-agent-implement",
            definitionId: "definition-implement",
            role: "implement",
            name: "Template implement",
            prompt: "Complete implement.",
            harness: "codex",
            runtimePreference: "codex",
            permissionMode: "read-only",
            worktreeStrategy: "inherit",
            dependencyAgentIds: [],
            completionCriteria: "Complete implement.",
          },
        ],
        policy: {
          maxParallelAgents: 4,
          maxDepth: 8,
          maxTotalAgents: 16,
          maxTotalTokens: null,
          maxCostUsdMicros: null,
          allowSpawn: false,
        },
        workflow: {
          schemaVersion: 1,
          steps: [
            {
              id: "implement",
              kind: "agent",
              agentDefinitionId: "definition-implement",
              dependsOn: [],
              childStepIds: [],
              condition: null,
              thenStepIds: [],
              elseStepIds: [],
              bodyStepIds: [],
              maxIterations: 1,
              timeoutMs: null,
              maxRetries: 0,
              outputSchema: { result: { type: "string" } },
            },
          ],
        },
        presentationStyle: null,
      }),
    )
  database
    .prepare(
      `INSERT INTO orchestration_workflow_runs
       (id, task_id, status, definition_json, created_at, updated_at)
       SELECT 'workflow-2', task_id, status, definition_json, created_at, updated_at
       FROM orchestration_workflow_runs WHERE id = 'workflow-1'`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO orchestration_workflow_runs
       (id, task_id, status, definition_json, created_at, updated_at)
       SELECT 'workflow-3', task_id, status, definition_json, created_at, updated_at
       FROM orchestration_workflow_runs WHERE id = 'workflow-1'`,
    )
    .run()
}
