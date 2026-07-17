import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { join } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import { chats, getDatabase, projects, tasks } from "../../db"
import { createWorktree, getDefaultBranch } from "../../git/worktree"
import { sanitizeProjectName } from "../../git/worktree-naming"
import {
  parseCustomPermissionToggles,
  permissionModes,
  type CustomPermissionToggles,
} from "../../permissions"
import { betaProcedure, publicProcedure, router } from "../index"

const planningProcedure = betaProcedure("planning")
import { TRPCError } from "@trpc/server"
import {
  archiveTaskKanbanCard,
  listTaskKanban,
  moveTaskKanbanCard,
  TaskKanbanError,
} from "../../task-kanban"
import {
  assertTaskStatusTransition,
  taskWorkflowStatusSchema,
  type TaskWorkflowStatus,
} from "../../../../shared/plan-kanban"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"

const permissionModeSchema = z.enum(permissionModes)
const customPermissionsSchema = z.custom<CustomPermissionToggles>(
  (value) => parseCustomPermissionToggles(value) !== null,
  "Expected complete versioned custom permission capabilities",
)

function taskWorktreeSlug(task: { id: string; name: string }): string {
  const nameSlug = sanitizeProjectName(task.name) || "task"
  const idSlug = sanitizeProjectName(task.id).slice(-8) || "task"
  return `${nameSlug}-${idSlug}`
}

function taskBranchName(task: { id: string; name: string }): string {
  return `task/${taskWorktreeSlug(task)}`
}

function publishTaskChange(task: { id: string; projectId: string } | undefined): void {
  if (!task) return
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["tasks", "plan-sources"],
    projectIds: [task.projectId],
    taskIds: [task.id],
  })
}

export async function ensureTaskPrimaryWorktree(taskId: string) {
  const db = getDatabase()
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!task) throw new Error("Task not found")
  if (task.primaryWorktreePath) return task

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get()
  if (!project) throw new Error("Project not found")

  const branch = taskBranchName(task)
  const projectSlug = sanitizeProjectName(project.name)
  const taskSlug = taskWorktreeSlug(task)
  const worktreePath = join(homedir(), ".flapstack", "worktrees", projectSlug, taskSlug)
  const baseBranch = await getDefaultBranch(project.path)

  await createWorktree(project.path, branch, worktreePath, baseBranch)

  return db
    .update(tasks)
    .set({
      primaryWorktreePath: worktreePath,
      primaryBranch: branch,
      version: sql`${tasks.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .returning()
    .get()
}

export const tasksRouter = router({
  board: planningProcedure
    .input(
      z.object({ projectId: z.string().optional(), includeArchived: z.boolean().default(false) }),
    )
    .query(({ input }) => listTaskKanban(getDatabase(), input)),

  moveCard: planningProcedure
    .input(
      z.object({
        id: z.string(),
        expectedVersion: z.number().int().positive(),
        targetStatus: taskWorkflowStatusSchema,
        beforeTaskId: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        const task = moveTaskKanbanCard(getDatabase(), input)
        publishTaskChange(task)
        return task
      } catch (error) {
        if (error instanceof TaskKanbanError) {
          throw new TRPCError({
            code: error.code === "not-found" ? "NOT_FOUND" : "CONFLICT",
            message: error.message,
          })
        }
        throw error
      }
    }),

  archiveCard: planningProcedure
    .input(z.object({ id: z.string(), expectedVersion: z.number().int().positive() }))
    .mutation(({ input }) => {
      try {
        const task = archiveTaskKanbanCard(getDatabase(), input)
        publishTaskChange(task)
        return task
      } catch (error) {
        if (error instanceof TaskKanbanError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message })
        }
        throw error
      }
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
      if (!project) throw new Error("Project not found")

      const task = db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          status: "backlog",
          defaultPermissionMode: project.defaultPermissionMode,
          defaultCustomPermissions: project.defaultCustomPermissions,
        })
        .returning()
        .get()
      publishTaskChange(task)
      return task
    }),

  list: publicProcedure
    .input(
      z.object({ projectId: z.string().optional(), includeArchived: z.boolean().default(false) }),
    )
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = []
      if (input.projectId) conditions.push(eq(tasks.projectId, input.projectId))
      if (!input.includeArchived) conditions.push(isNull(tasks.archivedAt))

      return db
        .select()
        .from(tasks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(tasks.pinnedAt), desc(tasks.updatedAt))
        .all()
    }),

  listArchived: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNotNull(tasks.archivedAt)]
      if (input?.projectId) conditions.push(eq(tasks.projectId, input.projectId))

      return db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.archivedAt))
        .all()
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(tasks).where(eq(tasks.id, input.id)).get()
  }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        status: taskWorkflowStatusSchema.optional(),
        defaultPermissionMode: permissionModeSchema.optional(),
        defaultCustomPermissions: customPermissionsSchema.optional().nullable(),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, expectedVersion, ...updates } = input
      if (updates.status !== undefined) {
        const current = db
          .select({ status: tasks.status })
          .from(tasks)
          .where(eq(tasks.id, id))
          .get()
        if (!current) throw new Error("Task not found")
        const currentStatus = taskWorkflowStatusSchema.parse(current.status) as TaskWorkflowStatus
        assertTaskStatusTransition(currentStatus, updates.status)
      }
      if (updates.defaultCustomPermissions !== undefined && !updates.defaultPermissionMode) {
        throw new Error("Updating custom capability toggles also requires a permission mode.")
      }
      if (updates.defaultPermissionMode === "custom" && !updates.defaultCustomPermissions) {
        throw new Error("Custom permission mode requires explicit capability toggles.")
      }
      if (
        updates.defaultPermissionMode &&
        updates.defaultPermissionMode !== "custom" &&
        updates.defaultCustomPermissions
      ) {
        throw new Error("Custom capability toggles require custom permission mode.")
      }
      const task = db
        .update(tasks)
        .set({
          ...updates,
          defaultCustomPermissions:
            updates.defaultPermissionMode === undefined
              ? undefined
              : updates.defaultCustomPermissions
                ? JSON.stringify(updates.defaultCustomPermissions)
                : null,
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
        .returning()
        .get()
      if (!task) {
        throw new TRPCError({ code: "CONFLICT", message: "Task changed in another window." })
      }
      publishTaskChange(task)
      return task
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    const task = db.delete(tasks).where(eq(tasks.id, input.id)).returning().get()
    publishTaskChange(task)
    return task
  }),

  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    const task = db
      .update(tasks)
      .set({ pinnedAt: new Date(), version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
    publishTaskChange(task)
    return task
  }),

  unpin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    const task = db
      .update(tasks)
      .set({ pinnedAt: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
    publishTaskChange(task)
    return task
  }),

  archive: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    const task = db
      .update(tasks)
      .set({ archivedAt: new Date(), version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
    publishTaskChange(task)
    return task
  }),

  restore: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    const task = db
      .update(tasks)
      .set({ archivedAt: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
    publishTaskChange(task)
    return task
  }),

  listChats: publicProcedure.input(z.object({ taskId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db
      .select()
      .from(chats)
      .where(and(eq(chats.taskId, input.taskId), isNull(chats.archivedAt)))
      .orderBy(desc(chats.pinnedAt), desc(chats.updatedAt))
      .all()
  }),

  ensurePrimaryWorktree: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const task = await ensureTaskPrimaryWorktree(input.id)
      publishTaskChange(task)
      return task
    }),
})
