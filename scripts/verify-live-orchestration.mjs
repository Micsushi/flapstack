#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { realpath } from "node:fs/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const checkout = await realpath(resolve(process.cwd()))
const instance = process.env.FLAPSTACK_DEV_INSTANCE?.trim()
const profile = instance
  ? `Flapstack Dev ${instance.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  : "Flapstack Dev"
const descriptorPath =
  process.env.FLAPSTACK_DEV_MCP_DESCRIPTOR ||
  join(homedir(), "Library", "Application Support", profile, "dev-test-control-mcp.json")
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"))

if (
  (await realpath(descriptor.userDataPath)) !==
  (await realpath(join(homedir(), "Library", "Application Support", profile)))
) {
  throw new Error(`Unexpected dev profile path: ${descriptor.userDataPath}`)
}
if (descriptor.profile !== "Flapstack Dev") {
  throw new Error(`Unexpected dev application name: ${descriptor.profile}`)
}
if ((await realpath(descriptor.checkout)) !== checkout) {
  throw new Error(`Dev MCP belongs to another checkout: ${descriptor.checkout}`)
}
if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(descriptor.url) || !descriptor.token) {
  throw new Error("Invalid dev MCP descriptor")
}

const client = new Client({ name: "flapstack-live-orchestration-proof", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
let taskId = null

function toolResult(response) {
  if (response.isError) {
    const text = response.content?.find((item) => item.type === "text")?.text
    throw new Error(text || "Dev MCP tool failed")
  }
  return response.structuredContent?.result
}

async function call(name, args = {}) {
  return toolResult(await client.callTool({ name, arguments: args }))
}

async function waitForRendererTask(taskId, predicate = () => true) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const state = await call("get_renderer_orchestration_state", { taskId })
    if (state.card?.taskId === taskId && predicate(state.card)) return state
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  await client.connect(transport)
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live environment checkout mismatch")

  const fixture = await call("create_test_orchestration_fixture", {
    projectPath: checkout,
    projectName: "Flapstack orchestration proof",
    chatName: `Orchestration MCP proof ${Date.now()}`,
    harness: "codex",
  })
  assert(fixture.permissionMode === "read-only", "Fixture must be read-only")

  const firstId = `proof-build-${Date.now()}`
  const secondId = `proof-review-${Date.now()}`
  const created = await call("create_test_orchestration", {
    deferScheduling: true,
    request: {
      projectId: fixture.projectId,
      task: { mode: "create", name: `Finish Stage 4 proof ${Date.now()}` },
      initiatingChatId: fixture.chatId,
      maxParallelAgents: 1,
      maxDepth: 4,
      stopConditions: {
        maxWallClockMs: 300_000,
        maxTotalTokens: 10_000,
        maxCostUsdMicros: 1_000_000,
        maxFailures: 3,
        maxBlockers: 3,
      },
      agents: [
        {
          agentId: firstId,
          role: "builder",
          name: "Codex builder",
          prompt: "Live MCP proof only. Do not launch.",
          spec: "Verify durable queue and lineage.",
          harness: "codex",
          provider: "openai",
          reasoningEffort: "high",
          permissionMode: "read-only",
          worktreeStrategy: "inherit",
          dependencyAgentIds: [],
          completionCriteria: "Durable state is observable through MCP.",
        },
        {
          agentId: secondId,
          role: "reviewer",
          name: "Claude reviewer",
          prompt: "Live MCP proof only. Do not launch.",
          harness: "claude-code",
          provider: "anthropic",
          reasoningEffort: "medium",
          permissionMode: "read-only",
          worktreeStrategy: "inherit",
          dependencyAgentIds: [firstId],
          completionCriteria: "Dependency and mixed harness state are durable.",
        },
      ],
    },
  })
  taskId = created.orchestration.taskId
  assert(
    created.orchestration.status === "paused" &&
      created.aggregate.queued === 2 &&
      created.aggregate.active === 0,
    "Deferred queue mismatch",
  )
  const selected = await call("select_test_chat", {
    chatId: fixture.chatId,
    subChatId: fixture.subChatId,
    showOrchestration: true,
  })
  assert(selected.detailsOpen === true && selected.detailsTab === "details", "Task screen not open")
  const initialRenderer = await waitForRendererTask(taskId)
  if (initialRenderer?.card) {
    assert(initialRenderer.selectedChatId === fixture.chatId, "Renderer selected chat mismatch")
    assert(
      initialRenderer.card.accessibleName.includes(created.orchestration.name),
      "Task card accessible name mismatch",
    )
    assert(
      initialRenderer.card.enabledControlLabels.includes("Resume orchestration") &&
        initialRenderer.card.enabledControlLabels.includes("Stop orchestration") &&
        initialRenderer.card.enabledControlLabels.includes("Add orchestration agent"),
      "Task card controls are not accessible",
    )
  }

  const initialRead = await call("get_test_orchestration", { taskId })
  assert(initialRead.lineage.nodes.length === 2, "Initial lineage mismatch")

  const replacement = await call("mutate_test_orchestration", {
    taskId,
    action: "replace",
    agentId: firstId,
    payload: {
      agent: {
        role: "builder-replacement",
        name: "Codex replacement",
        prompt: "Replacement proof only. Do not launch.",
        harness: "codex",
        provider: "openai",
        reasoningEffort: "low",
        permissionMode: "read-only",
        worktreeStrategy: "inherit",
        dependencyAgentIds: [],
        completionCriteria: "Replacement lineage is durable.",
      },
    },
  })
  assert(replacement.replacedAgentId === firstId, "Replacement lineage mismatch")

  const retry = await call("mutate_test_orchestration", {
    taskId,
    action: "retry",
    agentId: firstId,
  })
  assert(retry.replacedAgentId === firstId, "Retry lineage mismatch")
  const added = await call("mutate_test_orchestration", {
    taskId,
    action: "add",
    payload: {
      agent: {
        role: "extra-reviewer",
        name: "Extra Claude reviewer",
        prompt: "Added-agent proof only. Do not launch.",
        harness: "claude-code",
        provider: "anthropic",
        reasoningEffort: "high",
        permissionMode: "read-only",
        worktreeStrategy: "inherit",
        dependencyAgentIds: [],
        completionCriteria: "Added worker is queued once.",
      },
    },
  })
  assert(added.status === "queued", "Added worker was not queued")

  const progressed = await call("mutate_test_orchestration", {
    taskId,
    action: "progress",
    agentId: replacement.id,
    payload: {
      agentId: replacement.id,
      progressPercent: 100,
      totalTokens: 123,
      costUsdMicros: 456,
      costQuality: "estimated",
      status: "completed",
      resultSummary: "MCP proof complete",
    },
  })
  assert(progressed.aggregate.estimatedCostUsdMicros === 456, "Estimated cost label mismatch")
  assert(progressed.aggregate.exactCostUsdMicros === 0, "Estimated cost became exact")
  const progressedRenderer = await waitForRendererTask(
    taskId,
    (card) => card.costQuality === "estimated" && card.text.includes("est. $0.00"),
  )
  if (progressedRenderer?.card) {
    assert(
      progressedRenderer.card.agentStatuses.some(
        (agent) => agent.agentId === replacement.id && agent.status === "completed",
      ),
      "Renderer worker status mismatch",
    )
  }

  const finalRead = await call("get_test_orchestration", { taskId })
  assert(
    finalRead.lineage.edges.some((edge) => edge.kind === "replacement"),
    "Lineage edge missing",
  )
  assert(finalRead.overview.aggregate.total === 5, "Retry/replace/add count mismatch")
  const stopped = await call("mutate_test_orchestration", { taskId, action: "stop" })
  assert(stopped.orchestration.stopReason === "manual-stop", "Manual stop reason mismatch")
  const archived = await call("mutate_test_orchestration", { taskId, action: "archive" })
  assert(archived.archived === true, "Fixture archive failed")

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        checkout,
        profile,
        taskId,
        proof: {
          transport: "authenticated dev-test MCP",
          providerLaunches: 0,
          fixture: "read-only",
          aggregateAgents: finalRead.overview.aggregate.total,
          mixedHarnesses: ["codex", "claude-code"],
          queue: "deferred and paused",
          controls: [
            "create",
            "read",
            "pause",
            "replace",
            "retry",
            "add",
            "progress",
            "stop",
            "archive",
          ],
          renderer: progressedRenderer?.card
            ? {
                rendered: true,
                selectedChatId: progressedRenderer.selectedChatId,
                taskId: progressedRenderer.card.taskId,
                accessibleName: progressedRenderer.card.accessibleName,
                status: progressedRenderer.card.status,
                costQuality: progressedRenderer.card.costQuality,
                enabledControls: progressedRenderer.card.enabledControlLabels,
              }
            : { rendered: false },
          cost: "estimated-only",
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (taskId) {
    await call("mutate_test_orchestration", { taskId, action: "stop" }).catch(() => undefined)
    await call("mutate_test_orchestration", { taskId, action: "archive" }).catch(() => undefined)
  }
  throw error
} finally {
  await transport.close().catch(() => undefined)
}
