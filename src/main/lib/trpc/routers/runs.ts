import { readRunTimings } from "../../run-timings"
import { classifyProviderLimitError } from "../../../../shared/provider-limit-error"
import { getRunContextHealth } from "../../project-vaults/context-health"
import { runContextHealthInputSchema } from "../../../../shared/run-context-health"
import { getSqliteDatabase } from "../../db"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  captureCheckpoint,
  captureRunManifest,
  prepareCheckpointOriginals,
} from "../../checkpoints"
import { releaseCheckpointPreparation } from "../../checkpoint-preparation"
import { resolveDefaultWorktree } from "../../worktree-resolver"
import { assertSubChatNotRewinding } from "../../sub-chat-rewind-guard"
import {
  agentRuns,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  projects,
  subChats,
  tasks,
} from "../../db"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { permissionModes } from "../../permissions"
import { getRunChangeReview, getRunChangeSet, undoRunChangeSet } from "../../run-change-undo"
import { publicProcedure, router } from "../index"
import {
  assertUsageBudgetAllowsLaunch,
  bindUsageBudgetOverrideToRun,
  providerForHarness,
} from "../../usage/budgets"
import { projectVaultSectionIds } from "../../project-vaults/registry"
import { serializeProjectVaultRunSelection } from "../../project-vaults/run-context"
import { constructRuntimeSnapshot, runtimePermissionSnapshot } from "../../agent-runtime/snapshot"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"

const permissionModeSchema = z.enum(permissionModes)
const vaultContextGraphSelectionSchema = z.object({
  nodeIds: z.array(z.string().trim().min(1).max(200)).max(24),
  expectedGenerationId: z.string().trim().min(1).max(200),
  expansion: z
    .object({
      depth: z.number().int().min(0).max(2),
      direction: z.enum(["outgoing", "incoming", "both"]),
      maxNodes: z.number().int().min(1).max(24),
    })
    .optional(),
})

export const runsRouter = router({
  prepareSelectedCheckout: publicProcedure
    .input(
      z.union([
        z.object({ scope: z.literal("release"), lease: z.string().uuid() }),
        z.object({
          scope: z.enum(["chat", "project", "task"]),
          id: z.string().min(1),
          subChatId: z.string().min(1).optional(),
          path: z.string().min(1),
          lease: z.string().uuid(),
          permissionMode: permissionModeSchema,
        }),
      ]),
    )
    .mutation(({ input }) => {
      if (input.scope === "release") {
        releaseCheckpointPreparation(input.lease)
        return
      }
      if (input.permissionMode === "read-only") return
      const db = getDatabase()
      let path: string | null | undefined
      if (input.scope === "chat") {
        const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
        if (!chat || chat.archivedAt || chat.permissionMode === "read-only") return
        if (input.subChatId) {
          const sub = db
            .select({
              chatId: subChats.chatId,
              mode: subChats.mode,
              permission: subChats.permissionMode,
            })
            .from(subChats)
            .where(eq(subChats.id, input.subChatId))
            .get()
          if (
            sub?.chatId !== chat.id ||
            sub.permission === "read-only" ||
            (sub.mode !== "write" && sub.mode !== "agent")
          )
            return
        }
        path = chat.worktreePath ?? resolveDefaultWorktree(chat)
      } else if (input.scope === "project") {
        const project = db.select().from(projects).where(eq(projects.id, input.id)).get()
        if (!project?.archivedAt && project?.defaultPermissionMode !== "read-only")
          path = project?.path
      } else {
        const task = db.select().from(tasks).where(eq(tasks.id, input.id)).get()
        if (!task?.archivedAt && task?.defaultPermissionMode !== "read-only")
          path = task?.primaryWorktreePath
      }
      if (path && path === input.path)
        prepareCheckpointOriginals(assertRegisteredWorktree(path).canonicalPath, input.lease)
    }),
  getTimings: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ input }) => readRunTimings(getSqliteDatabase(), input.runId)),
  getContextHealth: publicProcedure
    .input(runContextHealthInputSchema)
    .query(({ input }) => getRunContextHealth(getSqliteDatabase(), input)),
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
        budgetOverrideToken: z.string().min(1).max(500).optional(),
        vaultContextSectionIds: z.array(z.enum(projectVaultSectionIds)).optional(),
        vaultContextGraphSelection: vaultContextGraphSelectionSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
      if (!chat) throw new Error("Chat not found")
      const budgetContext = {
        controlled: true,
        providerId: providerForHarness(input.harness),
        accountTag: null,
        projectId: chat.projectId,
        taskId: chat.taskId,
        automationId: null,
        orchestrationId: null,
        runId: null,
      }
      const budgetDecision = assertUsageBudgetAllowsLaunch(db, budgetContext, {
        overrideToken: input.budgetOverrideToken,
      })
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
      if (input.subChatId) assertSubChatNotRewinding(input.subChatId)
      const run = db
        .insert(agentRuns)
        .values({
          ...constructRuntimeSnapshot(db, {
            chatId: input.chatId,
            harness: input.harness,
            model: input.model,
            permission: runtimePermissionSnapshot(
              input.permissionMode,
              input.permissionMode === "custom" ? chat.customPermissions : null,
            ),
          }),
          chatId: input.chatId,
          subChatId: input.subChatId,
          harness: input.harness,
          model: input.model,
          permissionMode: input.permissionMode,
          customPermissions: input.permissionMode === "custom" ? chat.customPermissions : null,
          worktreePath: input.worktreePath ?? null,
          promptMessageId: input.promptMessageId,
          vaultContextSections:
            input.vaultContextSectionIds === undefined &&
            input.vaultContextGraphSelection === undefined
              ? null
              : serializeProjectVaultRunSelection({
                  sectionIds: input.vaultContextSectionIds ?? [],
                  ...(input.vaultContextGraphSelection
                    ? { graph: input.vaultContextGraphSelection }
                    : {}),
                }),
          status: "running",
        })
        .returning()
        .get()

      if (
        input.budgetOverrideToken &&
        budgetDecision.evaluations.some((evaluation) => evaluation.overridden)
      ) {
        bindUsageBudgetOverrideToRun(input.budgetOverrideToken, budgetContext, run.id)
      }

      const before = await captureCheckpoint(run.id, checkpointRoot, "before")
      const created = db
        .update(agentRuns)
        .set({ beforeCheckpointId: before.id })
        .where(eq(agentRuns.id, run.id))
        .returning()
        .get()
      publishRunInvalidation(created.id, created.chatId)
      return created
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

      const completed = db
        .update(agentRuns)
        .set({
          status: input.status,
          completedAt: new Date(),
          afterCheckpointId: after.id,
        })
        .where(eq(agentRuns.id, input.runId))
        .returning()
        .get()
      publishRunInvalidation(completed.id, completed.chatId)
      return completed
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

  latestForSubChat: publicProcedure
    .input(z.object({ chatId: z.string(), subChatId: z.string() }))
    .query(({ input }) => {
      const run = getDatabase()
        .select({
          id: agentRuns.id,
          subChatId: agentRuns.subChatId,
          status: agentRuns.status,
          promptMessageId: agentRuns.promptMessageId,
        })
        .from(agentRuns)
        .where(and(eq(agentRuns.chatId, input.chatId), eq(agentRuns.subChatId, input.subChatId)))
        .orderBy(desc(agentRuns.startedAt), desc(sql`${agentRuns}.rowid`))
        .limit(1)
        .get()
      if (run?.status !== "failure") return run && { ...run, limitKind: null }
      const events = getSqliteDatabase()
        .prepare(
          `SELECT coalesce(json_extract(payload_json,'$.message'),json_extract(payload_json,'$.detail')) message
         FROM agent_activity_events WHERE run_id=? AND phase='failed'
         AND kind IN ('status','warning','lifecycle') AND privacy_class IN ('public','sensitive')
         AND json_valid(payload_json) ORDER BY sequence DESC LIMIT 12`,
        )
        .all(run.id) as Array<{ message: string | null }>
      const limitKind =
        events.map((event) => classifyProviderLimitError(event.message ?? "")).find(Boolean) ?? null
      return { ...run, limitKind }
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

function publishRunInvalidation(runId: string, chatId: string): void {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["runs", "chats"],
    runIds: [runId],
    chatIds: [chatId],
  })
}
