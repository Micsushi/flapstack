import { observable } from "@trpc/server/observable"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import type { PlanSourceRefreshEvent } from "../../../../shared/plan-sources"
import { getDatabase, planSourceRegistrations, projects } from "../../db"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import {
  PlanSourceRefreshWatcher,
  readProjectPlanSources,
  validateMarkdownPlanSource,
  type ProjectPlanSourceConfig,
} from "../../plan-sources"
import { publicProcedure, router } from "../index"

const sourcePathSchema = z.string().trim().min(1).max(4096)

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

export const planSourcesRouter = router({
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
      return getDatabase()
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
    }),

  unregisterMarkdown: publicProcedure
    .input(z.object({ projectId: z.string().min(1), relativePath: sourcePathSchema }))
    .mutation(({ input }) => {
      getProjectPlanSourceConfig(input.projectId)
      return getDatabase()
        .delete(planSourceRegistrations)
        .where(
          and(
            eq(planSourceRegistrations.projectId, input.projectId),
            eq(planSourceRegistrations.relativePath, input.relativePath),
          ),
        )
        .returning()
        .get()
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

  watch: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<PlanSourceRefreshEvent>((emit) => {
        const watcher = new PlanSourceRefreshWatcher({
          loadConfig: () => getProjectPlanSourceConfig(input.projectId),
          onRefresh: (event) => emit.next(event),
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
