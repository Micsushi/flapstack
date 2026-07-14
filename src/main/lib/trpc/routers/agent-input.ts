import { z } from "zod"
import { eq } from "drizzle-orm"
import { agentInputLifecycle } from "../../agent-input/service"
import { getDatabase, subChats } from "../../db"
import { agentInputResponseSchema } from "../../../../shared/agent-input"
import { publicProcedure, router } from "../index"

export const agentInputRouter = router({
  list: publicProcedure
    .input(z.object({ chatId: z.string().optional() }).optional())
    .query(({ input }) => agentInputLifecycle.list(input?.chatId)),

  listWithContext: publicProcedure.query(() => {
    const db = getDatabase()
    return agentInputLifecycle.list().map((request) => ({
      request,
      parentChatId:
        db
          .select({ chatId: subChats.chatId })
          .from(subChats)
          .where(eq(subChats.id, request.chatId))
          .get()?.chatId ?? null,
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
