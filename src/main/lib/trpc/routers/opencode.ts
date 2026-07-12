/**
 * OpenCode-backed harness router (Track E - E6/E7 backend).
 *
 * Exposes the provider onboarding, credential, catalog, permission-preview, and
 * runtime-status surface for OpenRouter + NanoGPT. The persisted `chat`
 * subscription is enabled by default and can be disabled explicitly with
 * FLAPSTACK_OPENCODE_SIDECAR_ENABLED=0.
 */

import { observable } from "@trpc/server/observable"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import {
  OPENCODE_PROVIDERS,
  buildOpencodePermissionApplication,
  buildOpencodePermissionConfig,
  clearProviderKeyAsync,
  getAvailableProviderModels,
  getCredentialStatusAsync,
  getProviderKeyAsync,
  isSidecarRuntimeEnabled,
  finalizeOpencodeRunPersistence,
  mergeMessagesById,
  mergeSidecarUsage,
  OpencodeRunAuditAccumulator,
  refreshProviderModels,
  resolveOpencodeBinary,
  runSidecarSession,
  SidecarChunkMapper,
  sanitizeOpencodeAuditValue,
  type SidecarApprovalDecision,
  type SidecarUsage,
  setProviderKeyAsync,
} from "../../harness/opencode-sidecar"
import { buildHarnessStartupContext, prependStartupContext } from "../../harness/launch-context"
import { sanitizeProviderErrorText } from "../../harness/provider-error"
import { captureCheckpoint, captureRunManifest } from "../../checkpoints"
import { captureOpenCodeRunUsageBatch } from "../../usage/run-usage"
import { getUsageProvider } from "../../usage/registry"
import { getUsageSecret } from "../../usage/secrets"
import { getUsageSettings } from "../../usage/settings"
import { agentRuns, chats, getDatabase, subChats } from "../../db"
import {
  getGlobalDefault,
  parsePermissionMode,
  permissionModes,
  type PermissionMode,
} from "../../permissions"
import { OPENCODE_HARNESSES } from "../../../../shared/harness-types"

const providerSchema = z.enum(OPENCODE_HARNESSES)
const permissionModeSchema = z.enum(permissionModes)

type PendingApproval = {
  provider: (typeof OPENCODE_HARNESSES)[number]
  runId: string
  toolCallId: string
  permission: string
  patterns: string[]
  command?: string
  resolve: (decision: SidecarApprovalDecision) => void
}

const activeStreams = new Map<string, { runId: string; controller: AbortController }>()
const pendingApprovals = new Map<string, PendingApproval>()

export function hasActiveOpencodeStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllOpencodeStreams(): void {
  for (const active of activeStreams.values()) active.controller.abort()
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  try {
    const parsed = JSON.parse(raw || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function resolvePermissionMode(
  subChatMode?: string | null,
  chatMode?: string | null,
): PermissionMode {
  return parsePermissionMode(subChatMode) || parsePermissionMode(chatMode) || getGlobalDefault()
}

export const opencodeRouter = router({
  /** List the OpenCode-backed providers with config + connection status. */
  listProviders: publicProcedure.query(async () => {
    return Promise.all(
      OPENCODE_HARNESSES.map(async (id) => {
        const def = OPENCODE_PROVIDERS[id]
        const status = await getCredentialStatusAsync(id)
        return {
          id,
          label: def.label,
          chip: def.chip,
          baseUrl: status.baseUrl ?? def.baseUrl,
          allowsCustomBaseUrl: def.allowsCustomBaseUrl,
          docsUrl: def.docsUrl,
          configured: status.configured,
          sessionOnly: status.sessionOnly === true,
          engine: "opencode" as const,
        }
      }),
    )
  }),

  /** Local cached catalog, falling back to a short seed list before first refresh. */
  listModels: publicProcedure
    .input(z.object({ provider: providerSchema }))
    .query(async ({ input }) => {
      let available = getAvailableProviderModels(input.provider)
      if (available.source === "seed" && (await getProviderKeyAsync(input.provider))) {
        try {
          await refreshProviderModels(input.provider)
          available = getAvailableProviderModels(input.provider)
        } catch {
          // Keep the seed visible, but chat preflight will block unsupported seed ids.
        }
      }
      return {
        provider: input.provider,
        ...available,
        note:
          available.source === "cache"
            ? "Cached locally from the provider. Refresh to fetch the latest list."
            : "Seed list. Configure a key and refresh to fetch the provider catalog.",
      }
    }),

  refreshModels: publicProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ input }) => refreshProviderModels(input.provider)),

  getKeyStatus: publicProcedure
    .input(z.object({ provider: providerSchema }))
    .query(async ({ input }) => {
      return getCredentialStatusAsync(input.provider)
    }),

  setKey: publicProcedure
    .input(
      z.object({
        provider: providerSchema,
        apiKey: z.string().min(1),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const definition = OPENCODE_PROVIDERS[input.provider]
      if (input.baseUrl && !definition.allowsCustomBaseUrl) {
        throw new Error(`${definition.label} does not support a custom base URL.`)
      }
      await setProviderKeyAsync(input.provider, input.apiKey, input.baseUrl)
      return getCredentialStatusAsync(input.provider)
    }),

  clearKey: publicProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ input }) => {
      await clearProviderKeyAsync(input.provider)
      return getCredentialStatusAsync(input.provider)
    }),

  /** Preview how a permission mode maps into OpenCode rules + honest limitations. */
  previewPermissions: publicProcedure
    .input(z.object({ mode: permissionModeSchema, cwd: z.string().nullable().optional() }))
    .query(({ input }) => {
      return {
        rules: buildOpencodePermissionConfig(input.mode),
        application: buildOpencodePermissionApplication({
          permissionMode: input.mode,
          cwd: input.cwd ?? null,
        }),
      }
    }),

  /** Whether the sidecar run path is enabled, and how the binary resolves. */
  runtimeStatus: publicProcedure.query(() => {
    const resolution = resolveOpencodeBinary()
    return {
      runtimeEnabled: isSidecarRuntimeEnabled(),
      binary:
        resolution.kind === "missing"
          ? { available: false, reason: sanitizeProviderErrorText(resolution.reason) }
          : { available: true, kind: resolution.kind, command: resolution.command },
      note: isSidecarRuntimeEnabled()
        ? "Sidecar runtime enabled."
        : "Provider runtime disabled by the current environment configuration.",
    }
  }),

  /**
   * Persisted OpenCode-backed run. The renderer subscribes to this exactly like
   * the existing harness streams. Missing credentials are rejected before any
   * prompt or run row is persisted.
   */
  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string().optional(),
        provider: providerSchema,
        model: z.string().min(1),
        prompt: z.string().min(1),
        cwd: z.string().min(1),
        projectPath: z.string().optional(),
        sessionId: z.string().optional(),
        images: z
          .array(
            z.object({
              base64Data: z.string().min(1),
              mediaType: z.string().min(1),
              filename: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<any>((emit) => {
        const existing = activeStreams.get(input.subChatId)
        if (existing) existing.controller.abort()

        const controller = new AbortController()
        const runId = input.runId || crypto.randomUUID()
        const startedAt = Date.now()
        activeStreams.set(input.subChatId, { runId, controller })
        const isAuthoritativeRun = () => activeStreams.get(input.subChatId)?.runId === runId
        let active = true
        let completed = false

        const safeEmit = (chunk: any) => {
          if (!active) return
          try {
            emit.next(chunk)
          } catch {
            active = false
          }
        }
        const complete = () => {
          if (!active) return
          active = false
          try {
            emit.complete()
          } catch {
            // Already closed.
          }
        }

        void (async () => {
          let status: "success" | "failure" | "cancelled" = "failure"
          let permissionMode: PermissionMode = getGlobalDefault()
          let usage: SidecarUsage | undefined
          const usageByObservation = new Map<string, SidecarUsage>()
          let db: ReturnType<typeof getDatabase> | undefined
          let runPersisted = false
          let messagesWithPrompt: any[] | undefined
          let sidecarSessionId: string | undefined
          let text = ""
          let reasoning = ""
          const reasoningMetadata: Array<{ partId: string; metadata: unknown }> = []
          let sawSidecarError = false
          let sidecarErrorText = ""
          const providerKey = await getProviderKeyAsync(input.provider)
          if (!providerKey) {
            if (activeStreams.get(input.subChatId)?.runId === runId) {
              activeStreams.delete(input.subChatId)
            }
            safeEmit({
              type: "error",
              errorText: `Add the ${OPENCODE_PROVIDERS[input.provider].label} API key in Settings before starting a run.`,
            })
            safeEmit({ type: "finish" })
            complete()
            return
          }
          let availableModels = getAvailableProviderModels(input.provider)
          if (availableModels.source === "seed") {
            try {
              await refreshProviderModels(input.provider)
              availableModels = getAvailableProviderModels(input.provider)
            } catch (error) {
              safeEmit({
                type: "error",
                errorText: `Could not load current ${OPENCODE_PROVIDERS[input.provider].label} models: ${sanitizeProviderErrorText(error)}`,
              })
              safeEmit({ type: "finish" })
              complete()
              return
            }
          }
          const modelId = input.model.startsWith(`${input.provider}/`)
            ? input.model.slice(input.provider.length + 1)
            : input.model
          if (!availableModels.models.some((model) => model.id === modelId)) {
            safeEmit({
              type: "error",
              errorText: `${modelId} is no longer available from ${OPENCODE_PROVIDERS[input.provider].label}. Select a refreshed model and retry.`,
            })
            safeEmit({ type: "finish" })
            complete()
            return
          }
          const auditSecrets = [providerKey]
          const runAudit = new OpencodeRunAuditAccumulator(auditSecrets)
          let finalMessageMetadata: Record<string, unknown> | undefined
          try {
            db = getDatabase()
            if (!isAuthoritativeRun()) return
            const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
            const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
            if (!subChat) throw new Error("Sub-chat not found")
            if (!chat) throw new Error("Chat not found")

            permissionMode = resolvePermissionMode(subChat.permissionMode, chat.permissionMode)
            const messages = parseStoredMessages(subChat.messages)
            const last = messages[messages.length - 1]
            const duplicate =
              last?.role === "user" &&
              last?.parts?.some((part: any) => part?.type === "text" && part.text === input.prompt)
            const promptMessage = duplicate
              ? last
              : {
                  id: crypto.randomUUID(),
                  role: "user",
                  parts: [{ type: "text", text: input.prompt }],
                }
            messagesWithPrompt = duplicate ? messages : mergeMessagesById(messages, [promptMessage])
            if (!duplicate) {
              if (!isAuthoritativeRun()) return
              db.update(subChats)
                .set({ messages: JSON.stringify(messagesWithPrompt), updatedAt: new Date() })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            db.update(agentRuns)
              .set({ status: "cancelled", completedAt: new Date() })
              .where(
                and(
                  eq(agentRuns.subChatId, input.subChatId),
                  eq(agentRuns.status, "running"),
                  ne(agentRuns.id, runId),
                ),
              )
              .run()
            db.insert(agentRuns)
              .values({
                id: runId,
                chatId: input.chatId,
                subChatId: input.subChatId,
                harness: input.provider,
                model: input.model,
                permissionMode,
                worktreePath: input.cwd,
                promptMessageId: promptMessage.id,
                status: "running",
              })
              .run()
            runPersisted = true
            const before = await captureCheckpoint(runId, input.cwd, "before")
            db.update(agentRuns)
              .set({ beforeCheckpointId: before.id })
              .where(eq(agentRuns.id, runId))
              .run()
            if (!isAuthoritativeRun()) {
              status = "cancelled"
              return
            }
            db.update(subChats)
              .set({
                harness: input.provider,
                model: input.model,
                permissionMode,
                worktreePath: input.cwd,
                runStatus: "running",
                updatedAt: new Date(),
              })
              .where(eq(subChats.id, input.subChatId))
              .run()
            db.update(chats)
              .set({ harness: input.provider, model: input.model, updatedAt: new Date() })
              .where(eq(chats.id, input.chatId))
              .run()

            const mapper = new SidecarChunkMapper()
            const startupContext = await buildHarnessStartupContext({
              cwd: input.cwd,
              projectPath: input.projectPath,
              harness: "opencode",
            })
            const promptForModel = prependStartupContext(input.prompt, startupContext)

            for await (const event of runSidecarSession(
              {
                provider: input.provider,
                model: input.model,
                prompt: promptForModel,
                attachments: input.images?.map((image) => ({
                  mime: image.mediaType,
                  url: `data:${image.mediaType};base64,${image.base64Data}`,
                  ...(image.filename ? { filename: image.filename } : {}),
                })),
                cwd: input.cwd,
                permissionMode,
                resumeSessionId: input.sessionId || subChat.sessionId || undefined,
                signal: controller.signal,
              },
              async (request) =>
                new Promise((resolve) => {
                  let settled = false
                  const finishApproval = (decision: SidecarApprovalDecision) => {
                    if (settled) return
                    settled = true
                    controller.signal.removeEventListener("abort", abortApproval)
                    resolve(decision)
                  }
                  const abortApproval = () => {
                    pendingApprovals.delete(request.requestId)
                    finishApproval({
                      reply: "reject",
                      message: "Run cancelled while approval was pending.",
                    })
                  }
                  pendingApprovals.set(request.requestId, {
                    provider: input.provider,
                    runId,
                    toolCallId: request.toolCallId,
                    permission: request.permission,
                    patterns: request.patterns,
                    ...(request.command ? { command: request.command } : {}),
                    resolve: finishApproval,
                  })
                  controller.signal.addEventListener("abort", abortApproval, { once: true })
                  if (controller.signal.aborted) abortApproval()
                }),
            )) {
              runAudit.apply(event)
              if (event.kind === "session-start") {
                sidecarSessionId = event.sessionId
                if (isAuthoritativeRun()) {
                  db.update(subChats)
                    .set({ sessionId: event.sessionId, updatedAt: new Date() })
                    .where(eq(subChats.id, input.subChatId))
                    .run()
                }
              }
              if (event.kind === "text-delta") text += event.delta
              if (event.kind === "reasoning-delta") reasoning += event.delta
              if (event.kind === "reasoning-metadata") {
                reasoningMetadata.push({
                  partId: event.partId,
                  metadata: sanitizeOpencodeAuditValue(event.metadata, auditSecrets),
                })
              }
              if (event.kind === "error") {
                sawSidecarError = true
                sidecarErrorText = sanitizeProviderErrorText(event.errorText)
              }
              if (event.kind === "usage") {
                usageByObservation.set(event.usage.observationId ?? "latest", event.usage)
                usage = mergeSidecarUsage([...usageByObservation.values()])
              }
              if (event.kind === "permission-asked") {
                safeEmit({ type: "opencode-permission-request", ...event, runId })
              }
              const publicEvent =
                event.kind === "error"
                  ? { ...event, errorText: sanitizeProviderErrorText(event.errorText) }
                  : event
              for (const chunk of mapper.map(publicEvent)) safeEmit(chunk)
            }

            for (const chunk of mapper.finish()) safeEmit(chunk)
            status = controller.signal.aborted
              ? "cancelled"
              : sawSidecarError
                ? "failure"
                : "success"
          } catch (error) {
            status = controller.signal.aborted ? "cancelled" : "failure"
            safeEmit({
              type: "error",
              errorText: sanitizeProviderErrorText(error),
            })
          } finally {
            for (const [requestId, approval] of pendingApprovals) {
              if (approval.runId === runId) {
                pendingApprovals.delete(requestId)
                approval.resolve({ reply: "reject", message: "Run ended before approval." })
              }
            }
            if (db && messagesWithPrompt) {
              try {
                const audit = runAudit.snapshot()
                const assistantParts = [
                  ...(reasoning || reasoningMetadata.length
                    ? [
                        {
                          type: "reasoning",
                          text: reasoning,
                          state: "done",
                          ...(reasoningMetadata.length ? { metadata: reasoningMetadata } : {}),
                        },
                      ]
                    : []),
                  ...(text ? [{ type: "text", text, state: "done" }] : []),
                  ...runAudit.toMessageParts(),
                  ...(sidecarErrorText
                    ? [{ type: "text", text: `Error: ${sidecarErrorText}`, state: "done" }]
                    : []),
                ]
                finalMessageMetadata = {
                  harness: input.provider,
                  model: input.model,
                  runId,
                  durationMs: Date.now() - startedAt,
                  sessionId: sidecarSessionId,
                  permissionMode,
                  engine: audit.engine,
                  permissionApplication: audit.permissionApplication,
                  limitations: audit.limitations,
                  toolActivity: audit.toolActivity,
                  approvalActivity: audit.approvalActivity,
                  ...(usage ? { usage } : {}),
                }
                if (
                  isAuthoritativeRun() &&
                  (assistantParts.length > 0 || runAudit.hasActivity() || sawSidecarError)
                ) {
                  const latest = db
                    .select({ messages: subChats.messages })
                    .from(subChats)
                    .where(eq(subChats.id, input.subChatId))
                    .get()
                  const currentMessages = parseStoredMessages(latest?.messages)
                  const assistantMessage = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    parts: assistantParts,
                    metadata: finalMessageMetadata,
                  }
                  db.update(subChats)
                    .set({
                      messages: JSON.stringify(
                        mergeMessagesById(currentMessages, [assistantMessage]),
                      ),
                      updatedAt: new Date(),
                    })
                    .where(eq(subChats.id, input.subChatId))
                    .run()
                }
              } catch (persistenceError) {
                console.error(
                  "[opencode] Failed to persist assistant run metadata",
                  persistenceError,
                )
              }
            }
            if (!completed && runPersisted) {
              completed = true
              try {
                const finalDb = db ?? getDatabase()
                await finalizeOpencodeRunPersistence({
                  captureAfter: async () => (await captureCheckpoint(runId, input.cwd, "after")).id,
                  updateRunStatus: (afterCheckpointId) => {
                    finalDb
                      .update(agentRuns)
                      .set({
                        status,
                        completedAt: new Date(),
                        ...(afterCheckpointId ? { afterCheckpointId } : {}),
                      })
                      .where(eq(agentRuns.id, runId))
                      .run()
                  },
                  updateSubChatStatus: () => {
                    if (!isAuthoritativeRun()) return
                    finalDb
                      .update(subChats)
                      .set({ runStatus: status, updatedAt: new Date() })
                      .where(eq(subChats.id, input.subChatId))
                      .run()
                  },
                  captureManifest: () => captureRunManifest(runId),
                  ...(usage
                    ? {
                        captureUsage: () =>
                          captureOpenCodeRunUsageBatch(
                            finalDb,
                            [...usageByObservation.values()].map((observation) => ({
                              providerId: input.provider,
                              runId,
                              model: input.model,
                              ...observation,
                            })),
                            {
                              alerts: {
                                settings: getUsageSettings(),
                                getSecret: async (key) => getUsageSecret(key),
                                provider: getUsageProvider(input.provider)!,
                              },
                            },
                          ),
                      }
                    : {}),
                  onError: (stage, error) =>
                    console.error(`[opencode] Failed finalization stage ${stage}`, error),
                })
              } catch (persistenceError) {
                console.error(
                  "[opencode] Could not access finalization persistence",
                  persistenceError,
                )
              }
            }
            if (activeStreams.get(input.subChatId)?.runId === runId) {
              activeStreams.delete(input.subChatId)
            }
            safeEmit({ type: "finish", messageMetadata: finalMessageMetadata })
            complete()
          }
        })()

        return () => {
          active = false
          controller.abort()
        }
      }),
    ),

  listPendingApprovals: publicProcedure.input(z.object({ runId: z.string() })).query(({ input }) =>
    Array.from(pendingApprovals, ([requestId, approval]) => ({
      requestId,
      runId: approval.runId,
      provider: approval.provider,
      toolCallId: approval.toolCallId,
      permission: approval.permission,
      patterns: approval.patterns,
      ...(approval.command ? { command: approval.command } : {}),
    })).filter((approval) => approval.runId === input.runId),
  ),

  replyApproval: publicProcedure
    .input(
      z.object({
        requestId: z.string(),
        reply: z.enum(["once", "always", "reject"]),
        message: z.string().max(2_000).optional(),
      }),
    )
    .mutation(({ input }) => {
      const pending = pendingApprovals.get(input.requestId)
      if (!pending) return { resolved: false }
      pendingApprovals.delete(input.requestId)
      pending.resolve(
        input.reply === "reject"
          ? { reply: "reject", message: input.message || "Denied by Flapstack." }
          : { reply: input.reply },
      )
      return { resolved: true }
    }),

  cancel: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string() }))
    .mutation(({ input }) => {
      const active = activeStreams.get(input.subChatId)
      if (!active || active.runId !== input.runId) return { cancelled: false }
      active.controller.abort()
      return { cancelled: true }
    }),
})
