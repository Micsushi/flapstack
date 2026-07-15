import { z } from "zod"
import { orchestrationAgentDefinitionSchema } from "./agent-orchestration"

const id = z.string().trim().min(1).max(200)
const boundedText = z.string().trim().min(1).max(10_000)

export const orchestrationPolicySchema = z
  .object({
    maxParallelAgents: z.number().int().min(1).max(64),
    maxDepth: z.number().int().min(1).max(32),
    maxTotalAgents: z.number().int().min(1).max(256),
    maxTotalTokens: z.number().int().positive().max(1_000_000_000).nullable(),
    maxCostUsdMicros: z.number().int().positive().max(1_000_000_000_000).nullable(),
    allowSpawn: z.boolean(),
  })
  .strict()

export const workflowStepSchema = z
  .object({
    id,
    kind: z.enum([
      "agent",
      "parallel",
      "pipeline",
      "barrier",
      "branch",
      "loop",
      "human-gate",
      "synthesis",
    ]),
    agentDefinitionId: id.nullable().default(null),
    dependsOn: z.array(id).max(256).default([]),
    childStepIds: z.array(id).max(256).default([]),
    condition: z
      .object({
        stepId: id,
        path: z.array(z.string().trim().min(1).max(200)).max(16).default([]),
        equals: z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]),
      })
      .strict()
      .nullable()
      .default(null),
    thenStepIds: z.array(id).max(256).default([]),
    elseStepIds: z.array(id).max(256).default([]),
    bodyStepIds: z.array(id).max(256).default([]),
    maxIterations: z.number().int().min(1).max(100).default(1),
    timeoutMs: z.number().int().min(1).max(86_400_000).nullable().default(null),
    maxRetries: z.number().int().min(0).max(10).default(0),
    outputSchema: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .strict()

export const orchestrationTemplateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.enum(["workflow", "codex-v2", "codex-v1"]),
    agents: z.array(orchestrationAgentDefinitionSchema).min(1).max(256),
    policy: orchestrationPolicySchema,
    workflow: z
      .object({
        schemaVersion: z.literal(1),
        steps: z.array(workflowStepSchema).min(1).max(512),
      })
      .strict(),
    presentationStyle: z
      .object({ tone: z.string().trim().max(160), formatting: z.string().trim().max(500) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((definition, context) => {
    const definitionIds = new Set<string>()
    for (const [index, agent] of definition.agents.entries()) {
      if (!agent.definitionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", index, "definitionId"],
          message: "Workflow template agents require a stable definitionId.",
        })
        continue
      }
      if (definitionIds.has(agent.definitionId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", index, "definitionId"],
          message: "Workflow template agent definitionId values must be unique.",
        })
      definitionIds.add(agent.definitionId)
    }
    for (const [index, step] of definition.workflow.steps.entries()) {
      const worker = step.kind === "agent" || step.kind === "synthesis"
      if (worker && !step.agentDefinitionId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "steps", index, "agentDefinitionId"],
          message: "Worker steps require an exact agentDefinitionId.",
        })
      if (worker && step.agentDefinitionId && !definitionIds.has(step.agentDefinitionId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "steps", index, "agentDefinitionId"],
          message: "Worker step agentDefinitionId must reference a defined template agent.",
        })
      if (!worker && step.agentDefinitionId !== null)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "steps", index, "agentDefinitionId"],
          message: "Non-worker steps cannot carry an agentDefinitionId.",
        })
    }
  })

export const orchestrationPolicyUpdateSchema = z
  .object({
    taskId: id,
    expectedVersion: z.number().int().positive(),
    policy: orchestrationPolicySchema,
  })
  .strict()

export const orchestrationTemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    definition: orchestrationTemplateDefinitionSchema,
  })
  .strict()

export const orchestrationTemplateUpdateSchema = z
  .object({
    id,
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(256),
    definition: orchestrationTemplateDefinitionSchema,
  })
  .strict()

export const orchestrationTemplateArchiveSchema = z
  .object({ id, expectedVersion: z.number().int().positive() })
  .strict()

export const orchestrationMessageSchema = z
  .object({
    id,
    taskId: id,
    agentId: id.nullable(),
    direction: z.enum(["inbound", "outbound"]),
    kind: z.enum(["message", "follow-up", "interrupt", "mailbox"]),
    state: z.enum(["recorded", "queued", "delivered", "failed", "uncertain"]),
    body: boundedText.nullable(),
    providerMessageId: z.string().trim().min(1).max(512).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

export type OrchestrationPolicy = z.infer<typeof orchestrationPolicySchema>
export type OrchestrationTemplateDefinition = z.infer<typeof orchestrationTemplateDefinitionSchema>
export type OrchestrationMessage = z.infer<typeof orchestrationMessageSchema>
export type PolicyChangeKind = "initial" | "tighten" | "relax" | "mixed" | "unchanged"
