import { TRPCError } from "@trpc/server"
import { observable } from "@trpc/server/observable"
import { and, eq } from "drizzle-orm"
import { app } from "electron"
import { z } from "zod"
import type { PlanSourceRefreshEvent } from "../../../../shared/plan-sources"
import {
  planTaskPromotionConfirmInputSchema,
  planTaskPromotionPreviewInputSchema,
} from "../../../../shared/plan-task-promotion"
import { getDatabase, getDatabasePath, planSourceRegistrations, projects } from "../../db"
import { IS_DEV } from "../../../constants"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import {
  PlanSourceRefreshWatcher,
  readProjectPlanSources,
  validateMarkdownPlanSource,
  type ProjectPlanSourceConfig,
} from "../../plan-sources"
import {
  buildPlanTaskPromotionPreview,
  PlanTaskPromotionError,
  promotePlanCandidate,
} from "../../plan-task-promotion"
import { listPlanSourceLinks } from "../../plan-kanban-consistency"
import {
  advancePlanKanbanDevFixture,
  createPlanKanbanDevFixture,
  getPlanKanbanDevFixtureStatus,
  resetPlanKanbanDevFixture,
} from "../../plan-kanban-dev-fixtures"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"
import { publicProcedure, router } from "../index"

const sourcePathSchema = z.string().trim().min(1).max(4096)
const devFixtureInput = z.object({ projectId: z.string().trim().min(1).max(128) })

function assertDevFixtureEnabled(): void {
  if (!IS_DEV || app.isPackaged) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Dev Plan fixtures are unavailable." })
  }
}

async function devFixtureOperation<T>(
  projectId: string,
  operation: (databasePath: string, config: ProjectPlanSourceConfig) => Promise<T>,
): Promise<T> {
  assertDevFixtureEnabled()
  try {
    return await operation(getDatabasePath(), getProjectPlanSourceConfig(projectId))
  } catch (error) {
    if (error instanceof TRPCError) throw error
    throw new TRPCError({
      code: "CONFLICT",
      message: error instanceof Error ? error.message : "Dev Plan fixture operation failed.",
    })
  }
}

export function getProjectPlanSourceConfig(projectId: string): ProjectPlanSourceConfig {
  const db = getDatabase()
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project) throw new Error("Project not found")
  const root = assertRegisteredWorktree(project.path)
  const registrations = db
    .select({ relativePath: planSourceRegistrations.relativePath })
    .from(planSourceRegistrations)
    .where(eq(planSourceRegistrations.projectId, projectId))
    .all()
  return {
    projectId,
    rootPath: root.canonicalPath,
    markdownPaths: registrations.map((registration) => registration.relativePath),
  }
}

function promotionError(error: unknown): never {
  if (!(error instanceof PlanTaskPromotionError)) throw error
  throw new TRPCError({
    code:
      error.code === "not-found"
        ? "NOT_FOUND"
        : error.code === "invalid-candidate"
          ? "BAD_REQUEST"
          : "CONFLICT",
    message: error.message,
  })
}

async function readPromotionSnapshot(reference: {
  sourceProjectId: string
  sourceId: string
  sourceFingerprint: string
}) {
  return readProjectPlanSources(getProjectPlanSourceConfig(reference.sourceProjectId), {
    expectedFingerprints: { [reference.sourceId]: reference.sourceFingerprint },
  })
}

export const planSourcesRouter = router({
  devFixtureStatus: publicProcedure
    .input(devFixtureInput)
    .query(({ input }) => devFixtureOperation(input.projectId, getPlanKanbanDevFixtureStatus)),

  devFixtureCreate: publicProcedure.input(devFixtureInput).mutation(async ({ input }) => {
    const status = await devFixtureOperation(input.projectId, createPlanKanbanDevFixture)
    publishLocalProductInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["plan-sources", "task-proposals", "chats"],
      projectIds: [input.projectId],
    })
    return status
  }),

  devFixtureAdvance: publicProcedure.input(devFixtureInput).mutation(async ({ input }) => {
    const status = await devFixtureOperation(input.projectId, advancePlanKanbanDevFixture)
    publishLocalProductInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["plan-sources"],
      projectIds: [input.projectId],
    })
    return status
  }),

  devFixtureReset: publicProcedure.input(devFixtureInput).mutation(async ({ input }) => {
    const status = await devFixtureOperation(input.projectId, resetPlanKanbanDevFixture)
    publishLocalProductInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["plan-sources", "task-proposals", "tasks", "chats"],
      projectIds: [input.projectId],
    })
    return status
  }),

  listRegistrations: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ input }) => {
      getProjectPlanSourceConfig(input.projectId)
      return getDatabase()
        .select()
        .from(planSourceRegistrations)
        .where(eq(planSourceRegistrations.projectId, input.projectId))
        .all()
    }),

  registerMarkdown: publicProcedure
    .input(z.object({ projectId: z.string().min(1), relativePath: sourcePathSchema }))
    .mutation(async ({ input }) => {
      const config = getProjectPlanSourceConfig(input.projectId)
      const relativePath = await validateMarkdownPlanSource(config.rootPath, input.relativePath)
      const registration = getDatabase()
        .insert(planSourceRegistrations)
        .values({
          projectId: input.projectId,
          sourceType: "markdown",
          relativePath,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [planSourceRegistrations.projectId, planSourceRegistrations.relativePath],
          set: { updatedAt: new Date() },
        })
        .returning()
        .get()
      publishLocalProductInvalidation({
        version: 1,
        source: "product-mcp",
        domains: ["plan-sources"],
        projectIds: [input.projectId],
      })
      return registration
    }),

  unregisterMarkdown: publicProcedure
    .input(z.object({ projectId: z.string().min(1), relativePath: sourcePathSchema }))
    .mutation(({ input }) => {
      getProjectPlanSourceConfig(input.projectId)
      const registration = getDatabase()
        .delete(planSourceRegistrations)
        .where(
          and(
            eq(planSourceRegistrations.projectId, input.projectId),
            eq(planSourceRegistrations.relativePath, input.relativePath),
          ),
        )
        .returning()
        .get()
      if (registration) {
        publishLocalProductInvalidation({
          version: 1,
          source: "product-mcp",
          domains: ["plan-sources"],
          projectIds: [input.projectId],
        })
      }
      return registration
    }),

  refresh: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        expectedFingerprints: z.record(z.string()).optional(),
      }),
    )
    .query(({ input }) =>
      readProjectPlanSources(getProjectPlanSourceConfig(input.projectId), {
        expectedFingerprints: input.expectedFingerprints,
      }),
    ),

  sourceLinks: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const snapshot = await readProjectPlanSources(getProjectPlanSourceConfig(input.projectId))
      return listPlanSourceLinks(getDatabase(), snapshot)
    }),

  previewPromotion: publicProcedure
    .input(planTaskPromotionPreviewInputSchema)
    .query(async ({ input }) => {
      try {
        const snapshot = await readPromotionSnapshot(input.reference)
        return buildPlanTaskPromotionPreview(getDatabase(), snapshot, input)
      } catch (error) {
        promotionError(error)
      }
    }),

  promoteCandidate: publicProcedure
    .input(planTaskPromotionConfirmInputSchema)
    .mutation(async ({ input }) => {
      try {
        const snapshot = await readPromotionSnapshot(input.reference)
        const result = promotePlanCandidate(getDatabase(), snapshot, input)
        if (result.created) {
          publishLocalProductInvalidation({
            version: 1,
            source: "product-mcp",
            domains: ["tasks", "chats", "plan-sources"],
            projectIds: [...new Set([input.reference.sourceProjectId, input.targetProjectId])],
            taskIds: [result.task.id],
            chatIds: [result.chat.id],
          })
        }
        return result
      } catch (error) {
        promotionError(error)
      }
    }),

  watch: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<PlanSourceRefreshEvent>((emit) => {
        const watcher = new PlanSourceRefreshWatcher({
          loadConfig: () => getProjectPlanSourceConfig(input.projectId),
          onRefresh: (event) => {
            emit.next(event)
            publishLocalProductInvalidation({
              version: 1,
              source: "product-mcp",
              domains: ["plan-sources"],
              projectIds: [event.projectId],
            })
          },
          onError: (error) => emit.error(error),
        })
        void watcher.start().catch((error) => {
          emit.error(error instanceof Error ? error : new Error(String(error)))
        })
        return () => {
          void watcher.close()
        }
      }),
    ),
})
