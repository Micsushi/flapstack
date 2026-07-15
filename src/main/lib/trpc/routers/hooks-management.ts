import { randomUUID } from "node:crypto"
import { z } from "zod"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { getDatabase } from "../../db"
import {
  FileHookStateStore,
  HookLifecycleService,
  NodeHookDryRunRunner,
  hookDraftSchema,
  hookHarnessSchema,
  type HookApprovalDecision,
  type HookAuditEvent,
  type HookDraft,
} from "../../extension-management"
import { McpApprovalLifecycle } from "../../mcp-control/approval-lifecycle"
import { createSqliteMcpApprovalCoordinator } from "../../mcp-control/approval-coordinator"
import { appendMcpAuditRecord } from "../../mcp-control/audit-storage"
import {
  publishLocalProductInvalidation,
  publishProductMcpInvalidation,
} from "../../mcp-control/invalidation-bridge"
import { publicProcedure, router } from "../index"

let service: HookLifecycleService | null = null

export const hooksManagementRouter = router({
  getCapabilities: publicProcedure.query(() => ({
    schemaVersion: 1 as const,
    enabled: true,
    harnesses: ["claude-code", "codex"] as const,
    lifecycle: ["discovered", "validated", "dry-run-passed", "enabled", "disabled"] as const,
    execution: "shell-free-bounded-dry-run" as const,
    importDefault: "disabled" as const,
    approval: "tier-3-for-dry-run-and-enable" as const,
    maxDryRunMs: 10_000,
    maxOutputBytes: 65_536,
  })),

  listInventory: publicProcedure
    .input(z.object({ harness: hookHarnessSchema.optional() }).optional())
    .query(({ input }) => getService().list(input?.harness)),

  listTemplates: publicProcedure
    .input(z.object({ harness: hookHarnessSchema.optional() }))
    .query(({ input }) => ({
      harness: input.harness ?? null,
      templates: [],
      status: "managed-import-only" as const,
    })),

  previewCommand: publicProcedure.input(hookDraftSchema).query(({ input }) => {
    return getService().preview(registeredDraft(input))
  }),

  importHook: publicProcedure.input(hookDraftSchema).mutation(({ input }) => {
    return getService().import(registeredDraft(input))
  }),

  validateHook: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => getService().validate(input.id)),

  dryRunHook: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => getService().dryRun(input.id)),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(({ input }) => getService().setEnabled(input.id, input.enabled)),
})

function registeredDraft(input: HookDraft): HookDraft {
  if (input.scope !== "project") return { ...input, cwd: undefined }
  if (!input.cwd) throw new Error("Project hooks require a registered project root")
  return { ...input, cwd: assertRegisteredWorktree(input.cwd).canonicalPath }
}

function getService(): HookLifecycleService {
  if (service) return service
  service = new HookLifecycleService(
    new FileHookStateStore(),
    new NodeHookDryRunRunner(),
    { request: requestHookApproval },
    { append: appendHookAudit },
    (cwd) => assertRegisteredWorktree(cwd).canonicalPath,
    publishHookExtensionChange,
  )
  return service
}

export function publishHookExtensionChange(): void {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["provider-extensions"],
  })
}

async function requestHookApproval(input: {
  action: "dry-run" | "enable"
  hookId: string
  harness: HookDraft["harness"]
  scope: HookDraft["scope"]
  event: string
  commandHash: string
}): Promise<HookApprovalDecision> {
  const publishApprovalChange = () => {
    void publishProductMcpInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["approvals"],
    })
  }
  const lifecycle = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase(), publishApprovalChange),
    publishApprovalChange,
  )
  const id = randomUUID()
  try {
    const wait = lifecycle.request({
      id,
      invocationId: id,
      caller: { chatId: "flapstack-settings-hooks" },
      toolName: `hooks.${input.action}`,
      tier: 3,
      timeoutMs: 60_000,
      input: {
        target: input.hookId,
        action: input.action,
        harness: input.harness,
        scope: input.scope,
        event: input.event,
        commandHash: input.commandHash,
      },
    })
    const decision = await wait.decision
    if (
      decision.state === "approved" ||
      decision.state === "denied" ||
      decision.state === "timed-out"
    ) {
      return decision.state
    }
    return "cancelled"
  } finally {
    lifecycle.shutdown()
  }
}

function appendHookAudit(event: HookAuditEvent): void {
  appendMcpAuditRecord(getDatabase(), {
    status: event.status,
    caller: { chatId: "flapstack-settings-hooks" },
    toolName: `hooks.${event.action}`,
    tier: event.action === "enable" || event.action === "dry-run" ? 3 : 2,
    input: {
      hookId: event.hookId,
      harness: event.harness,
      scope: event.scope,
      eventHash: event.eventHash,
      commandHash: event.commandHash,
    },
    result: {
      state: event.state,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    },
    durationMs: event.durationMs,
  })
  void publishProductMcpInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["audit"],
  })
}
