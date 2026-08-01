import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import {
  addOrchestrationAgentInputSchema,
  createOrchestrationInputSchema,
  directChildProfilePreviewInputSchema,
  orchestrationAgentDefinitionSchema,
  orchestrationControlActionSchema,
  orchestrationFleetQuerySchema,
  orchestrationUsageUpdateSchema,
} from "../../../../shared/agent-orchestration"
import { chats, getDatabase, getDatabasePath } from "../../db"
import { createAgentOrchestrationService } from "../../agent-orchestration/service"
import { AgentProfileWorkflowBindingService } from "../../agent-profiles/workflow-binding"
import {
  getCascadeControl,
  getRegisteredCoordinationEngineProbes,
  getSwarmRuntimeControl,
} from "../../agent-orchestration/operations-runtime"
import { SwarmGroupControlService } from "../../agent-orchestration/swarm-group-control-service"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"
import { betaProcedure, publicProcedure, router } from "../index"

const service = () => createAgentOrchestrationService(getDatabasePath())
const orchestrationProcedure = betaProcedure("orchestration")
const swarmActionSchema = z.enum(["pause", "resume", "cancel", "steer"])
const swarmPreviewSchema = z
  .object({
    action: swarmActionSchema,
    version: z.string().length(64),
    selection: z.array(z.string().trim().min(1).max(200)).max(256),
    capabilityIntersection: z.array(swarmActionSchema),
    permissionIntersection: z.array(z.enum(["control", "steer"])),
    approvalRequired: z.boolean(),
    targets: z
      .array(
        z
          .object({
            agentId: z.string().trim().min(1).max(200),
            runId: z.string().trim().min(1).max(512).nullable(),
            version: z.number().int().nonnegative(),
            supported: z.boolean(),
            reason: z
              .enum([
                "missing-target",
                "missing-run",
                "unsupported-capability",
                "permission-denied",
              ])
              .nullable(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict()

function publishOrchestrationChange(taskId: string, projectId?: string): void {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["orchestrations", "tasks", "chats", "runs"],
    taskIds: [taskId],
    ...(projectId ? { projectIds: [projectId] } : {}),
  })
}

export const spawnedAgentsRouter = router({
  getPolicy: publicProcedure.query(() => ({
    enabled: true,
    spawnTier: 3,
    maxDepth: 32,
    maxChildrenPerRun: 256,
    maxParallelAgents: 64,
    requiresApproval: true,
    durableQueue: true,
  })),

  previewLineage: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
    if (!chat) {
      return {
        chatId: input.chatId,
        parent: null,
        children: [],
        initiatorChatId: null,
        ancestorChatIds: [],
        status: "stale" as const,
      }
    }
    const parent = chat.parentChatId
      ? db.select().from(chats).where(eq(chats.id, chat.parentChatId)).get()
      : null
    const children = db
      .select()
      .from(chats)
      .where(eq(chats.parentChatId, input.chatId))
      .orderBy(asc(chats.createdAt))
      .all()
    const ancestorChatIds = parseAncestorIds(chat.ancestorChatIds)
    return {
      chatId: input.chatId,
      parent: parent ? lineageChat(parent) : null,
      children: children.map(lineageChat),
      initiatorChatId: chat.initiatorChatId ?? chat.id,
      ancestorChatIds: ancestorChatIds ?? [],
      status: ancestorChatIds ? ("ok" as const) : ("stale" as const),
    }
  }),

  createOrchestration: orchestrationProcedure
    .input(createOrchestrationInputSchema)
    .mutation(async ({ input }) => {
      const result = service().create(input, undefined, {
        coordinationEngineProbes: await getRegisteredCoordinationEngineProbes(),
      })
      publishOrchestrationChange(result.orchestration.taskId, result.orchestration.projectId)
      return result
    }),

  addAgent: orchestrationProcedure.input(addOrchestrationAgentInputSchema).mutation(({ input }) => {
    const result = service().addAgent(input)
    publishOrchestrationChange(result.taskId)
    return result
  }),

  previewDirectChildProfile: orchestrationProcedure
    .input(directChildProfilePreviewInputSchema)
    .query(({ input }) =>
      new AgentProfileWorkflowBindingService(getDatabase()).previewDirectChild(input),
    ),

  getFleet: orchestrationProcedure
    .input(orchestrationFleetQuerySchema)
    .query(({ input }) => service().listFleet(input)),

  getTaskOverview: orchestrationProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getOverview(input.taskId)),

  previewSwarmControl: orchestrationProcedure
    .input(
      z
        .object({
          taskId: z.string().trim().min(1).max(200),
          action: swarmActionSchema,
          selectedAgentIds: z.array(z.string().trim().min(1).max(200)).min(1).max(256),
        })
        .strict(),
    )
    .query(({ input }) =>
      new SwarmGroupControlService(getDatabasePath(), getSwarmRuntimeControl()).preview(
        input.taskId,
        input.action,
        input.selectedAgentIds,
      ),
    ),

  executeSwarmControl: orchestrationProcedure
    .input(
      z
        .object({
          taskId: z.string().trim().min(1).max(200),
          expectedPreview: swarmPreviewSchema,
          steerMessage: z.string().max(10_000).default(""),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const result = await new SwarmGroupControlService(
        getDatabasePath(),
        getSwarmRuntimeControl(),
      ).execute(input.taskId, input.expectedPreview, input.steerMessage)
      if (result.status !== "stale-selection") publishOrchestrationChange(input.taskId)
      return result
    }),

  getLineage: orchestrationProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getLineage(input.taskId)),

  control: orchestrationProcedure
    .input(z.object({ taskId: z.string(), action: orchestrationControlActionSchema }))
    .mutation(async ({ input }) => {
      const cascade = getCascadeControl(getDatabasePath())
      const preview = cascade.preview(input.taskId, input.action)
      const request = cascade.request(input.taskId, input.action, preview.fingerprint)
      const reconciliation = await cascade.reconcile(request.intentId)
      if (reconciliation.state !== "completed")
        throw new Error(
          `Orchestration ${input.action} is ${reconciliation.state}; failed Runtime targets remain visible and retryable.`,
        )
      const result = service().getOverview(input.taskId)
      if (!result)
        throw new Error("Orchestration disappeared after Runtime control reconciliation.")
      publishOrchestrationChange(result.orchestration.taskId, result.orchestration.projectId)
      return result
    }),

  retryAgent: orchestrationProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .mutation(({ input }) => {
      const result = service().retryAgent(input.taskId, input.agentId)
      publishOrchestrationChange(result.taskId)
      return result
    }),

  replaceAgent: orchestrationProcedure
    .input(
      z.object({
        taskId: z.string(),
        agentId: z.string(),
        agent: orchestrationAgentDefinitionSchema,
      }),
    )
    .mutation(({ input }) => {
      const result = service().replaceAgent(input.taskId, input.agentId, input.agent)
      publishOrchestrationChange(result.taskId)
      return result
    }),

  reportAgentProgress: orchestrationProcedure
    .input(orchestrationUsageUpdateSchema)
    .mutation(({ input }) => {
      const result = service().reportProgress(input)
      publishOrchestrationChange(result.orchestration.taskId, result.orchestration.projectId)
      return result
    }),
})

function lineageChat(chat: typeof chats.$inferSelect) {
  return {
    id: chat.id,
    name: chat.name,
    harness: chat.harness,
    taskId: chat.taskId,
    archived: chat.archivedAt !== null,
  }
}

function parseAncestorIds(value: string | null): string[] | null {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) &&
      parsed.every((id) => typeof id === "string" && id.length > 0) &&
      new Set(parsed).size === parsed.length
      ? parsed
      : null
  } catch {
    return null
  }
}
