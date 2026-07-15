import { z } from "zod"
import { automationDraftSchema } from "../../../shared/automation"
import {
  AutomationControlError,
  AutomationControlService,
  type AutomationApprovalContext,
} from "../automation/control-service"
import type { McpCallerIdentity, McpControlResponse } from "./types"

const id = z.string().trim().min(1).max(200)
const expectedVersion = z.number().int().positive()

const schemas = {
  list_automations: z
    .object({
      includeArchived: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().max(64).optional(),
    })
    .strict(),
  read_automation: z.object({ automationId: id }).strict(),
  create_automation_draft: z
    .object({
      idempotencyKey: z.string().trim().min(1).max(128),
      draft: automationDraftSchema,
    })
    .strict(),
  update_automation: z
    .object({ automationId: id, expectedVersion, draft: automationDraftSchema })
    .strict(),
  enable_automation: z
    .object({ automationId: id, expectedVersion, enabled: z.boolean().default(true) })
    .strict(),
} as const

export const mcpAutomationToolNames = new Set(Object.keys(schemas))

export const mcpAutomationInputShapes: Record<string, z.ZodRawShape> = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, schema.shape]),
)

export type McpAutomationDispatchContext = {
  invocationId: string
  approved: boolean
}

export type McpAutomationService = {
  invoke(
    name: string,
    caller: McpCallerIdentity,
    input: unknown,
    context: McpAutomationDispatchContext,
  ): Promise<McpControlResponse>
}

export function createMcpAutomationService(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpAutomationService {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP automation control.")
  const service = new AutomationControlService(databasePath)
  return {
    async invoke(name, caller, rawInput, context) {
      const schema = schemas[name as keyof typeof schemas]
      if (!schema) return error("invalid-input", "Unsupported automation operation.")
      const parsed = schema.safeParse(rawInput)
      if (!parsed.success) {
        return error("invalid-input", parsed.error.issues[0]?.message ?? "Invalid input.")
      }
      const actor = { type: "agent" as const, chatId: caller.chatId, runId: caller.runId }
      const approval = context.approved
        ? ({
            approvedBy: "local-user",
            auditId: context.invocationId,
          } satisfies AutomationApprovalContext)
        : undefined
      try {
        switch (name) {
          case "list_automations":
            return {
              ok: true,
              data: service.list(actor, parsed.data as z.infer<typeof schemas.list_automations>),
            }
          case "read_automation": {
            const input = parsed.data as z.infer<typeof schemas.read_automation>
            return { ok: true, data: service.read(actor, input.automationId) }
          }
          case "create_automation_draft": {
            const input = parsed.data as z.infer<typeof schemas.create_automation_draft>
            return { ok: true, data: service.createDraft(actor, input) }
          }
          case "update_automation": {
            const input = parsed.data as z.infer<typeof schemas.update_automation>
            return { ok: true, data: service.update(actor, { ...input, approval }) }
          }
          case "enable_automation": {
            const input = parsed.data as z.infer<typeof schemas.enable_automation>
            return { ok: true, data: service.setEnabled(actor, { ...input, approval }) }
          }
          default:
            return error("invalid-input", "Unsupported automation operation.")
        }
      } catch (cause) {
        if (cause instanceof AutomationControlError) return error(cause.code, cause.message)
        return error("internal-error", "Automation control failed.")
      }
    },
  }
}

function error(
  code:
    | "invalid-input"
    | "not-found"
    | "out-of-scope"
    | "conflict"
    | "approval-required"
    | "stale-caller"
    | "internal-error",
  message: string,
): McpControlResponse {
  return { ok: false, error: { code, message } }
}
