import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { captureCheckpoint, captureRunManifest } from "../../checkpoints"
import { agentRuns, checkpoints, fileChangeManifests, getDatabase } from "../../db"
import { permissionModes } from "../../permissions"
import { publicProcedure, router } from "../index"

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
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const run = db
        .insert(agentRuns)
        .values({
          chatId: input.chatId,
          subChatId: input.subChatId,
          harness: input.harness,
          model: input.model,
          permissionMode: input.permissionMode,
          worktreePath: input.worktreePath ?? null,
          promptMessageId: input.promptMessageId,
          status: "running",
        })
        .returning()
        .get()

      const before = await captureCheckpoint(run.id, input.worktreePath ?? null, "before")
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

      const after = await captureCheckpoint(run.id, run.worktreePath, "after")
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
})
