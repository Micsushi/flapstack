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
    .mutation(({ input }) => service().create(input)),

  addAgent: publicProcedure
    .input(addOrchestrationAgentInputSchema)
    .mutation(({ input }) => service().addAgent(input)),

  getTaskOverview: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getOverview(input.taskId)),

  getLineage: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => service().getLineage(input.taskId)),

  control: publicProcedure
    .input(z.object({ taskId: z.string(), action: orchestrationControlActionSchema }))
    .mutation(({ input }) => service().control(input.taskId, input.action)),

  retryAgent: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .mutation(({ input }) => service().retryAgent(input.taskId, input.agentId)),

  replaceAgent: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        agentId: z.string(),
        agent: orchestrationAgentDefinitionSchema,
      }),
    )
    .mutation(({ input }) => service().replaceAgent(input.taskId, input.agentId, input.agent)),

  reportAgentProgress: publicProcedure
    .input(orchestrationUsageUpdateSchema)
    .mutation(({ input }) => service().reportProgress(input)),
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
