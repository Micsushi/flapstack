import { z } from "zod"
import { createDevRuntimeActivityFixtureService } from "../../agent-runtime/dev-activity-fixtures"
import { getRuntimeActivityFixtureSettings } from "../../agent-runtime/activity-fixture-settings"
import { isRuntimeActivityFixtureAvailable } from "../../agent-runtime/activity-fixture-settings"
import {
  broadcastAgentActivityInvalidation,
  getAgentActivityStore,
} from "../../agent-runtime/activity-service"
import { getDatabase } from "../../db"
import { publicProcedure, router } from "../index"
import { app } from "electron"
import { IS_DEV } from "../../../constants"

const fixtureScopeSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    chatId: z.string().trim().min(1).max(128),
    subChatId: z.string().trim().min(1).max(128),
  })
  .strict()

function fixtureService() {
  return createDevRuntimeActivityFixtureService(getDatabase(), getAgentActivityStore(), {
    enabled:
      isRuntimeActivityFixtureAvailable(app.isPackaged, IS_DEV) &&
      getRuntimeActivityFixtureSettings().enabled,
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
