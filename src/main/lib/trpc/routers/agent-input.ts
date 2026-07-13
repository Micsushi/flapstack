import { z } from "zod"
import { agentInputLifecycle } from "../../agent-input/service"
import { agentInputResponseSchema } from "../../../../shared/agent-input"
import { publicProcedure, router } from "../index"

export const agentInputRouter = router({
  list: publicProcedure
    .input(z.object({ chatId: z.string().optional() }).optional())
    .query(({ input }) => agentInputLifecycle.list(input?.chatId)),

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
