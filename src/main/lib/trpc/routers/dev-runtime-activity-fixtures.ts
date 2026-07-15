import { app } from "electron"
import { z } from "zod"
import { IS_DEV } from "../../../constants"
import {
  createDevRuntimeActivityFixtureService,
  isDevRuntimeActivityFixtureEnabled,
} from "../../agent-runtime/dev-activity-fixtures"
import {
  broadcastAgentActivityInvalidation,
  getAgentActivityStore,
} from "../../agent-runtime/activity-service"
import { getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

const fixtureScopeSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    chatId: z.string().trim().min(1).max(128),
    subChatId: z.string().trim().min(1).max(128),
  })
  .strict()

function fixtureService() {
  return createDevRuntimeActivityFixtureService(getDatabase(), getAgentActivityStore(), {
    enabled: isDevRuntimeActivityFixtureEnabled(
      app.isPackaged,
      IS_DEV ? process.env.ELECTRON_RENDERER_URL : undefined,
    ),
    onInvalidated: broadcastAgentActivityInvalidation,
  })
}

export const devRuntimeActivityFixturesRouter = router({
  status: publicProcedure.input(fixtureScopeSchema).query(({ input }) => {
    return fixtureService().status(input)
  }),
  seed: publicProcedure.input(fixtureScopeSchema).mutation(({ input }) => {
    return fixtureService().seed(input)
  }),
  reset: publicProcedure.input(fixtureScopeSchema).mutation(({ input }) => {
    return fixtureService().reset(input)
  }),
})
