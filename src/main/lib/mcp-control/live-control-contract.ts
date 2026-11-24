import { z } from "zod"
import { agentInputResponseSchema } from "../../../shared/agent-input"
import { desktopProjectToolNames } from "./project-control-contract"
import { desktopWorkflowToolNames } from "./workflow-contract"
import type { McpControlTool } from "./types"

const id = z.string().trim().min(1).max(256)
export const liveControlSchemas = {
  stop_run: z.object({ runId: id }).strict(),
  steer_run: z
    .object({
      runId: id,
      message: z.string().trim().min(1).max(12000),
      delivery: z.enum(["steer", "queue"]).default("steer"),
      idempotencyKey: id.optional(),
    })
    .strict(),
  retry_run: z.object({ runId: id, idempotencyKey: id }).strict(),
  list_pending_approvals: z
    .object({ runId: id.optional(), limit: z.number().int().min(1).max(100).default(50) })
    .strict(),
  respond_to_approval: z
    .object({
      kind: z.enum(["app", "permission", "codex", "opencode"]),
      requestId: id,
      decision: z.enum(["approve", "deny"]),
    })
    .strict(),
  answer_agent_question: z
    .object({ requestId: id, answers: agentInputResponseSchema.shape.answers })
    .strict(),
}
export const liveControlTools: McpControlTool[] = [
  {
    name: "stop_run",
    description: "Cancel an active run.",
    tier: 2,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "steer_run",
    description:
      "Steer an active turn, or queue a subsequent turn with delivery=queue and an idempotencyKey.",
    tier: 3,
    requiredCapabilities: ["subagents", "shell"],
    status: "implemented",
  },
  {
    name: "retry_run",
    description: "Queue a failed or cancelled turn again using its original prompt.",
    tier: 3,
    requiredCapabilities: ["subagents", "shell"],
    status: "implemented",
  },
  {
    name: "list_pending_approvals",
    description: "List pending tool approvals and questions in caller-visible conversations.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "respond_to_approval",
    description: "Resolve one pending approval as a full-access external owner.",
    tier: 3,
    requiredCapabilities: ["productMcpTier3"],
    status: "implemented",
  },
  {
    name: "answer_agent_question",
    description: "Answer a pending structured question in a visible conversation.",
    tier: 3,
    requiredCapabilities: ["subagents"],
    status: "implemented",
  },
]
export const liveControlInputShapes = Object.fromEntries(
  Object.entries(liveControlSchemas).map(([name, schema]) => [name, schema.shape]),
)

export function needsDesktopMcp(name: string): boolean {
  return (
    Object.hasOwn(liveControlSchemas, name) ||
    desktopProjectToolNames.has(name) ||
    desktopWorkflowToolNames.has(name) ||
    ["create_project", "move_chat", "list_models", "list_providers"].includes(name)
  )
}
