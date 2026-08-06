import { observable } from "@trpc/server/observable"
import { app } from "electron"
import { join } from "node:path"
import { z } from "zod"
import { CHAT_MODES } from "../../../../shared/chat-mode"
import { CODEX_THREAD_VISIBILITIES } from "../../../../shared/codex-thread-visibility"
import { openAppDatabase } from "../../db/access"
import { getDatabasePath } from "../../db"
import { sleep } from "../../../../shared/sleep"
import {
  loadInteractiveRuntimeActivity,
  loadInteractiveRuntimeAssistantText,
  materializeInteractiveRuntimeRun,
  persistInteractiveRuntimeAssistantFallback,
  prepareInteractiveRuntimeLaunch,
  resolveInteractiveRuntime,
} from "../../agent-runtime/interactive-chat"
import { requireRuntimeLaunchAuthority } from "../../agent-runtime/launch-access"
import { agentInputLifecycle } from "../../agent-input/service"
import { getResolvedWorktreeStatus } from "../../worktree-resolver"
import { bindVisualCaptureImagesToRun } from "../../visual-capture/run-provenance"
import { publicProcedure, router } from "../index"

const harnessSchema = z.enum(["codex", "claude-code"])
const effortSchema = z.enum(["minimal", "none", "low", "medium", "high", "xhigh", "max", "ultra"])
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

const resolveInputSchema = z.object({
  chatId: z.string().trim().min(1).max(512),
  subChatId: z.string().trim().min(1).max(512),
  harness: harnessSchema,
  model: z.string().trim().min(1).max(256).nullable(),
  mode: z.enum(CHAT_MODES),
  reasoningEffort: effortSchema.nullable().default(null),
  reasoningEnabled: z.boolean().default(true),
})

const launchInputSchema = resolveInputSchema.extend({
  runId: z.string().trim().min(1).max(512),
  prompt: z.string().min(1).max(2_000_000),
  codexThreadVisibility: z.enum(CODEX_THREAD_VISIBILITIES).default("hidden"),
  promptMessageId: z.string().trim().min(1).max(512).optional(),
  vaultContextGraphSelection: vaultContextGraphSelectionSchema.optional(),
  images: z
    .array(
      z.object({
        base64Data: z.string().min(1).max(20_000_000),
        mediaType: z
          .string()
          .trim()
          .regex(/^image\/[a-z0-9.+-]+$/i),
        filename: z.string().trim().min(1).max(512).optional(),
      }),
    )
    .max(10)
    .optional(),
})

type RuntimeChatEvent =
  | { type: "started"; runId: string; runtime: "codex" | "claude-code" }
  | {
      type: "assistant-text"
      runId: string
      phase: "started" | "delta" | "completed"
      text: string
      providerItemId: string | null
      providerMessageId: string | null
      contentIndex: number | null
      sectionBoundary: string | null
    }
  | {
      type: "activity-batch"
      runId: string
      events: ReturnType<typeof loadInteractiveRuntimeActivity>["events"]
    }
  | { type: "finished"; runId: string; durationMs: number }

export const agentRuntimeChatRouter = router({
  resolve: publicProcedure.input(resolveInputSchema).query(async ({ input }) => {
    await assertRuntimeCheckoutReady(input.chatId)
    const path = getDatabasePath()
    const authority = requireRuntimeLaunchAuthority(path)
    const database = openAppDatabase(path, { readonly: true })
    try {
      const preliminary = resolveInteractiveRuntime(database, input)
      const probe = await authority.probe(preliminary.resolvedRuntime, input.harness)
      return resolveInteractiveRuntime(database, input, {
        [preliminary.resolvedRuntime]: probe,
      })
    } finally {
      database.close()
    }
  }),

  prepare: publicProcedure.input(resolveInputSchema).mutation(async ({ input }) => {
    await assertRuntimeCheckoutReady(input.chatId)
    const path = getDatabasePath()
    const authority = requireRuntimeLaunchAuthority(path)
    const preliminaryDatabase = openAppDatabase(path, { readonly: true })
    let preliminary
    try {
      preliminary = resolveInteractiveRuntime(preliminaryDatabase, input)
    } finally {
      preliminaryDatabase.close()
    }
    const probe = await authority.probe(preliminary.resolvedRuntime, input.harness)
    const database = openAppDatabase(path)
    try {
      return prepareInteractiveRuntimeLaunch(database, input, {
        [preliminary.resolvedRuntime]: probe,
      })
    } finally {
      database.close()
    }
  }),

  launch: publicProcedure.input(launchInputSchema).subscription(({ input }) => {
    return observable<RuntimeChatEvent>((emit) => {
      const path = getDatabasePath()
      const authority = requireRuntimeLaunchAuthority(path)
      let disposed = false
      let finished = false

      void (async () => {
        await assertRuntimeCheckoutReady(input.chatId)
        const database = openAppDatabase(path)
        let run
        try {
          const preliminary = resolveInteractiveRuntime(database, input)
          const probe = await authority.probe(preliminary.resolvedRuntime, input.harness)
          run = materializeInteractiveRuntimeRun(database, input, {
            [preliminary.resolvedRuntime]: probe,
          })
          try {
            await bindVisualCaptureImagesToRun({
              database,
              artifactRoot: join(app.getPath("userData"), "visual-artifacts"),
              chatId: input.chatId,
              runId: input.runId,
              images: input.images,
            })
          } catch (error) {
            database
              .prepare(
                `UPDATE agent_runs
                    SET status = 'failure', completed_at = unixepoch()
                  WHERE id = ?`,
              )
              .run(input.runId)
            throw error
          }
        } finally {
          database.close()
        }
        if (disposed) {
          await authority.cancel(input.runId, "interactive-runtime-subscription-closed")
          return
        }
        const startedAtMs = Date.now()
        emit.next({
          type: "started",
          runId: input.runId,
          runtime: run.runtimeLaunch!.resolvedRuntime as "codex" | "claude-code",
        })
        let launchSettled = false
        let launchError: unknown = null
        const launch = authority.launch(run).then(
          () => {
            launchSettled = true
          },
          (error) => {
            launchError = error
            launchSettled = true
          },
        )
        let cursor = 0
        let sawTextContent = false
        const emitAvailableActivity = () => {
          const activityDatabase = openAppDatabase(path, { readonly: true })
          try {
            while (!disposed) {
              const batch = loadInteractiveRuntimeActivity(activityDatabase, input.runId, cursor)
              cursor = batch.cursor
              let visibleActivity: typeof batch.events = []
              const flushActivity = () => {
                if (visibleActivity.length === 0) return
                emit.next({ type: "activity-batch", runId: input.runId, events: visibleActivity })
                visibleActivity = []
              }
              for (const event of batch.events) {
                if (
                  event.kind === "agent-text" &&
                  (event.phase === "started" ||
                    event.phase === "delta" ||
                    event.phase === "completed")
                ) {
                  flushActivity()
                  const text = event.payload.text
                  if (text) sawTextContent = true
                  emit.next({
                    type: "assistant-text",
                    runId: input.runId,
                    phase: event.phase,
                    text,
                    providerItemId: event.providerItemId ?? null,
                    providerMessageId: event.providerMessageId ?? null,
                    contentIndex: event.contentIndex ?? null,
                    sectionBoundary: event.sectionBoundary ?? null,
                  })
                } else if (
                  event.kind !== "agent-text" &&
                  event.privacyClass !== "private" &&
                  event.privacyClass !== "encrypted"
                ) {
                  visibleActivity.push(event)
                }
              }
              flushActivity()
              if (batch.events.length < 500) break
            }
          } finally {
            activityDatabase.close()
          }
        }
        while (!disposed && !launchSettled) {
          emitAvailableActivity()
          if (!launchSettled) await delay(75)
        }
        await launch
        if (launchError) throw launchError
        if (disposed) return
        emitAvailableActivity()
        const resultDatabase = openAppDatabase(path)
        let assistantText = ""
        try {
          assistantText = loadInteractiveRuntimeAssistantText(resultDatabase, input.runId)
          persistInteractiveRuntimeAssistantFallback(resultDatabase, input.runId, assistantText)
        } finally {
          resultDatabase.close()
        }
        if (!sawTextContent && assistantText) {
          emit.next({
            type: "assistant-text",
            runId: input.runId,
            phase: "completed",
            text: assistantText,
            providerItemId: null,
            providerMessageId: null,
            contentIndex: null,
            sectionBoundary: "fallback",
          })
        }
        finished = true
        emit.next({ type: "finished", runId: input.runId, durationMs: Date.now() - startedAtMs })
        emit.complete()
      })().catch((error) => {
        if (!disposed) emit.error(error)
      })

      return () => {
        disposed = true
        if (!finished) {
          void authority.cancel(input.runId, "interactive-runtime-subscription-closed")
        }
      }
    })
  }),

  cancel: publicProcedure
    .input(z.object({ runId: z.string().trim().min(1).max(512) }))
    .mutation(async ({ input }) => {
      agentInputLifecycle.cancelByRun(input.runId, "Runtime run cancelled.")
      return {
        cancelled: await requireRuntimeLaunchAuthority(getDatabasePath()).cancel(
          input.runId,
          "user-cancelled",
        ),
      }
    }),
})

function delay(milliseconds: number): Promise<void> {
  return sleep(milliseconds)
}

async function assertRuntimeCheckoutReady(chatId: string): Promise<void> {
  const status = await getResolvedWorktreeStatus(chatId)
  if (status.status === "unknown" || status.status === "replaced") {
    throw new Error(status.error)
  }
}
