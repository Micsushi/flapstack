#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  flapstackProfilePath,
  resolveDevMcpDescriptorPath,
  resolveDevMcpProfile,
} from "./lib/profile-paths.mjs"
import { cleanupRuntimeProfileProof } from "./lib/runtime-profile-cleanup.mjs"

const checkout = await realpath(resolve(process.cwd()))
const profile = resolveDevMcpProfile()
const descriptor = JSON.parse(await readFile(resolveDevMcpDescriptorPath(profile), "utf8"))

assert((await realpath(descriptor.checkout)) === checkout, "Dev MCP checkout mismatch")
assert(
  (await realpath(descriptor.userDataPath)) === (await realpath(flapstackProfilePath(profile))),
  "Dev MCP profile path mismatch",
)
assert(descriptor.profile === profile, "Dev MCP profile identity mismatch")
assert(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(descriptor.url), "Invalid dev MCP URL")
assert(descriptor.token, "Missing dev MCP token")

const client = new Client({ name: "flapstack-live-runtime-profiles", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
let testProject = null
let chat = null
let importedProfile = null
let createdProfile = null
let standaloneProfile = null
let standaloneLaunch = null
let standaloneLaunches = []
let standaloneStopped = false
let continuation = null
let continuationUndone = false
let originalDefault = null
let writtenDefault = null
let activitySeeded = false
let proofOutput = null
let proofError = null
let workflowTaskId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function toolResult(response) {
  if (response.isError) {
    const message = response.content?.find((item) => item.type === "text")?.text
    throw new Error(message || "Dev MCP tool failed")
  }
  return response.structuredContent?.result
}

async function call(name, args = {}) {
  return toolResult(await client.callTool({ name, arguments: args }))
}

try {
  await client.connect(transport)
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live checkout mismatch")
  assert(
    environment.app?.channel === "development" && environment.app?.protocol === "flapstack-dev",
    "Live environment is not the exact Dev app identity",
  )
  testProject = await call("ensure_test_project")
  chat = await call("create_test_orchestration_fixture", {
    chatName: `Stage 4 Runtime/Profile proof ${Date.now()}`,
    harness: "codex",
  })
  const projectId = chat.projectId
  const fixtureHandle = chat.stage4FixtureHandle
  assert(fixtureHandle, "Runtime/Profile fixture handle missing")
  assert(projectId === testProject.project.id, "Runtime/Profile fixture project mismatch")

  const before = await call("get_stage4_runtime_state", { fixtureHandle })
  originalDefault = before.defaults[0] ?? null
  if (!originalDefault) {
    writtenDefault = await call("mutate_stage4_runtime", {
      action: "write-default",
      payload: { fixtureHandle, preference: "codex-enhanced" },
    })
    assert(writtenDefault.preference === "codex-enhanced", "Runtime default mutation failed")
  }

  const emptyChat = await call("mutate_stage4_runtime", {
    action: "set-empty-chat",
    payload: { fixtureHandle, preference: "codex" },
  })
  assert(emptyChat.runtimePreference === "codex", "Empty-chat Runtime mutation failed")

  const activity = await call("mutate_stage4_runtime", {
    action: "seed-activity",
    payload: { fixtureHandle },
  })
  activitySeeded = true
  assert(activity.present && activity.eventCount === 26, "Runtime activity fixture failed")
  const activityRetry = await call("mutate_stage4_runtime", {
    action: "seed-activity",
    payload: { fixtureHandle },
  })
  assert(
    activityRetry.eventCount === 26 &&
      activityRetry.activityRunHandles.join(",") === activity.activityRunHandles.join(","),
    "Runtime activity retry did not deduplicate to the same durable runs",
  )
  const runtimeState = await call("get_stage4_runtime_state", {
    fixtureHandle,
    activityRunHandle: activity.activityRunHandles[0],
    activityLimit: 10,
  })
  assert(runtimeState.diagnostics.activity.count === 26, "Durable Runtime activity mismatch")
  assert(runtimeState.activity.events.length > 0, "Runtime activity query returned no events")

  continuation = await call("mutate_stage4_runtime", {
    action: "continue-chat",
    payload: { fixtureHandle, preference: "codex-enhanced" },
  })
  assert(continuation.created, "Started-chat Runtime continuation was not created")
  const undone = await call("mutate_stage4_runtime", {
    action: "undo-continuation",
    payload: { fixtureHandle, continuationHandle: continuation.continuationHandle },
  })
  assert(undone.undone, "Runtime continuation cleanup failed")
  continuationUndone = true

  const starters = await call("mutate_stage4_profile", {
    action: "ensure-starters",
    payload: { fixtureHandle },
  })
  assert(starters.installed >= 4, "Agent Profile starter catalog missing")
  const profileList = await call("get_stage4_profile_state", {
    action: "list",
    payload: { fixtureHandle },
  })
  const planner = profileList.find((candidate) => candidate.id === "builtin.planner")
  assert(planner?.profileHandle, "Owned planner profile handle missing")
  const plannerState = await call("get_stage4_profile_state", {
    action: "get",
    payload: { fixtureHandle, profileHandle: planner.profileHandle },
  })
  const created = await call("mutate_stage4_profile", {
    action: "create",
    payload: {
      fixtureHandle,
      name: `Stage 4 Created Profile ${Date.now()}`,
      description: "Owned create/version/search/archive/restore proof",
      category: "test",
      definition: plannerState.version.definition,
    },
  })
  createdProfile = created.profile
  createdProfile.profileHandle = created.profileHandle
  const createdUpdated = await call("mutate_stage4_profile", {
    action: "update",
    payload: {
      fixtureHandle,
      profileHandle: createdProfile.profileHandle,
      identity: { name: createdProfile.name },
      definition: plannerState.version.definition,
    },
  })
  createdProfile = {
    ...createdUpdated.profile,
    profileHandle: createdUpdated.profileHandle,
  }
  const searched = await call("get_stage4_profile_state", {
    action: "list",
    payload: {
      fixtureHandle,
      query: createdProfile.name,
      includeArchived: true,
    },
  })
  assert(
    searched.length === 1 && searched[0].currentVersion === 2,
    "Created profile search/version evidence was incomplete",
  )
  const archivedCreated = await call("mutate_stage4_profile", {
    action: "archive",
    payload: { fixtureHandle, profileHandle: createdProfile.profileHandle },
  })
  assert(archivedCreated.archivedAt, "Created profile archive did not persist")
  const restoredCreated = await call("mutate_stage4_profile", {
    action: "restore",
    payload: { fixtureHandle, profileHandle: createdProfile.profileHandle },
  })
  assert(restoredCreated.archivedAt === null, "Created profile restore did not persist")

  const exported = await call("mutate_stage4_profile", {
    action: "export",
    payload: { fixtureHandle, profileHandles: [planner.profileHandle] },
  })
  const importPreview = await call("mutate_stage4_profile", {
    action: "preview-import",
    payload: { fixtureHandle, bundleHandle: exported.bundleHandle },
  })
  const imported = await call("mutate_stage4_profile", {
    action: "confirm-import",
    payload: {
      fixtureHandle,
      importHandle: importPreview.importHandle,
      conflict: "duplicate",
    },
  })
  importedProfile = imported[0]
  const importedState = await call("get_stage4_profile_state", {
    action: "get",
    payload: { fixtureHandle, profileHandle: importedProfile.profileHandle },
  })
  const updatedImported = await call("mutate_stage4_profile", {
    action: "update",
    payload: {
      fixtureHandle,
      profileHandle: importedProfile.profileHandle,
      identity: { name: `Stage 4 Planner ${Date.now()}` },
      definition: importedState.version.definition,
    },
  })
  importedProfile = {
    ...updatedImported.profile,
    profileHandle: updatedImported.profileHandle,
  }
  const resolved = await call("get_stage4_profile_state", {
    action: "resolve",
    payload: {
      fixtureHandle,
      profileHandle: importedProfile.profileHandle,
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
  assert(resolved.profile.version === 2, "Agent Profile resolution version mismatch")

  const workflowCreated = await call("create_test_orchestration", {
    deferScheduling: true,
    stage4FixtureHandle: fixtureHandle,
    request: {
      projectId,
      task: { mode: "create", name: `Stage 4 profile workflow ${Date.now()}` },
      initiatingChatId: chat.chatId,
      maxParallelAgents: 1,
      maxDepth: 2,
      stopConditions: { maxTotalTokens: 10_000 },
      agents: [
        {
          role: "planner",
          prompt: "Materialize the profile binding only. Do not launch.",
          harness: "codex",
          permissionMode: "read-only",
          worktreeStrategy: "none",
          dependencyAgentIds: [],
          completionCriteria: "Frozen profile checkpoint exists.",
        },
      ],
    },
  })
  workflowTaskId = workflowCreated.orchestration.taskId
  const workflow = workflowCreated.stage4WorkflowHandles?.[0]
  const workflowStepId = workflow?.stepIds?.[0]
  assert(workflow?.workflowHandle && workflowStepId, "Owned workflow handle was not returned")
  const bound = await call("mutate_stage4_profile", {
    action: "workflow-bind",
    payload: {
      fixtureHandle,
      workflowHandle: workflow.workflowHandle,
      stepId: workflowStepId,
      profileHandle: importedProfile.profileHandle,
      workflowRole: "planner",
      inputSchema: null,
      outputSchema: { result: { type: "string" } },
      overrides: null,
    },
  })
  const confirmed = await call("mutate_stage4_profile", {
    action: "workflow-confirm",
    payload: {
      fixtureHandle,
      workflowHandle: workflow.workflowHandle,
      stepId: workflowStepId,
    },
  })
  assert(
    bound.version === 1 &&
      confirmed.snapshot?.profile?.version === 2 &&
      typeof confirmed.snapshot?.digest === "string",
    "Deterministic profile-bound workflow checkpoint was incomplete",
  )

  const duplicatedStandalone = await call("mutate_stage4_profile", {
    action: "duplicate",
    payload: {
      fixtureHandle,
      profileHandle: importedProfile.profileHandle,
      name: `Stage 4 Standalone Planner ${Date.now()}`,
    },
  })
  standaloneProfile = {
    ...duplicatedStandalone.profile,
    profileHandle: duplicatedStandalone.profileHandle,
  }
  const standalonePreview = await call("get_stage4_profile_state", {
    action: "standalone-preview",
    payload: {
      fixtureHandle,
      profileHandle: standaloneProfile.profileHandle,
    },
  })
  standaloneLaunch = await call("mutate_stage4_profile", {
    action: "standalone-launch",
    payload: {
      fixtureHandle,
      previewHandle: standalonePreview.previewHandle,
    },
  })
  assert(standaloneLaunch.state === "pending", "Standalone launch did not persist pending state")
  assert(standaloneLaunch.runStatus === "pending", "Standalone run was unexpectedly dispatched")
  const frozenStandaloneBefore = await call("get_stage4_profile_state", {
    action: "standalone-get",
    payload: { fixtureHandle, launchHandle: standaloneLaunch.launchHandle },
  })
  assert(
    frozenStandaloneBefore.profile?.version === 1 &&
      typeof frozenStandaloneBefore.snapshot?.digest === "string",
    "Standalone launch did not expose its immutable resolved snapshot",
  )
  let stoppedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-stop",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      reason: "stage4-live-proof-complete",
    },
  })
  assert(stoppedStandalone.stopped, "Standalone launch cleanup failed")
  const followedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-follow-up",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      prompt: "Continue the Stage 4 owned lifecycle proof.",
    },
  })
  assert(
    followedStandalone.launchHandle === standaloneLaunch.launchHandle &&
      followedStandalone.chatId === standaloneLaunch.chatId,
    "Standalone follow-up did not preserve owned chat lineage",
  )
  stoppedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-stop",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      reason: "stage4-live-follow-up-complete",
    },
  })
  assert(stoppedStandalone.stopped, "Standalone follow-up cleanup failed")
  const retriedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-retry",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
    },
  })
  assert(
    retriedStandalone.launchHandle === standaloneLaunch.launchHandle &&
      retriedStandalone.chatId === standaloneLaunch.chatId,
    "Standalone retry did not preserve owned chat lineage",
  )
  stoppedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-stop",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      reason: "stage4-live-retry-complete",
    },
  })
  assert(stoppedStandalone.stopped, "Standalone retry cleanup failed")

  const standaloneState = await call("get_stage4_profile_state", {
    action: "get",
    payload: { fixtureHandle, profileHandle: standaloneProfile.profileHandle },
  })
  const updatedStandalone = await call("mutate_stage4_profile", {
    action: "update",
    payload: {
      fixtureHandle,
      profileHandle: standaloneProfile.profileHandle,
      identity: { name: `Stage 4 Updated Standalone Planner ${Date.now()}` },
      definition: standaloneState.version.definition,
    },
  })
  standaloneProfile = {
    ...updatedStandalone.profile,
    profileHandle: updatedStandalone.profileHandle,
  }
  const frozenStandaloneAfter = await call("get_stage4_profile_state", {
    action: "standalone-get",
    payload: { fixtureHandle, launchHandle: standaloneLaunch.launchHandle },
  })
  assert(
    frozenStandaloneAfter.profile?.version === frozenStandaloneBefore.profile.version &&
      frozenStandaloneAfter.snapshot?.digest === frozenStandaloneBefore.snapshot.digest,
    "Historical standalone snapshot changed after profile versioning",
  )
  const updatedPreview = await call("get_stage4_profile_state", {
    action: "standalone-preview",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      profileHandle: standaloneProfile.profileHandle,
      includeParentChat: true,
    },
  })
  const continuedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-continue-with-updated-profile",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      previewHandle: updatedPreview.previewHandle,
    },
  })
  assert(
    continuedStandalone.previousLaunchHandle === standaloneLaunch.launchHandle &&
      continuedStandalone.launchHandle !== standaloneLaunch.launchHandle &&
      continuedStandalone.chatId !== standaloneLaunch.chatId,
    "Updated-profile continuation did not create an explicit owned chat/run boundary",
  )
  standaloneLaunches = [retriedStandalone, continuedStandalone]
  standaloneLaunch = continuedStandalone
  stoppedStandalone = await call("mutate_stage4_profile", {
    action: "standalone-stop",
    payload: {
      fixtureHandle,
      launchHandle: standaloneLaunch.launchHandle,
      reason: "stage4-live-updated-profile-complete",
    },
  })
  assert(stoppedStandalone.stopped, "Updated-profile continuation cleanup failed")
  standaloneStopped = true

  proofOutput = JSON.stringify(
    {
      result: "PASS",
      checkout,
      profile,
      proof: {
        transport: "authenticated dev-test MCP",
        ownership: "opaque fixture-scoped handles",
        providerLaunches: 0,
        runtime: [
          originalDefault ? "project default inspected (pre-existing)" : "project default mutation",
          "empty-chat selection",
          "started-chat continuation",
          "durable activity persistence/query",
          "idempotent durable activity retry/deduplication",
        ],
        profiles: [
          "starter catalog",
          "create, version, search, archive, and restore",
          "export/import",
          "version update",
          "resolution",
          "duplicate",
          "standalone preview, follow-up, retry, updated-profile continuation, and stop",
          "deterministic profile-bound workflow materialization and frozen checkpoint",
        ],
        workflowBinding: "production service covered by Node 22 integration test",
      },
    },
    null,
    2,
  )
} catch (error) {
  proofError = error
}

const cleanup = await cleanupRuntimeProfileProof(call, {
  activitySeeded,
  chat,
  testProject,
  importedProfile,
  standaloneProfile,
  standaloneLaunch,
  standaloneLaunches,
  standaloneStopped,
  continuation,
  continuationUndone,
  originalDefault,
  writtenDefault,
})
if (createdProfile) {
  try {
    await call("mutate_stage4_profile", {
      action: "archive",
      payload: {
        fixtureHandle: chat.stage4FixtureHandle,
        profileHandle: createdProfile.profileHandle,
      },
    })
  } catch (error) {
    cleanup.errors.push(
      `archive-created-profile: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
if (workflowTaskId) {
  try {
    await call("archive_test_task", { taskId: workflowTaskId })
  } catch (error) {
    cleanup.errors.push(
      `archive-workflow-task: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
await transport.close().catch(() => undefined)

if (proofError || cleanup.errors.length > 0) {
  const proofMessage =
    proofError instanceof Error ? proofError.message : proofError ? String(proofError) : null
  throw new Error(
    `Stage 4 live proof failed: ${JSON.stringify({
      proof: proofMessage,
      cleanup: cleanup.errors,
    })}`,
  )
}
console.log(proofOutput)
