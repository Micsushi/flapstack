import { z } from "zod"
import { inArray } from "drizzle-orm"
import { agentInputLifecycle } from "../../agent-input/service"
import { getDatabase, subChats } from "../../db"
import { agentInputResponseSchema } from "../../../../shared/agent-input"
import { publicProcedure, router } from "../index"

export const agentInputRouter = router({
  list: publicProcedure
    .input(z.object({ chatId: z.string().optional() }).optional())
    .query(({ input }) => agentInputLifecycle.list(input?.chatId)),

  listWithContext: publicProcedure.query(() => {
    const requests = agentInputLifecycle.list()
    if (requests.length === 0) return []

    // This runs on a 1s poll, so resolve every parent chat in one query instead
    // of one SELECT per pending request.
    const subChatIds = Array.from(new Set(requests.map((request) => request.chatId)))
    const db = getDatabase()
    const parentChatIds = new Map<string, string>()
    for (const row of db
      .select({ id: subChats.id, chatId: subChats.chatId })
      .from(subChats)
      .where(inArray(subChats.id, subChatIds))
      .all()) {
      parentChatIds.set(row.id, row.chatId)
    }

    return requests.map((request) => ({
      request,
      parentChatId: parentChatIds.get(request.chatId) ?? null,
    }))
  }),

  respond: publicProcedure.input(agentInputResponseSchema).mutation(({ input }) => ({
    ok: agentInputLifecycle.answer(input),
  })),

  skip: publicProcedure
    .input(z.object({ requestId: z.string(), message: z.string().optional() }))
    .mutation(({ input }) => ({
      ok: agentInputLifecycle.skip(input.requestId, input.message),
    })),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string(), message: z.string().optional() }))
    .mutation(({ input }) => ({
      ok: agentInputLifecycle.cancel(input.requestId, input.message),
    })),
})
