import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { getDatabase, getSqliteDatabase, withDatabaseOperation } from "../db"
import {
  invalidationForProductMcpMutation,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { invokeMcpControlTool } from "./registry"
import { productMcpAudit } from "./production-audit"
import { needsDesktopMcp } from "./live-control-contract"
import { invokeDesktopRunTool } from "./desktop-run-actions"
import { invokeDesktopModelDiscovery } from "./desktop-models"
import { invokeDesktopProjectTool } from "./desktop-project-actions"
import { desktopProjectToolNames } from "./project-control-contract"
import { invokeDesktopWorkflow } from "./desktop-workflows"
import { desktopWorkflowToolNames } from "./workflow-contract"
import { createMcpMutationService } from "./mutation-service"
import { advertiseProductMcpRuntime } from "./live-discovery"
import { startDesktopMcpTransport, type DesktopMcpInvoke } from "./live-transport"
import { startProductMcpInvalidationBridge } from "./invalidation-bridge"

export function desktopMcpInvoker(
  databasePath: string,
  notify: (event: ProductMcpRendererInvalidation) => void,
): DesktopMcpInvoke {
  const changed = (domain: "audit" | "approvals") =>
    notify({ version: 1, source: "product-mcp", domains: [domain] })
  const runApprovals = new Map<string, McpApprovalLifecycle>()
  const createApprovals = () =>
    new McpApprovalLifecycle(
      createSqliteMcpApprovalCoordinator(getDatabase, () => changed("approvals")),
      () => changed("approvals"),
    )
  function approvalsForRun(runId: string) {
    const previous = runApprovals.get(runId)
    if (previous) return previous
    // Only live runs can reuse "approve for this run" on a later socket call.
    const active = new Set(
      getSqliteDatabase().prepare("SELECT id FROM agent_runs WHERE status='running'").pluck().all(),
    )
    for (const [id, lifecycle] of runApprovals) {
      if (!active.has(id)) {
        lifecycle.shutdown()
        runApprovals.delete(id)
      }
    }
    const lifecycle = createApprovals()
    runApprovals.set(runId, lifecycle)
    return lifecycle
  }
  return (name, input, resolveCaller, signal) =>
    withDatabaseOperation(async () => {
      if (!needsDesktopMcp(name))
        return { ok: false, error: { code: "tool-not-found", message: "Unknown desktop control." } }
      const caller = resolveCaller()
      const invocationId = randomUUID()
      const runSession = caller.permissionMode === "ask-before-edits" && caller.runId
      const approvals = runSession ? approvalsForRun(runSession) : createApprovals()
      const disconnected = () => approvals.cancel(invocationId)
      signal.addEventListener("abort", disconnected, { once: true })
      try {
        const response = await invokeMcpControlTool(name, caller, input, undefined, {
          resolveCaller,
          approvals,
          invocationId: () => invocationId,
          approvalId: () => invocationId,
          audit: productMcpAudit(() => changed("audit")),
          execute: ({ caller: current, context }) => {
            if (desktopProjectToolNames.has(name))
              return invokeDesktopProjectTool(name, current, input, context)
            if (name === "create_project" || name === "move_chat")
              return createMcpMutationService(databasePath).invoke(name, current, input, context)
            if (desktopWorkflowToolNames.has(name))
              return invokeDesktopWorkflow(name, current, input, context)
            if (name === "list_models" || name === "list_providers")
              return invokeDesktopModelDiscovery(name, current, input)
            return invokeDesktopRunTool(name, current, input)
          },
        })
        const event = invalidationForProductMcpMutation(name, input, response)
        if (event) notify(event)
        return response
      } finally {
        signal.removeEventListener("abort", disconnected)
        if (!runSession) approvals.shutdown()
      }
    })
}

export async function startProductMcpRuntime(
  databasePath: string,
  onInvalidation: (event: ProductMcpRendererInvalidation) => void,
) {
  const invalidation = await startProductMcpInvalidationBridge({ onInvalidation })
  try {
    const control = await startDesktopMcpTransport(
      databasePath,
      desktopMcpInvoker(databasePath, onInvalidation),
    )
    try {
      const withdraw = advertiseProductMcpRuntime(
        process.env.FLAPSTACK_CONFIG_DIR || dirname(databasePath),
        {
          version: 1,
          databasePath,
          controlEndpoint: control.endpoint,
          invalidationEndpoint: invalidation.endpoint,
        },
      )
      return {
        endpoint: invalidation.endpoint,
        stop: async () => {
          try {
            withdraw()
          } finally {
            await Promise.all([control.stop(), invalidation.stop()])
          }
        },
      }
    } catch (error) {
      await control.stop()
      throw error
    }
  } catch (error) {
    await invalidation.stop()
    throw error
  }
}
