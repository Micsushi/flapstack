import {
  runtimeDefaultDeleteInputSchema,
  runtimeDefaultListInputSchema,
  runtimeDefaultWriteInputSchema,
} from "../../../../shared/agent-runtime"
import { createRuntimeDefaultsService } from "../../agent-runtime/defaults"
import { getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

export const agentRuntimeDefaultsRouter = router({
  list: publicProcedure
    .input(runtimeDefaultListInputSchema.optional())
    .query(({ input }) => createRuntimeDefaultsService(getDatabase()).list(input ?? {})),
  write: publicProcedure
    .input(runtimeDefaultWriteInputSchema)
    .mutation(({ input }) => createRuntimeDefaultsService(getDatabase()).write(input)),
  delete: publicProcedure
    .input(runtimeDefaultDeleteInputSchema)
    .mutation(({ input }) => createRuntimeDefaultsService(getDatabase()).delete(input)),
})
