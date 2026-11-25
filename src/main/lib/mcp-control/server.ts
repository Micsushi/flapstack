import { version as applicationVersion } from "../../../../package.json"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { McpCallerIdentity } from "./types"
import {
  invokeMcpControlTool,
  isSessionMcpTool,
  listImplementedMcpControlTools,
  sessionMcpTools,
} from "./registry"
import { evaluateMcpToolGate } from "./gate"
import { workflowInputShapes } from "./workflow-contract"
import { mcpReadInputShapes } from "./read-service"
import { createMcpMutationService, mcpMutationInputShapes } from "./mutation-service"
import { createMcpProjectVaultService, mcpProjectVaultInputShapes } from "./project-vault-service"
import { createMcpAutomationService, mcpAutomationInputShapes } from "./automation-service"
import { createMcpTaskProposalService, mcpTaskProposalInputShapes } from "./task-proposal-service"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { recoverMcpDispatchClaims } from "./audit-storage"
import { productMcpAudit } from "./production-audit"
import { needsDesktopMcp, liveControlInputShapes } from "./live-control-contract"
import { beginDatabaseOperation, getDatabase } from "../db"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { publishProductMcpInvalidation } from "./invalidation-bridge"
import {
  invalidationForProductMcpMutation,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"
import { FLAPSTACK_MCP_INSTRUCTIONS } from "./guidance"
import {
  betaFeatureForMcpTool,
  getBetaFeatureSettings,
  subscribeBetaFeatureSettings,
} from "../beta-features/settings"
import { isFrozenAgentProfileToolAllowed } from "../agent-profiles/runtime-authority"
import { z } from "zod"
import { boundedMcpResult } from "./response-budget"
import type { McpControlResponse } from "./types"

export type ToolExposure = "lazy" | "direct"
export type McpToolDispatch = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<McpControlResponse>

const initialTools = new Set([
  "ping",
  "describe",
  "list_chats",
  "create_chat",
  "spawn_thread",
  "launch_run",
])
const invalidCaller: McpControlResponse = {
  ok: false,
  error: {
    code: "invalid-caller",
    message: "The owner grant or active chat run is no longer valid.",
  },
}
const noDesktop: McpControlResponse = {
  ok: false,
  error: {
    code: "tool-unavailable",
    message: "The selected Flapstack profile must be running to use this control.",
  },
}
const diffReplyWindowMs = 2_000
const maxPendingDiffs = 8

export function createMcpControlServer(
  resolveCaller: () => McpCallerIdentity,
  dispatch: McpToolDispatch,
  exposure: ToolExposure,
  assertDiffVisible?: (caller: McpCallerIdentity, chatId: string) => void,
): McpServer {
  const startupCaller = resolveCaller()
  const startupAuthority = startupCaller.profileRuntimeAuthority
  const allowed = (name: string) =>
    !startupAuthority || isFrozenAgentProfileToolAllowed(startupAuthority, name)
  const server = new McpServer(
    { name: "flapstack-app-control", version: applicationVersion },
    { instructions: FLAPSTACK_MCP_INSTRUCTIONS },
  )
  const tools = listImplementedMcpControlTools({ includeDisabledBeta: true }).filter(
    (tool) => !isSessionMcpTool(tool.name) && allowed(tool.name),
  )
  const lazy = exposure === "lazy" && allowed("tool_search")
  const canUseDiffHandle = !!assertDiffVisible && allowed("dispatch_status")
  const registrations = new Map<string, ReturnType<typeof server.registerTool>>()
  const selected = new Set(
    tools.filter((tool) => !lazy || initialTools.has(tool.name)).map((tool) => tool.name),
  )
  type DiffJob = {
    chatId: string
    created: number
    result?: McpControlResponse
    collected?: boolean
    controller: AbortController
  }
  const activeDiffs = new Map<string, DiffJob>()
  let statusRegistration: ReturnType<typeof server.registerTool> | undefined
  const readDiff = async (
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<McpControlResponse> => {
    if (!canUseDiffHandle || typeof input.chatId !== "string")
      return await dispatch("read_git_diff", input, signal)
    for (const [id, job] of activeDiffs) {
      if (job.created + 120_000 <= Date.now()) {
        job.controller.abort()
        activeDiffs.delete(id)
      }
    }
    if (activeDiffs.size >= maxPendingDiffs) {
      const collected = [...activeDiffs].find(([, entry]) => entry.collected)
      if (collected) activeDiffs.delete(collected[0])
    }
    if (activeDiffs.size >= maxPendingDiffs)
      return {
        ok: false,
        error: { code: "tool-unavailable", message: "Collect the earlier diff requests first." },
      }

    const id = randomUUID()
    const controller = new AbortController()
    const job: DiffJob = { chatId: input.chatId, created: Date.now(), controller }
    activeDiffs.set(id, job)
    const work = dispatch(
      "read_git_diff",
      input,
      AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]),
    )
      .catch((): McpControlResponse => ({
        ok: false,
        error: { code: "internal-error", message: "Could not read the diff." },
      }))
      .then((result) => {
        job.result = result
        return result
      })
    const replyWindow = new AbortController()
    try {
      const outcome = await Promise.race([
        work,
        delay(diffReplyWindowMs, undefined, { signal: replyWindow.signal }).catch(() => undefined),
      ])
      if (outcome) {
        activeDiffs.delete(id)
        return outcome
      }
      statusRegistration?.enable()
      return { ok: true, data: { status: "pending", handle: id, pollTool: "dispatch_status" } }
    } finally {
      replyWindow.abort()
    }
  }

  for (const tool of tools) {
    const registration = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema:
          liveControlInputShapes[tool.name] ??
          workflowInputShapes[tool.name] ??
          mcpReadInputShapes[tool.name] ??
          mcpMutationInputShapes[tool.name] ??
          mcpProjectVaultInputShapes[tool.name] ??
          mcpAutomationInputShapes[tool.name] ??
          mcpTaskProposalInputShapes[tool.name],
        annotations: { readOnlyHint: tool.tier === 0, destructiveHint: tool.tier >= 2 },
      },
      async (input, extra) => {
        const toolInput = extra ? (input as Record<string, unknown>) : {}
        const { signal } = extra ?? (input as { signal: AbortSignal })
        const response =
          tool.name === "read_git_diff"
            ? await readDiff(toolInput, signal)
            : await dispatch(tool.name, toolInput, signal)
        return boundedMcpResult(response)
      },
    )
    registrations.set(tool.name, registration)
    const betaFeature = betaFeatureForMcpTool(tool.name)
    if (!selected.has(tool.name) || (betaFeature && !getBetaFeatureSettings()[betaFeature]))
      registration.disable()
  }

  if (allowed("tool_search"))
    server.registerTool(
      "tool_search",
      {
        description: sessionMcpTools.tool_search.description,
        inputSchema: { query: z.string().trim().min(1).max(200) },
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => {
        let caller: McpCallerIdentity
        try {
          caller = resolveCaller()
        } catch {
          return boundedMcpResult(invalidCaller)
        }
        const gate = evaluateMcpToolGate({ caller, tool: sessionMcpTools.tool_search })
        if (gate.decision === "denied")
          return boundedMcpResult({
            ok: false,
            error: { code: "permission-denied", message: gate.reason },
          })
        const beta = getBetaFeatureSettings()
        const terms = query
          .toLowerCase()
          .split(/[^a-z0-9_]+/)
          .filter(Boolean)
        const matches = tools
          .filter((tool) => {
            if (evaluateMcpToolGate({ caller, tool }).decision === "denied") return false
            const feature = betaFeatureForMcpTool(tool.name)
            return !feature || beta[feature]
          })
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            score: terms.reduce(
              (score, term) =>
                score +
                (tool.name === term
                  ? 100
                  : tool.name.includes(term)
                    ? 3
                    : tool.description.toLowerCase().includes(term)
                      ? 1
                      : 0),
              0,
            ),
          }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
          .slice(0, 8)
          .map(({ name, description }) => ({ name, description }))
        for (const { name } of matches) {
          if (selected.has(name)) continue
          selected.add(name)
          registrations.get(name)?.enable()
        }
        return boundedMcpResult({ ok: true, data: { tools: matches } })
      },
    )

  if (assertDiffVisible && canUseDiffHandle && allowed("read_git_diff")) {
    statusRegistration = server.registerTool(
      "dispatch_status",
      {
        description: sessionMcpTools.dispatch_status.description,
        inputSchema: { handle: z.string().uuid() },
        annotations: { readOnlyHint: true },
      },
      async ({ handle }) => {
        const job = activeDiffs.get(handle)
        if (!job || job.created + 120_000 <= Date.now())
          return boundedMcpResult({
            ok: false,
            error: {
              code: "not-found",
              message: "Diff handle expired or belongs to another session.",
            },
          })
        try {
          const caller = resolveCaller()
          const gate = evaluateMcpToolGate({ caller, tool: sessionMcpTools.dispatch_status })
          if (gate.decision === "denied")
            throw new Error("Diff handle is outside the caller's permissions.")
          if (
            caller.projectId !== startupCaller.projectId ||
            caller.taskId !== startupCaller.taskId
          )
            throw new Error("Caller scope changed.")
          assertDiffVisible(caller, job.chatId)
        } catch {
          job.controller.abort()
          activeDiffs.delete(handle)
          return boundedMcpResult(invalidCaller)
        }
        if (job.result) {
          job.collected = true
          return boundedMcpResult(job.result)
        }
        return boundedMcpResult({
          ok: true,
          data: { status: "pending", handle, pollTool: "dispatch_status" },
        })
      },
    )
    statusRegistration.disable()
  }

  const unsubscribe = subscribeBetaFeatureSettings((settings) => {
    for (const [name, registration] of registrations) {
      const feature = betaFeatureForMcpTool(name)
      if (!feature || !selected.has(name)) continue
      if (settings[feature]) registration.enable()
      else registration.disable()
    }
  })
  const close = server.close.bind(server)
  server.close = async () => {
    unsubscribe()
    for (const job of activeDiffs.values()) job.controller.abort()
    activeDiffs.clear()
    await close()
  }
  return server
}

function createOwnerDispatch(resolveCaller: () => McpCallerIdentity) {
  const owner = resolveCaller()
  const publish = (event: ProductMcpRendererInvalidation) => {
    void publishProductMcpInvalidation(event)
  }
  const publishApprovalChange = () =>
    publish({ version: 1, source: "product-mcp", domains: ["approvals"] })
  const approvals = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase, publishApprovalChange),
    publishApprovalChange,
  )
  const services = {
    mutations: createMcpMutationService(),
    projectVaults: createMcpProjectVaultService(),
    automationControls: createMcpAutomationService(),
    taskProposalControls: createMcpTaskProposalService(),
  }
  return {
    shutdown: () => approvals.shutdown(),
    async invoke(name: string, input: unknown) {
      const release = beginDatabaseOperation()
      try {
        const invocationId = randomUUID()
        const response = await invokeMcpControlTool(name, owner, input, undefined, {
          ...services,
          approvals,
          approvalId: () => invocationId,
          invocationId: () => invocationId,
          audit: productMcpAudit(() =>
            publish({ version: 1, source: "product-mcp", domains: ["audit"] }),
          ),
          resolveCaller,
        })
        const event = invalidationForProductMcpMutation(name, input, response)
        if (event) publish(event)
        return response
      } finally {
        release()
      }
    },
  }
}

export async function connectOfflineMcpControlServer(
  transport: Transport,
  resolveExternal: () => McpCallerIdentity,
  exposure: ToolExposure,
) {
  const owner = resolveExternal()
  if (owner.callerKind !== "external-owner") throw new Error("Expected a verified owner grant.")
  recoverMcpDispatchClaims(getDatabase())
  const dispatch = createOwnerDispatch(resolveExternal)
  const server = createMcpControlServer(
    resolveExternal,
    (name, input) =>
      needsDesktopMcp(name) ? Promise.resolve(noDesktop) : dispatch.invoke(name, input),
    exposure,
  )
  try {
    await server.connect(transport)
  } catch (error) {
    dispatch.shutdown()
    await server.close()
    throw error
  }
  return {
    close: async () => {
      dispatch.shutdown()
      await server.close()
    },
  }
}
