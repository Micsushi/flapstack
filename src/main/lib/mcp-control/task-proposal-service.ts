import { z } from "zod"
import { taskProposalContentSchema } from "../../../shared/task-proposals"
import { TaskProposalError, TaskProposalService } from "../task-proposals"
import type { McpCallerIdentity, McpControlResponse } from "./types"

const id = z.string().trim().min(1).max(200)
const expectedVersion = z.number().int().positive()

const schemas = {
  propose_task: z
    .object({
      idempotencyKey: z.string().trim().min(1).max(128),
      proposal: taskProposalContentSchema,
    })
    .strict(),
  list_task_proposals: z
    .object({
      projectId: z.string().trim().min(1).max(128).optional(),
      includeArchived: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().max(64).optional(),
    })
    .strict(),
  read_task_proposal: z.object({ proposalId: id }).strict(),
  update_task_proposal: z
    .object({ proposalId: id, expectedVersion, proposal: taskProposalContentSchema })
    .strict(),
  cancel_task_proposal: z.object({ proposalId: id, expectedVersion }).strict(),
} as const

export const mcpTaskProposalToolNames = new Set(Object.keys(schemas))

export const mcpTaskProposalInputShapes: Record<string, z.ZodRawShape> = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, schema.shape]),
)

export type McpTaskProposalService = {
  invoke(name: string, caller: McpCallerIdentity, input: unknown): Promise<McpControlResponse>
}

export function createMcpTaskProposalService(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpTaskProposalService {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP task proposals.")
  const service = new TaskProposalService(databasePath)
  return {
    async invoke(name, caller, rawInput) {
      const inputSchema = schemas[name as keyof typeof schemas]
      if (!inputSchema) return error("invalid-input", "Unsupported task proposal operation.")
      const parsed = inputSchema.safeParse(rawInput)
      if (!parsed.success) {
        return error("invalid-input", parsed.error.issues[0]?.message ?? "Invalid input.")
      }
      const actor = { type: "agent" as const, chatId: caller.chatId, runId: caller.runId }
      try {
        switch (name) {
          case "propose_task": {
            const input = parsed.data as z.infer<typeof schemas.propose_task>
            return { ok: true, data: service.propose(actor, input) }
          }
          case "list_task_proposals": {
            const input = parsed.data as z.infer<typeof schemas.list_task_proposals>
            return { ok: true, data: service.list(actor, input) }
          }
          case "read_task_proposal": {
            const input = parsed.data as z.infer<typeof schemas.read_task_proposal>
            return { ok: true, data: service.read(actor, input.proposalId) }
          }
          case "update_task_proposal": {
            const input = parsed.data as z.infer<typeof schemas.update_task_proposal>
            return { ok: true, data: service.update(actor, input) }
          }
          case "cancel_task_proposal": {
            const input = parsed.data as z.infer<typeof schemas.cancel_task_proposal>
            return { ok: true, data: service.cancel(actor, input) }
          }
          default:
            return error("invalid-input", "Unsupported task proposal operation.")
        }
      } catch (cause) {
        if (cause instanceof TaskProposalError) return error(cause.code, cause.message)
        return error("internal-error", "Task proposal operation failed.")
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
    | "stale-caller"
    | "stale-target"
    | "internal-error",
  message: string,
): McpControlResponse {
  return { ok: false, error: { code, message } }
}
