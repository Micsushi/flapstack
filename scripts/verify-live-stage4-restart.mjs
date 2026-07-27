#!/usr/bin/env node

import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import {
  flapstackProfilePath,
  resolveDevMcpDescriptorPath,
  resolveDevMcpProfile,
} from "./lib/profile-paths.mjs"

const phase = process.argv[2]
if (!["prepare", "verify"].includes(phase)) {
  throw new Error("Usage: verify-live-stage4-restart.mjs <prepare|verify>")
}

const checkout = await realpath(resolve(process.cwd()))
const profile = resolveDevMcpProfile()
const descriptor = JSON.parse(await readFile(resolveDevMcpDescriptorPath(profile), "utf8"))
const statePath =
  process.env.FLAPSTACK_STAGE4_RESTART_STATE ||
  join(flapstackProfilePath(profile), "data", "dev-mcp", "stage4-restart-proof.json")
const client = new Client({ name: "flapstack-live-stage4-restart", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
const restartStateSchema = z
  .object({
    version: z.literal(1),
    checkout: z.string().min(1),
    profile: z.string().min(1),
    preparedProcessId: z.number().int().positive(),
    projectId: z.string().min(1),
    fixtureHandle: z.string().startsWith("s4_fixture_"),
    fixtureChatId: z.string().min(1),
    profileHandle: z.string().startsWith("s4_profile_"),
    launchHandle: z.string().startsWith("s4_launch_"),
    launchChatId: z.string().min(1),
    snapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
    activityRunHandle: z.string().startsWith("s4_activity_run_"),
    activityRunHandles: z.array(z.string().startsWith("s4_activity_run_")).min(1).max(10),
    orchestrationTaskId: z.string().min(1),
    operationWorkspaceId: z.string().min(1),
  })
  .strict()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function result(response) {
  if (response.isError) {
    const message = response.content?.find((item) => item.type === "text")?.text
    throw new Error(message || "Dev MCP tool failed")
  }
  return response.structuredContent?.result
}

async function call(name, args = {}) {
  return result(await client.callTool({ name, arguments: args }))
}

async function writeState(value) {
  const temporary = `${statePath}.${randomUUID()}.tmp`
  await mkdir(dirname(statePath), { recursive: true })
  const payload = restartStateSchema.parse(value)
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, statePath)
}

async function readState() {
  return restartStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")))
}

assert((await realpath(descriptor.checkout)) === checkout, "Dev MCP checkout mismatch")
assert(
  (await realpath(descriptor.userDataPath)) === (await realpath(flapstackProfilePath(profile))),
  "Dev MCP profile path mismatch",
)
await client.connect(transport)

try {
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live checkout mismatch")
  assert(
    environment.app?.channel === "development" && environment.app?.protocol === "flapstack-dev",
    "Restart proof is not connected to the exact Dev app identity",
  )

  if (phase === "prepare") {
    await rm(statePath, { force: true })
    const testProject = await call("ensure_test_project")
    await call("mutate_stage4_operational_state", {
      action: "enable-stage4-beta-fixtures",
      payload: {},
    })
    const fixture = await call("create_test_orchestration_fixture", {
      chatName: `Stage 4 restart proof ${Date.now()}`,
      harness: "codex",
    })
    const fixtureHandle = fixture.stage4FixtureHandle
    const activity = await call("mutate_stage4_runtime", {
      action: "seed-activity",
      payload: { fixtureHandle },
    })
    const starters = await call("mutate_stage4_profile", {
      action: "ensure-starters",
      payload: { fixtureHandle },
    })
    const profiles = await call("get_stage4_profile_state", {
      action: "list",
      payload: { fixtureHandle },
    })
    const planner = profiles.find((candidate) => candidate.id === "builtin.planner")
    assert(starters.installed >= 4 && planner?.profileHandle, "Starter profile was unavailable")
    const duplicate = await call("mutate_stage4_profile", {
      action: "duplicate",
      payload: {
        fixtureHandle,
        profileHandle: planner.profileHandle,
        name: `Stage 4 restart profile ${Date.now()}`,
      },
    })
    const preview = await call("get_stage4_profile_state", {
      action: "standalone-preview",
      payload: {
        fixtureHandle,
        profileHandle: duplicate.profileHandle,
      },
    })
    const launch = await call("mutate_stage4_profile", {
      action: "standalone-launch",
      payload: { fixtureHandle, previewHandle: preview.previewHandle },
    })
    const orchestration = await call("create_test_orchestration", {
      deferScheduling: true,
      stage4FixtureHandle: fixtureHandle,
      request: {
        projectId: fixture.projectId,
        task: { mode: "create", name: `Stage 4 restart workspace ${Date.now()}` },
        initiatingChatId: fixture.chatId,
        maxParallelAgents: 1,
        maxDepth: 2,
        stopConditions: { maxTotalTokens: 10_000 },
        agents: [
          {
            role: "restart-verifier",
            prompt: "Persist only; do not launch.",
            harness: "codex",
            permissionMode: "read-only",
            worktreeStrategy: "none",
            dependencyAgentIds: [],
            completionCriteria: "Restart evidence can be queried.",
          },
        ],
      },
    })
    assert(
      launch.state === "pending" &&
        launch.runStatus === "pending" &&
        orchestration.orchestration.status === "paused" &&
        orchestration.operationWorkspace?.state === "live",
      "Restart preparation did not persist the expected dormant state",
    )
    await writeState({
      version: 1,
      checkout,
      profile,
      preparedProcessId: environment.app.processId,
      projectId: testProject.project.id,
      fixtureHandle,
      fixtureChatId: fixture.chatId,
      profileHandle: duplicate.profileHandle,
      launchHandle: launch.launchHandle,
      launchChatId: launch.chatId,
      snapshotDigest: launch.snapshot.digest,
      activityRunHandle: activity.activityRunHandles[0],
      activityRunHandles: activity.activityRunHandles,
      orchestrationTaskId: orchestration.orchestration.taskId,
      operationWorkspaceId: orchestration.operationWorkspace.id,
    })
    console.log(
      JSON.stringify({
        result: "PREPARED",
        restartRequired: true,
        statePath,
        processId: environment.app.processId,
        screenControl: false,
        providerLaunches: 0,
      }),
    )
  } else {
    const state = await readState()
    assert(state.version === 1, "Restart proof state version mismatch")
    assert((await realpath(state.checkout)) === checkout, "Restart proof checkout mismatch")
    assert(state.profile === profile, "Restart proof profile mismatch")
    assert(
      environment.app.processId !== state.preparedProcessId,
      "The app process did not restart after proof preparation",
    )
    const runtime = await call("get_stage4_runtime_state", {
      fixtureHandle: state.fixtureHandle,
      activityRunHandle: state.activityRunHandle,
      activityLimit: 100,
    })
    assert(
      runtime.diagnostics.activity.count === 26 && runtime.activity.events.length > 0,
      "Activity did not survive restart with a durable query result",
    )
    const retry = await call("mutate_stage4_runtime", {
      action: "seed-activity",
      payload: { fixtureHandle: state.fixtureHandle },
    })
    assert(
      retry.eventCount === 26 &&
        retry.activityRunHandles.join(",") === state.activityRunHandles.join(","),
      "Activity retry after restart did not deduplicate to the same durable run identities",
    )
    const launch = await call("get_stage4_profile_state", {
      action: "standalone-get",
      payload: {
        fixtureHandle: state.fixtureHandle,
        launchHandle: state.launchHandle,
      },
    })
    assert(
      launch.state === "pending" &&
        launch.runStatus === "pending" &&
        launch.snapshot.digest === state.snapshotDigest,
      "Standalone profile launch did not recover its exact frozen state after restart",
    )
    const orchestration = await call("get_test_orchestration", {
      taskId: state.orchestrationTaskId,
    })
    assert(
      orchestration.overview.operationWorkspace?.state === "live" &&
        orchestration.overview.operationWorkspace?.id === state.operationWorkspaceId &&
        orchestration.overview.initiatingChat?.id === state.fixtureChatId &&
        orchestration.lineage.nodes.length === 1,
      "Operation workspace identity or durable roster lineage did not survive restart",
    )

    const cleanupErrors = []
    const safely = async (label, operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await safely("standalone", () =>
      call("mutate_stage4_profile", {
        action: "standalone-stop",
        payload: {
          fixtureHandle: state.fixtureHandle,
          launchHandle: state.launchHandle,
          reason: "stage4-restart-proof-complete",
        },
      }),
    )
    await safely("activity", () =>
      call("mutate_stage4_runtime", {
        action: "cleanup-activity",
        payload: { fixtureHandle: state.fixtureHandle },
      }),
    )
    await safely("profile", () =>
      call("mutate_stage4_profile", {
        action: "archive",
        payload: {
          fixtureHandle: state.fixtureHandle,
          profileHandle: state.profileHandle,
        },
      }),
    )
    await safely("orchestration stop", () =>
      call("mutate_test_orchestration", {
        taskId: state.orchestrationTaskId,
        action: "stop",
      }),
    )
    await safely("orchestration archive", () =>
      call("mutate_test_orchestration", {
        taskId: state.orchestrationTaskId,
        action: "archive",
      }),
    )
    await safely("standalone chat", () => call("archive_test_chat", { chatId: state.launchChatId }))
    await safely("fixture chat", () => call("archive_test_chat", { chatId: state.fixtureChatId }))
    await safely("owned Stage 4 journal", () => call("cleanup_stage4_owned_runtime_profiles"))
    await safely("beta settings", () =>
      call("mutate_stage4_operational_state", {
        action: "restore-stage4-beta-fixtures",
        payload: {},
      }),
    )
    if (cleanupErrors.length) {
      throw new Error(`Restart proof cleanup failed: ${cleanupErrors.join("; ")}`)
    }
    await rm(statePath, { force: true })
    console.log(
      JSON.stringify({
        result: "PASS",
        preparedProcessId: state.preparedProcessId,
        verifiedProcessId: environment.app.processId,
        workspaceIdentityPreserved: true,
        standaloneSnapshotPreserved: true,
        activityPersistenceAndRetryDeduplication: true,
        screenControl: false,
        providerLaunches: 0,
      }),
    )
  }
} finally {
  await transport.close().catch(() => undefined)
}
