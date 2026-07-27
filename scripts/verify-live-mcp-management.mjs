#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"

const checkout = await realpath(resolve(process.cwd()))
const profile = resolveDevMcpProfile()
const descriptorPath = resolveDevMcpDescriptorPath(profile)
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"))
const proofTag = `Stage3 MCP closeout ${Date.now()}`
const secretMarker = `sk-live-${randomUUID()}-DO-NOT-STORE`
const keep = process.env.FLAPSTACK_KEEP_MCP_PROOF === "1"

assert((await realpath(descriptor.checkout)) === checkout, "Dev MCP checkout mismatch")
assert(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(descriptor.url), "Invalid dev MCP URL")
assert(descriptor.token, "Missing dev MCP token")

const client = new Client({ name: "flapstack-live-mcp-management", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
const callers = []
let passed = false
let testProject = null

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

async function waitForProductCall(callId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await call("get_product_mcp_call", { callId })
    if (result.status !== "running") return result
    await delay(250)
  }
  throw new Error(`Timed out waiting for product MCP call ${callId}`)
}

async function waitForApproval(chatId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await call("get_product_mcp_state", { chatId })
    if (state.pendingApprovals[0]) return state.pendingApprovals[0]
    await delay(100)
  }
  throw new Error(`Timed out waiting for approval on ${chatId}`)
}

async function waitForRenderer(
  chatId,
  predicate,
  timeoutMs = process.platform === "win32" ? 45_000 : 15_000,
) {
  const deadline = Date.now() + timeoutMs
  let lastState
  let lastError
  while (Date.now() < deadline) {
    try {
      const state = await call("get_product_mcp_renderer_state", { chatId })
      lastState = state
      lastError = undefined
      if (predicate(state)) return state
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(200)
  }
  throw new Error(
    `Renderer state did not settle for ${chatId}: ${JSON.stringify(lastState)}` +
      (lastError ? `; last control error: ${lastError}` : ""),
  )
}

async function startCall(caller, toolName, args = {}) {
  return call("start_product_mcp_call", {
    chatId: caller.chatId,
    runId: caller.runId,
    toolName,
    arguments: args,
  })
}

async function decideCall(caller, toolName, args, decision, grantSession = false) {
  const started = await startCall(caller, toolName, args)
  const approval = await waitForApproval(caller.chatId)
  await call("reply_product_mcp_approval", {
    approvalId: approval.id,
    decision,
    grantSession,
  })
  return { approval, result: await waitForProductCall(started.id) }
}

async function waitForChild(caller, harness, token) {
  const deadline = Date.now() + 240_000
  let child
  while (Date.now() < deadline) {
    const state = await call("get_product_mcp_state", { chatId: caller.chatId })
    child = state.children.find((candidate) => candidate.harness === harness)
    const runId = child?.runs[0]?.id
    if (runId) {
      assert(child.mcpExposureEnabled === true, `${harness} child did not default MCP exposure on`)
      const runState = await call("get_run_state", { runId })
      if (["success", "failure", "cancelled"].includes(runState.run?.status)) {
        assert(runState.run.status === "success", `${harness} child failed: ${runState.run.status}`)
        assert(runState.assistant?.text?.trim() === token, `${harness} child response mismatch`)
        return { child, run: runState }
      }
    }
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${harness} child`)
}

function spawnArgs(targetHarness, token) {
  return {
    targetHarness,
    scope: { kind: "global" },
    permission: { mode: "read-only" },
    worktree: { strategy: "inherit" },
    launch: {
      initialPrompt: `Reply exactly ${token}. Do not inspect files, run tools, or edit anything.`,
    },
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

try {
  await client.connect(transport)
  const environment = await call("get_test_environment")
  assert((await realpath(environment.repo.path)) === checkout, "Live environment mismatch")
  const harnessStatus = await call("get_harness_status")
  testProject = await call("ensure_test_project")

  let codex = await call("prepare_product_mcp_caller", {
    harness: "codex",
    name: `${proofTag} codex`,
    repoPath: checkout,
    permissionMode: "ask-before-edits",
  })
  callers.push(codex.chatId)
  let claude = await call("prepare_product_mcp_caller", {
    harness: "claude",
    name: `${proofTag} claude`,
    repoPath: checkout,
    permissionMode: "ask-before-edits",
  })
  callers.push(claude.chatId)
  const fullAccess = await call("prepare_product_mcp_caller", {
    harness: "codex",
    name: `${proofTag} full access`,
    repoPath: checkout,
    permissionMode: "full-access",
  })
  callers.push(fullAccess.chatId)
  assert(codex.exposure.connection === "disabled", "Codex exposure was not default-off")
  assert(claude.exposure.connection === "disabled", "Claude exposure was not default-off")
  assert(fullAccess.exposure.connection === "disabled", "Full-access exposure was not default-off")

  await call("open_test_chat", { chatId: codex.chatId })
  await call("set_product_mcp_exposure", { chatId: codex.chatId, enabled: true })
  for (const toolName of ["ping", "describe"]) {
    const result = await waitForProductCall((await startCall(codex, toolName)).id)
    assert(result.status === "completed", `Codex ${toolName} failed`)
  }
  await call("set_product_mcp_exposure", { chatId: codex.chatId, enabled: false })
  assert(
    (await call("get_product_mcp_state", { chatId: codex.chatId })).exposure.connection ===
      "disabled",
    "Codex disconnect was not durable",
  )
  codex = await call("prepare_product_mcp_caller", {
    harness: "codex",
    name: `${proofTag} codex reconnect`,
    repoPath: checkout,
    permissionMode: "ask-before-edits",
  })
  callers.push(codex.chatId)
  await call("set_product_mcp_exposure", { chatId: codex.chatId, enabled: true })
  assert(
    (await waitForProductCall((await startCall(codex, "ping")).id)).status === "completed",
    "Codex reconnect failed",
  )

  await call("set_product_mcp_exposure", { chatId: claude.chatId, enabled: true })
  assert(
    (await waitForProductCall((await startCall(claude, "ping")).id)).status === "completed",
    "Claude ping failed",
  )
  await call("set_product_mcp_exposure", { chatId: claude.chatId, enabled: false })
  claude = await call("prepare_product_mcp_caller", {
    harness: "claude",
    name: `${proofTag} claude reconnect`,
    repoPath: checkout,
    permissionMode: "ask-before-edits",
  })
  callers.push(claude.chatId)
  await call("set_product_mcp_exposure", { chatId: claude.chatId, enabled: true })
  assert(
    (await waitForProductCall((await startCall(claude, "describe")).id)).status === "completed",
    "Claude reconnect failed",
  )

  await call("set_product_mcp_exposure", { chatId: fullAccess.chatId, enabled: true })
  const autoApprovedTier3 = await startCall(fullAccess, "spawn_thread", {
    targetHarness: "claude-code",
    scope: { kind: "global" },
    permission: { mode: "read-only" },
    worktree: { strategy: "none" },
  })
  assert(
    (await waitForProductCall(autoApprovedTier3.id)).status === "completed",
    "Full-access Tier 3 call failed",
  )
  const fullAccessState = await call("get_product_mcp_state", {
    chatId: fullAccess.chatId,
    toolName: "spawn_thread",
    limit: 100,
  })
  assert(fullAccessState.pendingApprovals.length === 0, "Full-access Tier 3 call prompted")
  const fullAccessDecisions = fullAccessState.audit.entries.map((entry) => entry.decision)
  for (const decision of ["allowed", "dispatch-started", "completed"]) {
    assert(fullAccessDecisions.includes(decision), `Full-access Tier 3 audit missed ${decision}`)
  }
  assert(
    !fullAccessDecisions.includes("approval-required"),
    "Full-access Tier 3 audit recorded an approval prompt",
  )

  await call("open_test_chat", { chatId: codex.chatId })
  await call("control_product_mcp_renderer", { chatId: codex.chatId, operation: "open-audit" })
  const grantStarted = await startCall(codex, "create_chat", {
    name: `${proofTag} grant one`,
    scope: "global",
    harness: "codex",
  })
  const grantApproval = await waitForApproval(codex.chatId)
  const activeRenderer = await waitForRenderer(codex.chatId, (state) => state.approvalDialogOpen)
  assert(activeRenderer.selectedChatId === codex.chatId, "Active approval selected wrong caller")
  await call("reply_product_mcp_approval", {
    approvalId: grantApproval.id,
    decision: "approve",
    grantSession: true,
  })
  assert((await waitForProductCall(grantStarted.id)).status === "completed", "Grant call failed")
  const grantedAgain = await startCall(codex, "create_chat", {
    name: `${proofTag} ${secretMarker}`,
    scope: "global",
    harness: "codex",
  })
  assert((await waitForProductCall(grantedAgain.id)).status === "completed", "Session grant failed")
  assert(
    (await call("get_product_mcp_state", { chatId: codex.chatId })).pendingApprovals.length === 0,
    "Session grant unexpectedly prompted",
  )

  const denied = await decideCall(
    claude,
    "create_chat",
    { name: `${proofTag} denied`, scope: "global", harness: "claude-code" },
    "deny",
  )
  assert(denied.result.status === "failed", "Denied mutation did not fail")

  await call("open_test_chat", { chatId: codex.chatId })
  const backgroundStarted = await startCall(claude, "create_chat", {
    name: `${proofTag} background denied`,
    scope: "global",
    harness: "claude-code",
  })
  const backgroundApproval = await waitForApproval(claude.chatId)
  const backgroundRenderer = await waitForRenderer(
    claude.chatId,
    (state) => state.backgroundApprovalVisible && state.reviewActionVisible,
  )
  assert(backgroundRenderer.selectedChatId === codex.chatId, "Background approval stole selection")
  await call("reply_product_mcp_approval", {
    approvalId: backgroundApproval.id,
    decision: "deny",
  })
  assert(
    (await waitForProductCall(backgroundStarted.id)).status === "failed",
    "Background denial did not fail",
  )

  const timeoutStarted = await startCall(claude, "create_chat", {
    name: `${proofTag} timeout`,
    scope: "global",
    harness: "claude-code",
  })
  await waitForApproval(claude.chatId)
  await waitForRenderer(claude.chatId, (state) => state.backgroundApprovalVisible)
  const timedOut = await waitForProductCall(timeoutStarted.id, 75_000)
  assert(timedOut.status === "failed", "Timed-out approval did not fail")
  await waitForRenderer(claude.chatId, (state) => !state.backgroundApprovalVisible)

  const codexToClaude = await decideCall(
    codex,
    "spawn_thread",
    spawnArgs("claude-code", "CLAUDE_CHILD_READY"),
    "approve",
    true,
  )
  assert(codexToClaude.result.status === "completed", "Codex-to-Claude spawn failed")
  const claudeChild = await waitForChild(codex, "claude-code", "CLAUDE_CHILD_READY")

  const freshTier3 = await startCall(codex, "spawn_thread", spawnArgs("codex", "NEVER_RUN"))
  const freshTier3Approval = await waitForApproval(codex.chatId)
  await call("reply_product_mcp_approval", {
    approvalId: freshTier3Approval.id,
    decision: "approve",
  })
  assert(
    (await waitForProductCall(freshTier3.id)).status === "failed",
    "Same-harness spawn was allowed",
  )

  const claudeToCodex = await decideCall(
    claude,
    "spawn_thread",
    spawnArgs("codex", "CODEX_CHILD_READY"),
    "approve",
  )
  assert(claudeToCodex.result.status === "completed", "Claude-to-Codex spawn failed")
  const codexChild = await waitForChild(claude, "codex", "CODEX_CHILD_READY")

  const selfArchive = await startCall(codex, "archive_item", {
    kind: "chat",
    id: codex.chatId,
  })
  assert((await waitForProductCall(selfArchive.id)).status === "failed", "Self-archive was allowed")

  const auditFirst = await call("get_product_mcp_state", {
    chatId: codex.chatId,
    limit: 2,
  })
  assert(auditFirst.audit.entries.length === 2, "Audit first page was not bounded")
  assert(auditFirst.audit.nextCursor, "Audit first page had no cursor")
  const auditSecond = await call("get_product_mcp_state", {
    chatId: codex.chatId,
    cursor: auditFirst.audit.nextCursor,
    limit: 2,
  })
  assert(auditSecond.audit.entries.length > 0, "Audit second page was empty")
  const redactionAudit = await call("get_product_mcp_state", {
    chatId: codex.chatId,
    toolName: "create_chat",
    limit: 100,
  })
  assert(
    !JSON.stringify(redactionAudit.audit).includes(secretMarker),
    "Audit leaked credential marker",
  )

  await call("open_test_chat", { chatId: codex.chatId })
  await call("control_product_mcp_renderer", { chatId: codex.chatId, operation: "open-audit" })
  const auditRenderer = await waitForRenderer(
    codex.chatId,
    (state) => state.auditOpen && state.auditRendered && state.exposureRendered,
  )
  assert(auditRenderer.exposureText?.includes("Connected"), "Renderer exposure state was stale")
  passed = true

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        checkout,
        profile,
        proofTag,
        harnessStatus,
        callers: { codex: codex.chatId, claude: claude.chatId },
        children: {
          claude: { chatId: claudeChild.child.id, runId: claudeChild.run.run.id },
          codex: { chatId: codexChild.child.id, runId: codexChild.run.run.id },
        },
        approvals: {
          active: true,
          backgroundWithoutSelectionTheft: true,
          approve: true,
          deny: true,
          timeout: true,
          sessionGrant: true,
          tier3FreshApproval: true,
          fullAccessTier3AutoApproved: true,
        },
        exposure: {
          fixtureStartsDisabled: true,
          spawnedSupportedChildrenDefaultOn: true,
          codexReconnect: true,
          claudeReconnect: true,
        },
        audit: {
          paging: true,
          redaction: true,
          rendererControl: true,
          rendererRendered: true,
          exposureRendered: true,
        },
        safety: { selfArchiveDenied: true, sameHarnessSpawnDenied: true },
        keptForRestartProof: keep,
      },
      null,
      2,
    ),
  )
} finally {
  if (!keep || !passed) {
    for (const chatId of callers) {
      await call("cleanup_product_mcp_caller", { chatId }).catch(() => undefined)
    }
    const targets = await call("list_test_targets").catch(() => null)
    for (const chat of targets?.chats ?? []) {
      if (!chat.archived && chat.name?.startsWith(proofTag)) {
        await call("archive_test_chat", { chatId: chat.id }).catch(() => undefined)
      }
    }
    if (testProject?.created || testProject?.restored) {
      await call("archive_test_project", { projectId: testProject.project.id }).catch(
        () => undefined,
      )
    }
  }
  await transport.close().catch(() => undefined)
}
