import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { basename } from "node:path"
import {
  createDiscussionSchema,
  captureMixedSchema,
  discussionListSchema,
  discussionScopeSchema,
  restoreDiscussionSchema,
  restoreMixedSchema,
  updateDiscussionSchema,
} from "../../../../shared/discussions"
import { getSqliteDatabase } from "../../db"
import { DiscussionError, DiscussionService } from "../../discussions/service"
import { generateDiscussionResult } from "../../discussions/assistant"
import { captureMixed, refreshDiscussionSummary } from "../../discussions/mixed-capture"
import { discussionReplySchema, discussionSummarySchema } from "../../discussions/assistant-policy"
import { configuredProjectRecordsClient } from "../../project-records/client"
import { betaProcedure, router } from "../index"

const procedure = betaProcedure("planning")
const service = () => new DiscussionService(getSqliteDatabase())
function handle<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof DiscussionError)
      throw new TRPCError({ code: error.code, message: error.message })
    throw error
  }
}
async function handleAsync<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof DiscussionError)
      throw new TRPCError({ code: error.code, message: error.message })
    throw error
  }
}
export const discussionsRouter = router({
  captureMixed: procedure
    .input(captureMixedSchema)
    .mutation(({ input }) => handleAsync(() => captureMixed(service(), input))),
  restoreMixed: procedure
    .input(restoreMixedSchema)
    .mutation(({ input }) => handle(() => service().restoreMixed(input))),
  assist: procedure
    .input(
      z
        .object({
          scope: discussionScopeSchema,
          id: z.string().min(1).max(200),
          expectedRevision: z.number().int().positive(),
          annotationId: z.string().min(1).max(200).optional(),
          question: z.string().trim().min(1).max(16_384).optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const currentService = service()
      const topic = handle(() => currentService.read(input.scope, input.id))
      if (topic.revision !== input.expectedRevision)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Discussion changed. Refresh before asking.",
        })
      if (input.annotationId) {
        const annotation = topic.annotations.find((item) => item.id === input.annotationId)
        if (!annotation || !input.question)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Select an annotation and enter a question.",
          })
        const generated = await generateDiscussionResult({
          kind: "reply",
          schema: discussionReplySchema,
          source: {
            source: annotation.source,
            note: annotation.body,
            followups: annotation.followups.slice(-6),
            question: input.question,
          },
        })
        const updated = handle(() =>
          getSqliteDatabase().transaction(() => {
            const withQuestion = currentService.update({
              scope: input.scope,
              id: input.id,
              expectedRevision: input.expectedRevision,
              change: {
                type: "followup",
                annotationId: annotation.id,
                body: input.question!,
                role: "user",
              },
            })
            return currentService.update({
              scope: input.scope,
              id: input.id,
              expectedRevision: withQuestion.revision,
              change: {
                type: "followup",
                annotationId: annotation.id,
                body: generated.result.reply,
                role: "assistant",
                model: generated.model,
              },
            })
          })(),
        )
        return { topic: updated, model: generated.model }
      }
      const generated = await generateDiscussionResult({
        kind: "summary",
        schema: discussionSummarySchema,
        source: {
          title: topic.title,
          previousSummary: topic.summary,
          recentCaptures: topic.captures.slice(-8),
          questions: topic.questions.map((question) => ({
            prompt: question.prompt,
            answer: question.answers.at(-1),
          })),
        },
      })
      const updated = handle(() =>
        currentService.update({
          scope: input.scope,
          id: input.id,
          expectedRevision: input.expectedRevision,
          change: { type: "summary", summary: generated.result.summary },
        }),
      )
      return { topic: updated, model: generated.model }
    }),
  metadata: procedure.query(() => service().metadata()),
  list: procedure
    .input(discussionListSchema)
    .query(({ input }) => handle(() => service().list(input))),
  read: procedure
    .input(z.object({ scope: discussionScopeSchema, id: z.string().min(1).max(200) }).strict())
    .query(({ input }) => handle(() => service().read(input.scope, input.id))),
  sources: procedure
    .input(
      z
        .object({
          scope: discussionScopeSchema,
          subChatId: z.string().min(1).max(200),
          messageId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .query(({ input }) =>
      handle(() => service().sources(input.scope, input.subChatId, input.messageId)),
    ),
  create: procedure.input(createDiscussionSchema).mutation(async ({ input }) => {
    const currentService = service()
    const saved = handle(() => currentService.create(input))
    return (await refreshDiscussionSummary(currentService, saved)).topic
  }),
  update: procedure.input(updateDiscussionSchema).mutation(async ({ input }) => {
    if (input.change.type === "followup" && input.change.role !== "user") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Assistant replies must come from a model response",
      })
    }
    if (input.change.type === "link") {
      handle(() => service().read(input.scope, input.id))
      const project = getSqliteDatabase()
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.scope.projectId) as { path: string }
      const slug = basename(project.path).toLocaleLowerCase()
      const client = await configuredProjectRecordsClient()
      const index = await client.list()
      const entry = index.documents.find((item) => item.path === `projects/${slug}/features.md`)
      const recordId = input.change.canonicalRecordId
      const found =
        entry &&
        (await client.read(entry.path)).document.records.some((record) => record.id === recordId)
      if (!found)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Canonical project record was not found. Refresh the records before linking.",
        })
    }
    const currentService = service()
    const saved = handle(() => currentService.update(input))
    return input.change.type === "capture"
      ? (await refreshDiscussionSummary(currentService, saved)).topic
      : saved
  }),
  restore: procedure
    .input(restoreDiscussionSchema)
    .mutation(({ input }) => handle(() => service().restore(input))),
})
