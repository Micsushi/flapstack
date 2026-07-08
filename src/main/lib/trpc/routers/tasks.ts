import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { join } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import { chats, getDatabase, projects, tasks } from "../../db"
import { createWorktree, getDefaultBranch } from "../../git/worktree"
import { sanitizeProjectName } from "../../git/worktree-naming"
import { permissionModes } from "../../permissions"
import { publicProcedure, router } from "../index"

const permissionModeSchema = z.enum(permissionModes)

function taskWorktreeSlug(task: { id: string; name: string }): string {
  const nameSlug = sanitizeProjectName(task.name) || "task"
  const idSlug = sanitizeProjectName(task.id).slice(-8) || "task"
  return `${nameSlug}-${idSlug}`
}

function taskBranchName(task: { id: string; name: string }): string {
  return `task/${taskWorktreeSlug(task)}`
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
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .returning()
    .get()
}

export const tasksRouter = router({
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

      return db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          defaultPermissionMode: project.defaultPermissionMode,
        })
        .returning()
        .get()
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
        status: z.string().optional(),
        defaultPermissionMode: permissionModeSchema.optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, ...updates } = input
      return db
        .update(tasks)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning()
        .get()
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db.delete(tasks).where(eq(tasks.id, input.id)).returning().get()
  }),

  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(tasks)
      .set({ pinnedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
  }),

  unpin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(tasks)
      .set({ pinnedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
  }),

  archive: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(tasks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
  }),

  restore: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(tasks)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, input.id))
      .returning()
      .get()
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
    .mutation(({ input }) => ensureTaskPrimaryWorktree(input.id)),
})
