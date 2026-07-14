import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { captureCheckpoint, captureRunManifest } from "../../checkpoints"
import {
  agentRuns,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  projects,
  tasks,
} from "../../db"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { permissionModes } from "../../permissions"
import { getRunChangeReview, getRunChangeSet, undoRunChangeSet } from "../../run-change-undo"
import { publicProcedure, router } from "../index"
import { projectVaultSectionIds } from "../../project-vaults/registry"

const permissionModeSchema = z.enum(permissionModes)

export const runsRouter = router({
  createRun: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        subChatId: z.string().optional(),
        harness: z.string(),
        model: z.string().optional(),
        permissionMode: permissionModeSchema,
        worktreePath: z.string().nullable().optional(),
        promptMessageId: z.string().optional(),
        vaultContextSectionIds: z.array(z.enum(projectVaultSectionIds)).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
      if (!chat) throw new Error("Chat not found")
      let checkpointRoot: string | null = null
      if (input.worktreePath) {
        const project = chat.projectId
          ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
          : null
        const task = chat.taskId
          ? db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
          : null
        const allowedRoots = new Set(
          [chat.worktreePath, project?.path, task?.primaryWorktreePath].filter(
            (path): path is string => Boolean(path),
          ),
        )
        if (!allowedRoots.has(input.worktreePath)) {
          throw new Error("Run worktree must be a registered root owned by its chat")
        }
        checkpointRoot = assertRegisteredWorktree(input.worktreePath).canonicalPath
      }
      const run = db
        .insert(agentRuns)
        .values({
          chatId: input.chatId,
          subChatId: input.subChatId,
          harness: input.harness,
          model: input.model,
          permissionMode: input.permissionMode,
          customPermissions: input.permissionMode === "custom" ? chat.customPermissions : null,
          worktreePath: input.worktreePath ?? null,
          promptMessageId: input.promptMessageId,
          vaultContextSections:
            input.vaultContextSectionIds === undefined
              ? null
              : JSON.stringify(input.vaultContextSectionIds),
          status: "running",
        })
        .returning()
        .get()

      const before = await captureCheckpoint(run.id, checkpointRoot, "before")
      return db
        .update(agentRuns)
        .set({ beforeCheckpointId: before.id })
        .where(eq(agentRuns.id, run.id))
        .returning()
        .get()
    }),

  completeRun: publicProcedure
    .input(
      z.object({
        runId: z.string(),
        status: z.enum(["success", "failure", "cancelled"]).default("success"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const run = db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
      if (!run) throw new Error("Run not found")

      const checkpointRoot = run.worktreePath
        ? assertRegisteredWorktree(run.worktreePath).canonicalPath
        : null
      const after = await captureCheckpoint(run.id, checkpointRoot, "after")
      await captureRunManifest(run.id)

      return db
        .update(agentRuns)
        .set({
          status: input.status,
          completedAt: new Date(),
          afterCheckpointId: after.id,
        })
        .where(eq(agentRuns.id, input.runId))
        .returning()
        .get()
    }),

  listByChat: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.chatId, input.chatId))
      .orderBy(desc(agentRuns.startedAt))
      .all()
  }),

  get: publicProcedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  }),

  getManifest: publicProcedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const runCheckpoints = db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.runId, input.runId))
      .all()
    const manifest = db
      .select()
      .from(fileChangeManifests)
      .where(eq(fileChangeManifests.runId, input.runId))
      .all()
    return { checkpoints: runCheckpoints, manifest }
  }),

  getChangeSet: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ input }) => getRunChangeSet(input.runId)),

  getChangeReview: publicProcedure
    .input(z.object({ runId: z.string(), filePath: z.string().optional() }))
    .query(({ input }) => getRunChangeReview(input.runId, input.filePath)),

  undoChangeSet: publicProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(({ input }) => undoRunChangeSet(input.runId)),
})
