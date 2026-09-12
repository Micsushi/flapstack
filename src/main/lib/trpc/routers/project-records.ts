import { z } from "zod"
import {
  patchProjectRecordSchema,
  projectRecordPathSchema,
  yapProposalSchema,
} from "../../../../shared/project-records"
import { configuredProjectRecordsClient } from "../../project-records/client"
import { publicProcedure, router } from "../index"

export const projectRecordsRouter = router({
  yapProposals: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).default({}))
    .query(async ({ input }) => {
      const result = await (
        await configuredProjectRecordsClient()
      ).listYapProposals(input.projectId)
      return z.object({ proposals: z.array(yapProposalSchema) }).parse(result)
    }),
  boardRequest: publicProcedure
    .input(
      z
        .object({
          path: z.string().max(2000),
          method: z.enum(["GET", "POST"]),
          body: z
            .string()
            .max(256 * 1024)
            .optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).boardRequest(input)),
  list: publicProcedure.query(async () => (await configuredProjectRecordsClient()).list()),
  discover: publicProcedure
    .input(
      z
        .object({
          recordId: z.string().optional(),
          projectId: z.string().optional(),
          kind: z.string().optional(),
          query: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict()
        .default({}),
    )
    .query(async ({ input }) => (await configuredProjectRecordsClient()).discover(input)),
  search: publicProcedure
    .input(
      z
        .object({
          query: z.string().trim().min(1),
          projectId: z.string().optional(),
          kind: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
    )
    .query(async ({ input }) => (await configuredProjectRecordsClient()).search(input)),
  context: publicProcedure
    .input(
      z
        .object({
          recordId: z.string().min(1),
          path: z.string().optional(),
          projectId: z.string().optional(),
        })
        .strict(),
    )
    .query(async ({ input }) => (await configuredProjectRecordsClient()).context(input)),
  changes: publicProcedure
    .input(
      z
        .object({ since: z.string().optional(), projectId: z.string().optional() })
        .strict()
        .default({}),
    )
    .query(async ({ input }) => (await configuredProjectRecordsClient()).changes(input)),
  workflow: publicProcedure
    .input(
      z
        .record(z.unknown())
        .refine((value) => !("actor" in value), "Actor identity is launcher-provided."),
    )
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).workflow(input)),
  create: publicProcedure
    .input(
      z
        .record(z.unknown())
        .refine((value) => !("actor" in value), "Actor identity is launcher-provided."),
    )
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).createRecord(input)),
  setup: publicProcedure
    .input(
      z
        .record(z.unknown())
        .refine((value) => !("actor" in value), "Actor identity is launcher-provided."),
    )
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).setup(input)),
  read: publicProcedure
    .input(z.object({ path: projectRecordPathSchema }))
    .query(async ({ input }) => (await configuredProjectRecordsClient()).read(input.path)),
  patch: publicProcedure
    .input(patchProjectRecordSchema)
    .mutation(async ({ input }) => (await configuredProjectRecordsClient()).patch(input)),
})
