import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cleanupPersistedStage4Ownership,
  configureStage4OwnershipJournal,
  assertStage4FixtureProject,
  getOwnedStage4ProfileState,
  getOwnedStage4RuntimeState,
  mutateOwnedStage4Profile,
  mutateOwnedStage4Runtime,
  registerStage4Fixture,
  registerStage4FixtureProject,
  registerStage4FixtureWorkflows,
  resetStage4OwnershipForTests,
  simulateStage4OwnershipRestartForTests,
} from "../src/main/lib/mcp-test-control/stage4-ownership"

function fixture(suffix: string) {
  return registerStage4Fixture({
    projectId: `project-${suffix}`,
    chatId: `chat-${suffix}`,
    subChatId: `sub-${suffix}`,
    harness: "codex",
  })
}

beforeEach(() => resetStage4OwnershipForTests())

describe("Stage 4 fixture ownership", () => {
  it("issues fixture authority only for the exact ensure_test_project identity", () => {
    registerStage4FixtureProject({
      projectId: "owned-project",
      projectPath: "C:\\dev\\owned-project",
    })
    expect(() =>
      assertStage4FixtureProject({
        projectId: "owned-project",
        projectPath: "C:\\dev\\owned-project",
      }),
    ).not.toThrow()
    expect(() =>
      assertStage4FixtureProject({
        projectId: "owned-project",
        projectPath: "C:\\dev\\other-directory",
      }),
    ).toThrow(/requires the owned project created by ensure_test_project/i)
    expect(() =>
      assertStage4FixtureProject({
        projectId: "existing-user-project",
        projectPath: "C:\\dev\\owned-project",
      }),
    ).toThrow(/requires the owned project created by ensure_test_project/i)
  })

  it("rejects raw Runtime IDs and derives production inputs from the fixture", () => {
    const fixtureHandle = fixture("one")
    const mutate = vi.fn(() => ({ chatId: "chat-one", runtimePreference: "codex" }))
    const read = vi.fn(() => ({ defaults: [] }))

    expect(() =>
      mutateOwnedStage4Runtime(
        {
          action: "set-empty-chat",
          payload: { fixtureHandle, chatId: "real-user-chat", preference: "codex" },
        },
        mutate,
        read,
      ),
    ).toThrow(/rejects raw chatId/)
    expect(mutate).not.toHaveBeenCalled()

    mutateOwnedStage4Runtime(
      {
        action: "set-empty-chat",
        payload: { fixtureHandle, preference: "codex" },
      },
      mutate,
      read,
    )
    expect(mutate).toHaveBeenCalledWith({
      action: "set-empty-chat",
      payload: { chatId: "chat-one", preference: "codex" },
    })

    expect(() =>
      getOwnedStage4RuntimeState({ fixtureHandle, runId: "real-user-run" }, vi.fn()),
    ).toThrow(/rejects raw runId/)
  })

  it("keeps activity fixture retries idempotent and reuses owned handles", () => {
    const fixtureHandle = fixture("activity-retry")
    const mutate = vi.fn(() => ({
      runs: [{ id: "run-one" }, { id: "run-two" }],
      present: true,
      eventCount: 26,
    }))
    const read = vi.fn()

    const first = mutateOwnedStage4Runtime(
      { action: "seed-activity", payload: { fixtureHandle } },
      mutate,
      read,
    ) as { activityRunHandles: string[] }
    const retry = mutateOwnedStage4Runtime(
      { action: "seed-activity", payload: { fixtureHandle } },
      mutate,
      read,
    ) as { activityRunHandles: string[] }

    expect(retry.activityRunHandles).toEqual(first.activityRunHandles)
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it("keeps profile handles scoped to their issuing fixture", async () => {
    const first = fixture("one")
    const second = fixture("two")
    const mutate = vi.fn(() => ({
      profile: {
        id: "internal-profile",
        currentVersion: 1,
        scope: { type: "project", projectId: "project-one" },
      },
    }))
    const read = vi.fn()
    const created = (await mutateOwnedStage4Profile(
      {
        action: "create",
        payload: {
          fixtureHandle: first,
          name: "Owned",
          description: "Owned fixture",
          category: "test",
          definition: {},
        },
      },
      mutate,
      read,
    )) as { profileHandle: string }

    await expect(
      mutateOwnedStage4Profile(
        {
          action: "update",
          payload: {
            fixtureHandle: second,
            profileHandle: created.profileHandle,
            identity: { name: "Cross fixture" },
            definition: {},
          },
        },
        mutate,
        read,
      ),
    ).rejects.toThrow(/invalid for this fixture/)

    await expect(
      mutateOwnedStage4Profile(
        {
          action: "archive",
          payload: {
            fixtureHandle: first,
            profileId: "internal-profile",
            expectedVersion: 1,
          },
        },
        mutate,
        read,
      ),
    ).rejects.toThrow(/rejects raw profileId/)
  })

  it("rejects raw workflow and standalone identifiers before production dispatch", async () => {
    const fixtureHandle = fixture("one")
    const mutate = vi.fn()
    const read = vi.fn()

    await expect(
      mutateOwnedStage4Profile(
        {
          action: "workflow-bind",
          payload: {
            fixtureHandle,
            workflowRunId: "real-workflow",
            stepId: "implement",
            profileId: "real-profile",
          },
        },
        mutate,
        read,
      ),
    ).rejects.toThrow(/rejects raw profileId/)
    expect(mutate).not.toHaveBeenCalled()

    expect(() =>
      getOwnedStage4ProfileState(
        {
          action: "standalone-get",
          payload: { fixtureHandle, launchId: "real-launch" },
        },
        read,
      ),
    ).toThrow(/rejects raw launchId/)
    expect(read).not.toHaveBeenCalled()
  })

  it("translates issued workflow and profile handles to their exact owned relationship", async () => {
    const fixtureHandle = fixture("one")
    const [workflow] = registerStage4FixtureWorkflows(fixtureHandle, [
      { workflowRunId: "internal-workflow", taskId: "task-one", stepIds: ["implement"] },
    ])
    const read = vi.fn()
    const create = vi.fn(() => ({
      profile: {
        id: "internal-profile",
        currentVersion: 1,
        scope: { type: "project", projectId: "project-one" },
      },
    }))
    const profile = (await mutateOwnedStage4Profile(
      {
        action: "create",
        payload: {
          fixtureHandle,
          name: "Owned",
          description: "Owned fixture",
          category: "test",
          definition: {},
        },
      },
      create,
      read,
    )) as { profileHandle: string }
    const bind = vi.fn(() => ({ version: 1 }))

    await mutateOwnedStage4Profile(
      {
        action: "workflow-bind",
        payload: {
          fixtureHandle,
          workflowHandle: workflow!.workflowHandle,
          stepId: "implement",
          profileHandle: profile.profileHandle,
          workflowRole: "implementer",
        },
      },
      bind,
      read,
    )

    expect(bind).toHaveBeenCalledWith({
      action: "workflow-bind",
      payload: {
        binding: expect.objectContaining({
          workflowRunId: "internal-workflow",
          stepId: "implement",
          profile: { profileId: "internal-profile", version: 1 },
        }),
        expectedVersion: 0,
      },
    })
  })

  it("refreshes profile versions across archive transitions", async () => {
    const fixtureHandle = fixture("one")
    const read = vi.fn()
    const created = (await mutateOwnedStage4Profile(
      {
        action: "create",
        payload: {
          fixtureHandle,
          name: "Owned",
          description: "Owned fixture",
          category: "test",
          definition: {},
        },
      },
      vi.fn(() => ({
        profile: {
          id: "internal-profile",
          currentVersion: 1,
          scope: { type: "project", projectId: "project-one" },
        },
      })),
      read,
    )) as { profileHandle: string }
    const mutate = vi
      .fn()
      .mockReturnValueOnce({
        id: "internal-profile",
        currentVersion: 2,
        scope: { type: "project", projectId: "project-one" },
        archivedAt: 1,
      })
      .mockReturnValueOnce({
        id: "internal-profile",
        currentVersion: 3,
        scope: { type: "project", projectId: "project-one" },
        archivedAt: null,
      })

    await mutateOwnedStage4Profile(
      {
        action: "archive",
        payload: { fixtureHandle, profileHandle: created.profileHandle },
      },
      mutate,
      read,
    )
    await mutateOwnedStage4Profile(
      {
        action: "restore",
        payload: { fixtureHandle, profileHandle: created.profileHandle },
      },
      mutate,
      read,
    )

    expect(mutate).toHaveBeenNthCalledWith(2, {
      action: "restore",
      payload: { profileId: "internal-profile", expectedVersion: 2 },
    })
  })

  it("retains standalone lineage after a confirmed stop for follow-up", async () => {
    const fixtureHandle = fixture("one")
    const read = vi.fn()
    const created = (await mutateOwnedStage4Profile(
      {
        action: "create",
        payload: {
          fixtureHandle,
          name: "Owned",
          description: "Owned fixture",
          category: "test",
          definition: {},
        },
      },
      vi.fn(() => ({
        profile: {
          id: "internal-profile",
          currentVersion: 1,
          scope: { type: "project", projectId: "project-one" },
        },
      })),
      read,
    )) as { profileHandle: string }
    const preview = getOwnedStage4ProfileState(
      {
        action: "standalone-preview",
        payload: { fixtureHandle, profileHandle: created.profileHandle },
      },
      vi.fn(() => ({ digest: "a".repeat(64) })),
    ) as { previewHandle: string }
    const launch = (await mutateOwnedStage4Profile(
      {
        action: "standalone-launch",
        payload: { fixtureHandle, previewHandle: preview.previewHandle },
      },
      vi.fn(() => ({ id: "internal-launch", chatId: "standalone-chat-one" })),
      read,
    )) as { launchHandle: string }
    const stop = vi.fn(() => ({ stopped: true }))

    await mutateOwnedStage4Profile(
      {
        action: "standalone-stop",
        payload: { fixtureHandle, launchHandle: launch.launchHandle },
      },
      stop,
      read,
    )
    const followUp = vi.fn(() => ({
      id: "internal-follow-up",
      launchId: "internal-follow-up",
      chatId: "standalone-chat-one",
    }))
    await expect(
      mutateOwnedStage4Profile(
        {
          action: "standalone-follow-up",
          payload: {
            fixtureHandle,
            launchHandle: launch.launchHandle,
            prompt: "Continue after the confirmed stop.",
          },
        },
        followUp,
        read,
      ),
    ).resolves.toMatchObject({
      id: "internal-follow-up",
      launchHandle: launch.launchHandle,
    })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(followUp).toHaveBeenCalledWith({
      action: "standalone-follow-up",
      payload: {
        launchId: "internal-launch",
        requestId: expect.stringMatching(/^s4_standalone_request_/),
        prompt: "Continue after the confirmed stop.",
      },
    })
  })

  it("retains a continuation handle after false undo and permits an exact retry", () => {
    const fixtureHandle = fixture("one")
    const read = vi.fn(() => ({ defaults: [] }))
    const continuation = mutateOwnedStage4Runtime(
      {
        action: "continue-chat",
        payload: { fixtureHandle, preference: "codex" },
      },
      vi.fn(() => ({ chatId: "continuation-one", created: true })),
      read,
    ) as { continuationHandle: string }
    const mutate = vi
      .fn()
      .mockReturnValueOnce({ undone: false })
      .mockReturnValueOnce({ undone: true })

    expect(
      mutateOwnedStage4Runtime(
        {
          action: "undo-continuation",
          payload: { fixtureHandle, continuationHandle: continuation.continuationHandle },
        },
        mutate,
        read,
      ),
    ).toEqual({ undone: false })
    expect(
      mutateOwnedStage4Runtime(
        {
          action: "undo-continuation",
          payload: { fixtureHandle, continuationHandle: continuation.continuationHandle },
        },
        mutate,
        read,
      ),
    ).toEqual({ undone: true })
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it("recovers orphaned ownership from disk without caller-retained handles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-stage4-ownership-"))
    try {
      configureStage4OwnershipJournal(directory)
      await (async () => {
        const fixtureHandle = fixture("restart")
        const readRuntime = vi.fn(() => ({ defaults: [] }))
        mutateOwnedStage4Runtime(
          {
            action: "write-default",
            payload: { fixtureHandle, preference: "codex" },
          },
          vi.fn(() => ({ version: 1, preference: "codex" })),
          readRuntime,
        )
        mutateOwnedStage4Runtime(
          { action: "seed-activity", payload: { fixtureHandle } },
          vi.fn(() => ({ runs: [{ id: "run-restart" }], present: true })),
          readRuntime,
        )
        mutateOwnedStage4Runtime(
          {
            action: "continue-chat",
            payload: { fixtureHandle, preference: "codex" },
          },
          vi.fn(() => ({ chatId: "continuation-restart", created: true })),
          readRuntime,
        )
        const profile = (await mutateOwnedStage4Profile(
          {
            action: "create",
            payload: {
              fixtureHandle,
              name: "Restart",
              description: "Restart fixture",
              category: "test",
              definition: {},
            },
          },
          vi.fn(() => ({
            profile: {
              id: "profile-restart",
              currentVersion: 2,
              scope: { type: "project", projectId: "project-restart" },
            },
          })),
          vi.fn(),
        )) as { profileHandle: string }
        const exported = (await mutateOwnedStage4Profile(
          {
            action: "export",
            payload: { fixtureHandle, profileHandles: [profile.profileHandle] },
          },
          vi.fn(() => ({ bundle: "PRIVATE_BUNDLE_CONTENT" })),
          vi.fn(),
        )) as { bundleHandle: string }
        await mutateOwnedStage4Profile(
          {
            action: "preview-import",
            payload: { fixtureHandle, bundleHandle: exported.bundleHandle },
          },
          vi.fn(() => ({ previewId: "preview-restart", digest: "c".repeat(64) })),
          vi.fn(),
        )
        registerStage4FixtureWorkflows(fixtureHandle, [
          {
            workflowRunId: "workflow-restart",
            taskId: "task-restart",
            stepIds: ["implement"],
          },
        ])
        const preview = getOwnedStage4ProfileState(
          {
            action: "standalone-preview",
            payload: { fixtureHandle, profileHandle: profile.profileHandle },
          },
          vi.fn(() => ({ digest: "b".repeat(64) })),
        ) as { previewHandle: string }
        await mutateOwnedStage4Profile(
          {
            action: "standalone-launch",
            payload: { fixtureHandle, previewHandle: preview.previewHandle },
          },
          vi.fn(() => ({
            id: "launch-restart",
            chatId: "standalone-chat-restart",
          })),
          vi.fn(),
        )
      })()

      const journal = readFileSync(join(directory, "stage4-runtime-profile-ownership.json"), "utf8")
      expect(journal).not.toContain("standalonePreviews")
      expect(journal).not.toContain("confirmedSnapshotDigest")
      expect(journal).not.toContain("PRIVATE_BUNDLE_CONTENT")
      expect(journal).not.toContain('"bundles"')
      expect(journal).not.toContain('"imports"')
      expect(journal).not.toContain('"workflowBundles"')

      simulateStage4OwnershipRestartForTests()
      let undoAttempts = 0
      const adapters = {
        mutateRuntime: vi.fn((input: { action: string }) => {
          if (input.action === "undo-continuation") {
            undoAttempts += 1
            return { undone: undoAttempts > 1 }
          }
          if (input.action === "cleanup-activity") return { present: false }
          return { deleted: true }
        }),
        readRuntime: vi.fn(() => ({ defaults: [{ version: 1 }] })),
        mutateProfile: vi.fn((input: { action: string }) =>
          input.action === "standalone-stop" ? { stopped: true } : { archivedAt: Date.now() },
        ),
        profileStatus: vi.fn(() => ({
          missing: false,
          archived: false,
          currentVersion: 2,
          projectId: "project-restart",
        })),
        fixtureRelationshipValid: vi.fn(() => true),
        continuationRelationshipValid: vi.fn(() => true),
        standaloneRelationshipValid: vi.fn(() => true),
        workflowRelationshipValid: vi.fn(() => true),
        launchMissing: vi.fn(() => false),
        chatMissingOrArchived: vi.fn((chatId: string) => chatId === "chat-already-gone"),
        taskMissingOrArchived: vi.fn(() => false),
        archiveChat: vi.fn(() => ({ archived: true })),
        archiveTask: vi.fn(() => ({ archived: true })),
      }

      const first = await cleanupPersistedStage4Ownership(adapters)
      expect(first).toMatchObject({ cleanedFixtures: 0, remainingFixtures: 1 })
      expect(first.errors).toEqual([expect.objectContaining({ operation: "undo-continuation" })])
      expect(adapters.archiveChat).toHaveBeenCalledWith("standalone-chat-restart")

      simulateStage4OwnershipRestartForTests()
      const second = await cleanupPersistedStage4Ownership(adapters)
      expect(second).toMatchObject({
        inspectedFixtures: 1,
        cleanedFixtures: 1,
        remainingFixtures: 0,
        errors: [],
      })
      expect(undoAttempts).toBe(2)
      expect(adapters.archiveChat).toHaveBeenCalledWith("chat-restart")
    } finally {
      resetStage4OwnershipForTests()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("quarantines forged journal relationships without mutating unrelated resources", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-stage4-forged-"))
    const persisted = (suffix: string) => ({
      fixtureHandle: `s4_fixture_${suffix}`,
      projectId: `project-${suffix}`,
      chatId: `fixture-chat-${suffix}`,
      subChatId: `fixture-sub-${suffix}`,
      harness: "codex",
      defaultVersion: null,
      activitySeeded: false,
      activityRuns: [],
      continuations: [],
      profiles: [],
      workflows: [],
      workflowVersions: [],
      standaloneLaunches: [],
    })
    try {
      const continuation = persisted("continuation")
      continuation.continuations.push([
        "s4_continuation_forged",
        "unrelated-continuation-chat",
      ] as never)
      const standalone = persisted("standalone")
      standalone.standaloneLaunches.push([
        "s4_launch_forged",
        { launchId: "unrelated-launch", chatId: "unrelated-standalone-chat" },
      ] as never)
      const profile = persisted("profile")
      profile.profiles.push([
        "s4_profile_forged",
        { profileId: "unrelated-profile", version: 1, projectId: "project-profile" },
      ] as never)
      const workflow = persisted("workflow")
      workflow.workflows.push([
        "s4_workflow_forged",
        {
          workflowRunId: "unrelated-workflow",
          taskId: "unrelated-task",
          stepIds: ["implement"],
        },
      ] as never)
      writeFileSync(
        join(directory, "stage4-runtime-profile-ownership.json"),
        JSON.stringify({
          schemaVersion: 1,
          fixtures: [continuation, standalone, profile, workflow],
        }),
      )
      configureStage4OwnershipJournal(directory)
      const mutateRuntime = vi.fn()
      const mutateProfile = vi.fn()
      const archiveChat = vi.fn()
      const archiveTask = vi.fn()
      const result = await cleanupPersistedStage4Ownership({
        mutateRuntime,
        readRuntime: vi.fn(() => ({ defaults: [] })),
        mutateProfile,
        profileStatus: vi.fn(() => ({
          missing: false,
          archived: false,
          currentVersion: 1,
          projectId: "unrelated-project",
        })),
        fixtureRelationshipValid: vi.fn(() => true),
        continuationRelationshipValid: vi.fn(() => false),
        standaloneRelationshipValid: vi.fn(() => false),
        workflowRelationshipValid: vi.fn(() => false),
        launchMissing: vi.fn(() => false),
        chatMissingOrArchived: vi.fn(() => false),
        taskMissingOrArchived: vi.fn(() => false),
        archiveChat,
        archiveTask,
      })

      expect(result).toMatchObject({ cleanedFixtures: 0, remainingFixtures: 4 })
      expect(result.errors.map((error) => error.operation)).toEqual(
        expect.arrayContaining([
          "undo-continuation",
          "stop-standalone",
          "archive-profile",
          "archive-workflow-task",
        ]),
      )
      expect(mutateRuntime).not.toHaveBeenCalled()
      expect(mutateProfile).not.toHaveBeenCalled()
      expect(archiveTask).not.toHaveBeenCalled()
      expect(archiveChat).not.toHaveBeenCalledWith("unrelated-standalone-chat")
    } finally {
      resetStage4OwnershipForTests()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("rejects malformed nested journal records before recovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-stage4-malformed-"))
    try {
      writeFileSync(
        join(directory, "stage4-runtime-profile-ownership.json"),
        JSON.stringify({
          schemaVersion: 1,
          fixtures: [
            {
              fixtureHandle: "s4_fixture_malformed",
              projectId: "project",
              chatId: "chat",
              subChatId: "sub",
              harness: "codex",
              defaultVersion: null,
              activitySeeded: false,
              activityRuns: [],
              continuations: [],
              profiles: [],
              workflows: [],
              workflowVersions: [],
              standaloneLaunches: [["s4_launch_bad", "not-an-object"]],
            },
          ],
        }),
      )
      expect(() => configureStage4OwnershipJournal(directory)).toThrow(
        /ownership journal is invalid/,
      )
    } finally {
      resetStage4OwnershipForTests()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
