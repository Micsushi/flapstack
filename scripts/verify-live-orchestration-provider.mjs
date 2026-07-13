#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
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
const keep = process.env.FLAPSTACK_KEEP_ORCHESTRATION_PROOF === "1"

if ((await realpath(descriptor.checkout)) !== checkout) {
  throw new Error(`Dev MCP belongs to another checkout: ${descriptor.checkout}`)
}
if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(descriptor.url) || !descriptor.token) {
  throw new Error("Invalid dev MCP descriptor")
}

const client = new Client({ name: "flapstack-live-provider-orchestration", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
let taskId = null
let fixture = null

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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForOverview(predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const read = await call("get_test_orchestration", { taskId })
    if (predicate(read.overview)) return read
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for orchestration ${taskId}`)
}

async function waitForRenderer(chatId, predicate) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const state = await call("get_renderer_orchestration_state", { taskId })
    if (state.selectedChatId === chatId && state.card?.chatId === chatId && predicate(state.card)) {
      return state
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Renderer did not expose orchestration ${taskId} for chat ${chatId}`)
}

try {
  await client.connect(transport)
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live environment checkout mismatch")
  const harness = await call("get_harness_status")

  fixture = await call("create_test_orchestration_fixture", {
    projectPath: checkout,
    projectName: "Flapstack provider orchestration proof",
    chatName: `Provider orchestration parent ${Date.now()}`,
    harness: "codex",
  })
  const agentId = `provider-codex-${Date.now()}`
  const created = await call("create_test_orchestration", {
    request: {
      projectId: fixture.projectId,
      task: { mode: "create", name: `Live fork navigation proof ${Date.now()}` },
      initiatingChatId: fixture.chatId,
      maxParallelAgents: 1,
      maxDepth: 2,
      stopConditions: {
        targetCompletedAgents: 1,
        maxWallClockMs: 120_000,
        maxTotalTokens: 4_000,
        maxFailures: 1,
        maxBlockers: 1,
      },
      agents: [
        {
          agentId,
          role: "provider-proof",
          name: "Codex provider proof",
          prompt:
            "Reply exactly ORCHESTRATION_FORK_OK. Do not inspect files, run tools, or edit anything.",
          spec: "Safe read-only provider and lineage proof.",
          harness: "codex",
          reasoningEffort: "minimal",
          permissionMode: "read-only",
          worktreeStrategy: "inherit",
          dependencyAgentIds: [],
          completionCriteria: "A terminal provider response is durably recorded.",
        },
      ],
    },
  })
  taskId = created.orchestration.taskId
  const materialized = await waitForOverview((overview) => Boolean(overview.agents[0]?.chatId))
  const child = materialized.overview.agents[0]
  assert(child.chatId && child.runId, "Scheduler did not materialize child lineage")

  const targets = await call("list_test_targets")
  const childSubChat = targets.subChats.find((subChat) => subChat.chatId === child.chatId)
  assert(childSubChat, "Materialized child sub-chat missing")

  await call("select_test_chat", {
    chatId: child.chatId,
    subChatId: childSubChat.id,
    showOrchestration: true,
  })
  const childRenderer = await waitForRenderer(child.chatId, (card) =>
    card.lineageLabels.includes("Open parent agent chat"),
  )

  await call("select_test_chat", {
    chatId: fixture.chatId,
    subChatId: fixture.subChatId,
    showOrchestration: true,
  })
  const parentRenderer = await waitForRenderer(fixture.chatId, (card) =>
    card.lineageLabels.includes("Open child agent chat Codex provider proof"),
  )

  const terminal = await waitForOverview((overview) =>
    ["completed", "failed", "stopped"].includes(overview.agents[0]?.status),
  )
  const runState = await call("get_run_state", { runId: child.runId })
  const overview = terminal.overview
  const assistantText = runState.assistant?.text?.trim() ?? null
  const usage = runState.assistant?.metadata?.usage ?? null
  assert(assistantText === "ORCHESTRATION_FORK_OK", "Provider response did not match proof token")
  assert(
    ["success", "cancelled"].includes(runState.run?.status),
    `Provider run ended unexpectedly: ${runState.run?.status ?? "missing"}`,
  )
  assert(usage && typeof usage === "object", "Authoritative provider usage was not persisted")
  assert(overview.orchestration.status === "stopped", "Token stop did not stop orchestration")
  assert(overview.orchestration.stopReason === "token-budget", "Token stop reason was not durable")
  assert(overview.agents[0].status === "stopped", "Token stop did not stop the provider worker")
  assert(
    overview.aggregate.totalTokens >= 4_000,
    "Token budget was not evaluated from authoritative usage",
  )
  assert(overview.aggregate.costQuality === "unknown", "Unavailable provider cost was mislabeled")
  assert(
    overview.aggregate.exactCostUsdMicros === 0 &&
      overview.aggregate.providerReportedCostUsdMicros === 0 &&
      overview.aggregate.estimatedCostUsdMicros === 0,
    "Unavailable provider cost was fabricated",
  )

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        checkout,
        profile,
        taskId,
        fixture: {
          projectId: fixture.projectId,
          parentChatId: fixture.chatId,
          parentSubChatId: fixture.subChatId,
          childChatId: child.chatId,
          childSubChatId: childSubChat.id,
          runId: child.runId,
        },
        proof: {
          transport: "authenticated dev-test MCP",
          harnessStatus: harness,
          providerRun: {
            status: runState.run?.status ?? null,
            assistantText,
            usage,
          },
          orchestration: {
            status: overview.orchestration.status,
            workerStatus: overview.agents[0].status,
            totalTokens: overview.aggregate.totalTokens,
            costQuality: overview.aggregate.costQuality,
            exactCostUsdMicros: overview.aggregate.exactCostUsdMicros,
            providerReportedCostUsdMicros: overview.aggregate.providerReportedCostUsdMicros,
            estimatedCostUsdMicros: overview.aggregate.estimatedCostUsdMicros,
          },
          lineage: {
            childToParent: childRenderer.card.lineageLabels,
            parentToChild: parentRenderer.card.lineageLabels,
          },
          keptForVisualProof: keep,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (taskId) await call("mutate_test_orchestration", { taskId, action: "stop" }).catch(() => {})
  throw error
} finally {
  if (taskId && !keep) {
    await call("mutate_test_orchestration", { taskId, action: "stop" }).catch(() => {})
    await call("mutate_test_orchestration", { taskId, action: "archive" }).catch(() => {})
  }
  await transport.close().catch(() => {})
}
