#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"

const checkout = await realpath(resolve(process.cwd()))
const profile = resolveDevMcpProfile()
const descriptorPath = resolveDevMcpDescriptorPath(profile)
let descriptor = null
let client = null
let transport = null
const fixtures = {
  skill: null,
  vault: null,
  workspace: null,
  automation: null,
  budget: null,
  plan: null,
}
let verificationError = null
let cleanupError = null
let portabilityJobId = null

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

async function loadDescriptor() {
  const current = JSON.parse(await readFile(descriptorPath, "utf8"))
  assert((await realpath(current.checkout)) === checkout, "Dev MCP checkout mismatch")
  assert(current.profile === profile, "Dev MCP profile mismatch")
  assert(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(current.url), "Invalid dev MCP URL")
  assert(current.token, "Missing dev MCP bearer token")
  return current
}

function createConnection(current, timeoutMs) {
  const nextClient = new Client({
    name: "flapstack-live-stage4-operations",
    version: "2.0.0",
  })
  const nextTransport = new StreamableHTTPClientTransport(new URL(current.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${current.token}` },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    },
  })
  return { client: nextClient, transport: nextTransport }
}

async function closePrimaryConnection() {
  await client?.close().catch(() => undefined)
  client = null
  transport = null
}

async function connectPrimary() {
  await closePrimaryConnection()
  descriptor = await loadDescriptor()
  const connection = createConnection(descriptor)
  client = connection.client
  transport = connection.transport
  await client.connect(transport)
}

async function call(name, args = {}) {
  assert(client, "Dev MCP client is not connected")
  return toolResult(await client.callTool({ name, arguments: args }))
}

async function state(domain, input = {}) {
  return call("get_stage4_operational_state", { domain, ...input })
}

async function mutate(action, payload = {}) {
  return call("mutate_stage4_operational_state", { action, payload })
}

function fixtureId(response) {
  const value = response?.result?.fixtureId
  assert(typeof value === "string" && value.length > 0, "Fixture operation returned no identity")
  return value
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function pollPortabilityLifecycle(jobId) {
  const deadline = Date.now() + 180_000
  let lastError = "no descriptor was available"
  while (Date.now() < deadline) {
    let pollingClient = null
    try {
      const current = await loadDescriptor()
      const connection = createConnection(current, 10_000)
      pollingClient = connection.client
      await pollingClient.connect(connection.transport)
      const response = toolResult(
        await pollingClient.callTool({
          name: "mutate_stage4_operational_state",
          arguments: {
            action: "get-portability-lifecycle-fixture",
            payload: { jobId },
          },
        }),
      )
      const job = response?.result
      if (job?.status === "completed" || job?.status === "failed") return job
      lastError = `job remained ${job?.status || "unavailable"}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      await pollingClient?.close().catch(() => undefined)
    }
    await delay(500)
  }
  throw new Error(`Portability lifecycle did not finish within 180 seconds: ${lastError}`)
}

try {
  await connectPrimary()
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live environment checkout mismatch")
  assert(
    environment.app?.channel === "development" && environment.app?.protocol === "flapstack-dev",
    "Live environment is not the exact Dev app identity",
  )
  const project = (await call("ensure_test_project")).project
  assert(project?.id, "Owned test project registration failed")
  await mutate("enable-stage4-beta-fixtures")

  const skillCreated = await mutate("create-project-skill-fixture", { projectId: project.id })
  fixtures.skill = fixtureId(skillCreated)
  const skillsHooks = await state("skills-hooks", { projectId: project.id })
  assert(
    skillsHooks.skills.some((item) => item.name?.startsWith("stage4-mcp-")),
    "Project skill fixture was not observable",
  )
  assert(
    typeof skillsHooks.hookInventory?.count === "number" &&
      skillsHooks.capabilities?.execution === "shell-free-bounded-dry-run" &&
      skillsHooks.capabilities?.approval === "tier-3-for-dry-run-and-enable",
    "Hook inventory, dry-run, or enablement policy was not observable",
  )
  assert(!JSON.stringify(skillsHooks).includes(checkout), "Skill/hook state leaked checkout paths")
  const skillsHooksLifecycle = await mutate("exercise-skills-hooks-fixture", {
    fixtureId: fixtures.skill,
  })
  assert(
    skillsHooksLifecycle.result?.copy?.exactDiff &&
      skillsHooksLifecycle.result?.copy?.sourcePreserved &&
      skillsHooksLifecycle.result?.copy?.targetCleaned &&
      skillsHooksLifecycle.result?.hook?.importedDisabled &&
      skillsHooksLifecycle.result?.hook?.invalidEnableRejected &&
      skillsHooksLifecycle.result?.hook?.validatedBeforeDryRun &&
      skillsHooksLifecycle.result?.hook?.dryRunPassedBeforeEnable &&
      skillsHooksLifecycle.result?.hook?.enabledThenDisabled &&
      skillsHooksLifecycle.result?.hook?.stateRestored &&
      skillsHooksLifecycle.result?.enablement?.user === false &&
      skillsHooksLifecycle.result?.enablement?.project === true &&
      skillsHooksLifecycle.result?.enablement?.task === false &&
      skillsHooksLifecycle.result?.enablement?.nextRunEnforced &&
      skillsHooksLifecycle.result?.enablement?.policiesRestored,
    "Skill copy, hook lifecycle, or scoped next-run policy evidence was incomplete",
  )

  const vaultBefore = await state("project-vaults", { projectId: project.id })
  let vaultProof = "existing vault read through production state"
  if (vaultBefore.policy === null && vaultBefore.sections.length === 0) {
    const vaultCreated = await mutate("create-project-vault-fixture", { projectId: project.id })
    fixtures.vault = fixtureId(vaultCreated)
    const vaultLifecycle = await mutate("write-project-vault-fixture", {
      fixtureId: fixtures.vault,
    })
    assert(
      vaultLifecycle.result?.conflictRejected &&
        vaultLifecycle.result?.unsafeContentRejected &&
        vaultLifecycle.result?.backupRestored,
      "Project vault conflict, secret, or backup-restore behavior was not exercised",
    )
    const vaultAfter = await state("project-vaults", { projectId: project.id })
    assert(
      vaultAfter.sections.some((section) => section.sectionId === "index"),
      "Project vault fixture was not observable",
    )
    vaultProof =
      "owned create/write/stale-conflict/secret-rejection/backup-restore/read/delete fixture"
  }
  assert(!JSON.stringify(vaultBefore).includes(checkout), "Project vault state leaked its root")

  const workspaceCreated = await mutate("create-workspace-fixture", { projectId: project.id })
  fixtures.workspace = fixtureId(workspaceCreated)
  for (const operation of ["rename", "archive", "restore"]) {
    await mutate("mutate-workspace-fixture", {
      fixtureId: fixtures.workspace,
      operation,
    })
  }
  const workspaceLifecycle = await mutate("mutate-workspace-fixture", {
    fixtureId: fixtures.workspace,
    operation: "exercise-layout",
  })
  assert(
    workspaceLifecycle.result?.paneCount === 2 &&
      workspaceLifecycle.result?.bindingTypes?.join(",") === "browser,terminal" &&
      workspaceLifecycle.result?.corruptLayoutRejected,
    "Workspace pane bindings or corrupt-layout rejection were not exercised",
  )

  const automationCreated = await mutate("create-automation-fixture", {
    projectId: project.id,
  })
  fixtures.automation = fixtureId(automationCreated)
  let automationDryRun = null
  for (const operation of ["approve", "resume", "dry-run", "pause"]) {
    const result = await mutate("mutate-automation-fixture", {
      fixtureId: fixtures.automation,
      operation,
    })
    if (operation === "dry-run") automationDryRun = result.result?.preview
  }
  assert(
    automationDryRun?.harness === "codex" &&
      automationDryRun?.scopeType === "project" &&
      automationDryRun?.permissionMode === "read-only",
    "Automation dry-run authority was not exercised",
  )
  assert(
    !JSON.stringify(await state("automations", { projectId: project.id })).includes(
      "STAGE4_AUTOMATION_OK",
    ),
    "Automation state leaked its persisted prompt",
  )

  const localModels = await mutate("refresh-local-model-fixture")
  assert(localModels.result?.state === "ready", "Deterministic local-model fixture was unavailable")
  let localModelProof = "deterministic unpackaged-Dev fixture; no network probe"
  if (process.env.FLAPSTACK_STAGE4_REAL_OLLAMA === "1") {
    const endpoint = process.env.FLAPSTACK_STAGE4_OLLAMA_ENDPOINT || "http://127.0.0.1:11434"
    const model = process.env.FLAPSTACK_STAGE4_OLLAMA_MODEL || "gemma3:4b"
    const realOllama = await mutate("exercise-real-ollama-fixture", {
      projectId: project.id,
      endpoint,
      model,
    })
    assert(
      realOllama.result?.state === "completed" &&
        realOllama.result?.provider === "ollama" &&
        realOllama.result?.model === model &&
        realOllama.result?.catalogIdentityConfirmed &&
        realOllama.result?.streaming?.textDeltaCount >= 2 &&
        realOllama.result?.streaming?.textLength > 0 &&
        realOllama.result?.streaming?.finished &&
        realOllama.result?.usage?.providerId === "local" &&
        realOllama.result?.usage?.model === model &&
        realOllama.result?.usage?.inputUsageRecorded === true &&
        realOllama.result?.usage?.outputUsageRecorded === true &&
        realOllama.result?.usage?.totalUsageRecorded === true &&
        realOllama.result?.usage?.costUsd === 0 &&
        realOllama.result?.usage?.costQuality === "exact" &&
        realOllama.result?.fallback?.mode === "none" &&
        realOllama.result?.fallback?.cloudAllowed === false &&
        realOllama.result?.cleanupConfirmed,
      "Production Ollama catalog/stream/usage/fallback/cleanup evidence was incomplete",
    )
    localModelProof =
      "opt-in production loopback Ollama exact-model catalog/stream/usage/no-cloud-fallback with owned cleanup"
  }

  const budgetCreated = await mutate("create-usage-budget-fixture", {
    projectId: project.id,
  })
  fixtures.budget = fixtureId(budgetCreated)
  const usage = await state("usage-limits", { projectId: project.id })
  assert(
    usage.budgets.some((budget) => budget.id === budgetCreated.result.budgetId),
    "Usage budget fixture was not observable",
  )
  assert(
    typeof usage.rollup?.itemCount === "number" &&
      typeof usage.rollup?.quality === "string" &&
      typeof usage.insight?.coverage === "string" &&
      typeof usage.insight?.quality === "string",
    "Usage rollup and quality evidence was not observable",
  )

  const portability = await state("portability")
  assert(
    portability.capabilities &&
      portability.operation?.activeReaders === 0 &&
      portability.operation?.exclusivePending === false &&
      portability.operation?.exclusiveActive === false,
    "Portability capability or maintenance state was not observable",
  )
  const portabilityStarted = await mutate("start-portability-lifecycle-fixture", {
    projectId: project.id,
  })
  portabilityJobId = portabilityStarted.result?.jobId
  assert(typeof portabilityJobId === "string", "Portability lifecycle returned no job identity")
  await closePrimaryConnection()
  const portabilityLifecycle = await pollPortabilityLifecycle(portabilityJobId)
  await connectPrimary()
  if (portabilityLifecycle.status === "failed") {
    throw new Error(portabilityLifecycle.error || "Portability lifecycle job failed")
  }
  assert(
    portabilityLifecycle.result?.exported &&
      portabilityLifecycle.result?.planned &&
      portabilityLifecycle.result?.confirmed &&
      portabilityLifecycle.result?.applied &&
      portabilityLifecycle.result?.restored &&
      portabilityLifecycle.result?.cleaned,
    "Portability export/plan/apply/restore lifecycle was not exercised",
  )
  await mutate("cleanup-portability-lifecycle-fixture", { jobId: portabilityJobId })
  portabilityJobId = null

  const planningBefore = await state("planning", { projectId: project.id })
  let planningProof = "existing fixture preserved; production state read only"
  if (planningBefore.fixture?.state === "not-owned") {
    const planCreated = await mutate("create-plan-fixture", { projectId: project.id })
    fixtures.plan = fixtureId(planCreated)
    const exercised = await mutate("exercise-plan-fixture", { fixtureId: fixtures.plan })
    assert(
      exercised.result?.advanced &&
        exercised.result?.approved === 1 &&
        exercised.result?.denied === 1,
      "Planning fixture was not exercised",
    )
    planningProof = "owned fixture create/approve/deny/advance/reset"
  } else {
    assert(
      ["ready", "advanced"].includes(planningBefore.fixture?.state),
      `Unsafe pre-existing Plan fixture state: ${planningBefore.fixture?.state}`,
    )
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        checkout,
        profile,
        transport: "authenticated dev-test MCP",
        screenControl: false,
        externalDispatch: false,
        productionFamilies: {
          skillsHooks:
            "owned exact cross-harness copy/source preservation, hook import/validation/dry-run/enable/disable, and user/project/task next-run policy",
          projectVaults: vaultProof,
          savedWorkspaces:
            "owned create/rename/archive/restore/layout/pane-resolution/corrupt-layout/delete fixture",
          automations: "owned draft/dry-run/approve/enable/pause/archive; never fired",
          localModels: localModelProof,
          usageLimits: "owned project budget plus production rollup/quality create/read/delete",
          portability:
            "restart-aware owned export/dry-run/confirm/apply/backup-restore/cleanup plus idle maintenance state",
          planning: planningProof,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  verificationError = error
} finally {
  const cleanupErrors = []
  const safely = async (label, operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!client) await safely("MCP reconnect", connectPrimary)
  if (portabilityJobId) {
    await safely("portability lifecycle", async () => {
      await closePrimaryConnection()
      await pollPortabilityLifecycle(portabilityJobId)
      await connectPrimary()
      await mutate("cleanup-portability-lifecycle-fixture", { jobId: portabilityJobId })
      portabilityJobId = null
    })
  }
  for (const [label, action] of [
    ["plan", "cleanup-plan-fixture"],
    ["budget", "cleanup-usage-budget-fixture"],
    ["automation", "cleanup-automation-fixture"],
    ["workspace", "cleanup-workspace-fixture"],
    ["vault", "cleanup-project-vault-fixture"],
    ["skill", "cleanup-project-skill-fixture"],
  ]) {
    if (fixtures[label]) {
      await safely(label, () => mutate(action, { fixtureId: fixtures[label] }))
    }
  }
  await safely("beta settings", () => mutate("restore-stage4-beta-fixtures"))
  await safely("owned fixture recovery", () => mutate("cleanup-all-owned-fixtures"))
  await closePrimaryConnection()
  if (cleanupErrors.length) {
    cleanupError = new Error(`Stage 4 fixture cleanup failed: ${cleanupErrors.join("; ")}`)
  }
}

if (verificationError && cleanupError) {
  throw new AggregateError(
    [verificationError, cleanupError],
    "Stage 4 operational verification and cleanup both failed",
  )
}
if (verificationError) throw verificationError
if (cleanupError) throw cleanupError
