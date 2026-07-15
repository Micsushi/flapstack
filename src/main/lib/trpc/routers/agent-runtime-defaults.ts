import {
  runtimeDefaultDeleteInputSchema,
  runtimeDefaultListInputSchema,
  runtimeDefaultWriteInputSchema,
} from "../../../../shared/agent-runtime"
import { createRuntimeDefaultsService } from "../../agent-runtime/defaults"
import { getRuntimeReleasePolicy } from "../../agent-runtime/release-policy"
import { getRuntimeDiagnostics } from "../../agent-runtime/diagnostics"
import { z } from "zod"
import { getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

export const agentRuntimeDefaultsRouter = router({
  capabilities: publicProcedure.query(() => getRuntimeReleasePolicy()),
  diagnostics: publicProcedure
    .input(z.object({ chatId: z.string().trim().min(1).max(512) }))
    .query(({ input }) => getRuntimeDiagnostics(getDatabase(), input.chatId)),
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
