import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import {
  addOrchestrationAgentInputSchema,
  createOrchestrationInputSchema,
  orchestrationAgentDefinitionSchema,
  orchestrationControlActionSchema,
  orchestrationUsageUpdateSchema,
} from "../../../../shared/agent-orchestration"
import { chats, getDatabase, getDatabasePath } from "../../db"
import { createAgentOrchestrationService } from "../../agent-orchestration/service"
import { publicProcedure, router } from "../index"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"
import type {
  OrchestrationAgentDto,
  OrchestrationTaskOverviewDto,
} from "../../../../shared/agent-orchestration"

const service = () => createAgentOrchestrationService(getDatabasePath())

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

  createOrchestration: publicProcedure
    .input(createOrchestrationInputSchema)
    .mutation(({ input }) => publishOrchestration(service().create(input))),

  addAgent: publicProcedure
    .input(addOrchestrationAgentInputSchema)
    .mutation(({ input }) => publishAgent(input.taskId, service().addAgent(input))),

  getTaskOverview: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getOverview(input.taskId)),

  getLineage: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getLineage(input.taskId)),

  control: publicProcedure
    .input(z.object({ taskId: z.string(), action: orchestrationControlActionSchema }))
    .mutation(({ input }) => publishOrchestration(service().control(input.taskId, input.action))),

  retryAgent: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .mutation(({ input }) =>
      publishAgent(input.taskId, service().retryAgent(input.taskId, input.agentId)),
    ),

  replaceAgent: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        agentId: z.string(),
        agent: orchestrationAgentDefinitionSchema,
      }),
    )
    .mutation(({ input }) =>
      publishAgent(input.taskId, service().replaceAgent(input.taskId, input.agentId, input.agent)),
    ),

  reportAgentProgress: publicProcedure
    .input(orchestrationUsageUpdateSchema)
    .mutation(({ input }) => publishOrchestration(service().reportProgress(input))),
})

function publishOrchestration(result: OrchestrationTaskOverviewDto): OrchestrationTaskOverviewDto {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["tasks", "chats", "runs", "orchestrations"],
    taskIds: [result.orchestration.taskId],
    chatIds: unique(
      [result.orchestration.initiatingChatId, ...result.agents.map((agent) => agent.chatId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
    runIds: unique(
      result.agents.map((agent) => agent.runId).filter((id): id is string => Boolean(id)),
    ),
  })
  return result
}

function publishAgent(taskId: string, result: OrchestrationAgentDto): OrchestrationAgentDto {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["tasks", "chats", "runs", "orchestrations"],
    taskIds: [taskId],
    ...(result.chatId ? { chatIds: [result.chatId] } : {}),
    ...(result.runId ? { runIds: [result.runId] } : {}),
  })
  return result
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

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
