import { z } from "zod"
import {
  patchProjectRecordSchema,
  projectRecordPathSchema,
} from "../../../../shared/project-records"
import { configuredProjectRecordsClient } from "../../project-records/client"
import { publicProcedure, router } from "../index"

export const projectRecordsRouter = router({
  list: publicProcedure.query(async () => (await configuredProjectRecordsClient()).list()),
  read: publicProcedure
    .input(z.object({ path: projectRecordPathSchema }))
    .query(async ({ input }) => (await configuredProjectRecordsClient()).read(input.path)),
  patch: publicProcedure
    .input(patchProjectRecordSchema)
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).patch(input)),
})
