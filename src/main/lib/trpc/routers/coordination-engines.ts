import {
  coordinationEngineDefaultDeleteSchema,
  coordinationEngineDefaultListSchema,
  coordinationEngineDefaultWriteSchema,
  coordinationEnginePreviewSchema,
} from "../../../../shared/coordination-engine"
import {
  CoordinationEngineDefaultsService,
  createDefaultCoordinationEngineProbes,
  previewCoordinationEngineForProject,
} from "../../agent-orchestration/coordination-engine"
import { getDatabase } from "../../db"
import { getRegisteredCoordinationEngineProbes } from "../../agent-orchestration/operations-runtime"
import { publicProcedure, router } from "../index"

const defaults = () => new CoordinationEngineDefaultsService(getDatabase())

export const coordinationEnginesRouter = router({
  listDefaults: publicProcedure
    .input(coordinationEngineDefaultListSchema)
    .query(({ input }) => defaults().list(input)),
  writeDefault: publicProcedure
    .input(coordinationEngineDefaultWriteSchema)
    .mutation(({ input }) => defaults().write(input)),
  deleteDefault: publicProcedure
    .input(coordinationEngineDefaultDeleteSchema)
    .mutation(({ input }) => defaults().delete(input)),
  capabilities: publicProcedure.query(async () => ({
    ...createDefaultCoordinationEngineProbes(),
    ...(await getRegisteredCoordinationEngineProbes()),
  })),
  preview: publicProcedure.input(coordinationEnginePreviewSchema).query(async ({ input }) =>
    previewCoordinationEngineForProject(getDatabase(), {
      projectId: input.projectId,
      perLaunchEngine: input.perLaunchEngine,
      probes: await getRegisteredCoordinationEngineProbes(),
    }),
  ),
})
