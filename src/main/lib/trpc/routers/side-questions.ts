import { z } from "zod"
import { askSideQuestionSchema } from "../../../../shared/side-questions"
import { getSideQuestionService as service } from "../../side-questions"
import { publicProcedure, router } from "../index"

const source = z.object({ subChatId: z.string().min(1).max(200) }).strict()
const target = source.extend({ id: z.string().uuid() }).strict()
export const sideQuestionsRouter = router({
  list: publicProcedure.input(source).query(({ input }) => service().list(input.subChatId)),
  ask: publicProcedure.input(askSideQuestionSchema).mutation(({ input }) => service().ask(input)),
  cancel: publicProcedure
    .input(target)
    .mutation(({ input }) => service().cancel(input.subChatId, input.id)),
  retry: publicProcedure
    .input(target)
    .mutation(({ input }) => service().retry(input.subChatId, input.id)),
  promote: publicProcedure
    .input(target)
    .mutation(({ input }) => service().promote(input.subChatId, input.id)),
})
