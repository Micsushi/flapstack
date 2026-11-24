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
import { recoverMcpDispatchClaims } from "./audit-storage"
import { productMcpAudit } from "./production-audit"
import { needsDesktopMcp } from "./live-control-contract"
import { trackRecordsTaskApproval } from "./records-approval-display"
import { desktopProjectToolNames } from "./project-control-contract"
import { desktopWorkflowToolNames } from "./workflow-contract"
import { createMcpReadService, readMcpDatabase } from "./read-service"
import { createMcpProjectVaultService } from "./project-vault-service"
import { createMcpAutomationService } from "./automation-service"
import { createMcpTaskProposalService } from "./task-proposal-service"
import { createMcpMutationService } from "./mutation-service"
import { advertiseProductMcpRuntime } from "./live-discovery"
import { startDesktopMcpTransport, type DesktopMcpInvoke } from "./live-transport"
import { createSqliteMcpCallerStore } from "./identity"
import { requireWorkflowChat } from "./workflow-targets"
import { startProductMcpInvalidationBridge } from "./invalidation-bridge"

export function desktopMcpInvoker(
  databasePath: string,
  notify: (event: ProductMcpRendererInvalidation) => void,
): DesktopMcpInvoke {
  const reads = createMcpReadService(readMcpDatabase(getSqliteDatabase))
  const mutations = createMcpMutationService(databasePath, getSqliteDatabase)
  const projectVaults = createMcpProjectVaultService(databasePath)
  const automationControls = createMcpAutomationService(databasePath)
  const taskProposalControls = createMcpTaskProposalService(databasePath)
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
      const caller = resolveCaller()
      const invocationId = randomUUID()
      const runSession = caller.permissionMode === "ask-before-edits" && caller.runId
      const approvals = runSession ? approvalsForRun(runSession) : createApprovals()
      const untrack =
        name === "create_task" ? trackRecordsTaskApproval(invocationId, approvals) : undefined
      const disconnected = () => approvals.cancel(invocationId)
      signal.addEventListener("abort", disconnected, { once: true })
      try {
        const response = await invokeMcpControlTool(name, caller, input, reads, {
          mutations,
          projectVaults,
          automationControls,
          taskProposalControls,
          resolveCaller,
          approvals,
          invocationId: () => invocationId,
          approvalId: () => invocationId,
          audit: productMcpAudit(() => changed("audit")),
          execute: needsDesktopMcp(name)
            ? async ({ caller: current, context }) => {
                if (desktopProjectToolNames.has(name))
                  return (await import("./desktop-project-actions")).invokeDesktopProjectTool(
                    name,
                    current,
                    input,
                    context,
                  )
                if (name === "create_project" || name === "move_chat")
                  return mutations.invoke(name, current, input, context)
                if (desktopWorkflowToolNames.has(name))
                  return (await import("./desktop-workflows")).invokeDesktopWorkflow(
                    name,
                    current,
                    input,
                    context,
                  )
                if (name === "list_models" || name === "list_providers")
                  return (await import("./desktop-models")).invokeDesktopModelDiscovery(
                    name,
                    current,
                    input,
                  )
                return (await import("./desktop-run-actions")).invokeDesktopRunTool(
                  name,
                  current,
                  input,
                )
              }
            : undefined,
        })
        const event = invalidationForProductMcpMutation(name, input, response)
        if (event) notify(event)
        return response
      } finally {
        untrack?.()
        signal.removeEventListener("abort", disconnected)
        if (!runSession) approvals.shutdown()
      }
    })
}

export async function startProductMcpRuntime(
  databasePath: string,
  onInvalidation: (event: ProductMcpRendererInvalidation) => void,
) {
  recoverMcpDispatchClaims(getDatabase())
  const invalidation = await startProductMcpInvalidationBridge({ onInvalidation })
  try {
    const control = await startDesktopMcpTransport(
      databasePath,
      desktopMcpInvoker(databasePath, onInvalidation),
      createSqliteMcpCallerStore(databasePath, getSqliteDatabase),
      (caller, chatId) => requireWorkflowChat(getSqliteDatabase(), caller, chatId),
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
