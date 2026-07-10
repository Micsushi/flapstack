/**
 * OpenCode-backed harness router (Track E — E6/E7 backend).
 *
 * Exposes the provider onboarding, credential, catalog, permission-preview, and
 * runtime-status surface for OpenRouter + NanoGPT. The persisted `chat`
 * subscription is gated behind FLAPSTACK_OPENCODE_SIDECAR_ENABLED, so the UI
 * never claims a provider run works before the provider manual matrix passes.
 */

import { observable } from "@trpc/server/observable"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import {
  OPENCODE_PROVIDERS,
  buildOpencodePermissionApplication,
  buildOpencodePermissionConfig,
  clearProviderKey,
  getAvailableProviderModels,
  getCredentialStatus,
  isSidecarRuntimeEnabled,
  refreshProviderModels,
  resolveOpencodeBinary,
  runSidecarSession,
  SidecarChunkMapper,
  type SidecarApprovalDecision,
  setProviderKey,
} from "../../harness/opencode-sidecar"
import { captureCheckpoint, captureRunManifest } from "../../checkpoints"
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
  permission: string
  resolve: (decision: SidecarApprovalDecision) => void
}

const activeStreams = new Map<string, { runId: string; controller: AbortController }>()
const pendingApprovals = new Map<string, PendingApproval>()

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
  listProviders: publicProcedure.query(() => {
    return OPENCODE_HARNESSES.map((id) => {
      const def = OPENCODE_PROVIDERS[id]
      const status = getCredentialStatus(id)
      return {
        id,
        label: def.label,
        chip: def.chip,
        baseUrl: status.baseUrl ?? def.baseUrl,
        allowsCustomBaseUrl: def.allowsCustomBaseUrl,
        docsUrl: def.docsUrl,
        configured: status.configured,
        engine: "opencode" as const,
      }
    })
  }),

  /** Local cached catalog, falling back to a short seed list before first refresh. */
  listModels: publicProcedure.input(z.object({ provider: providerSchema })).query(({ input }) => {
    const available = getAvailableProviderModels(input.provider)
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

  getKeyStatus: publicProcedure.input(z.object({ provider: providerSchema })).query(({ input }) => {
    return getCredentialStatus(input.provider)
  }),

  setKey: publicProcedure
    .input(
      z.object({
        provider: providerSchema,
        apiKey: z.string().min(1),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ input }) => {
      const definition = OPENCODE_PROVIDERS[input.provider]
      if (input.baseUrl && !definition.allowsCustomBaseUrl) {
        throw new Error(`${definition.label} does not support a custom base URL.`)
      }
      setProviderKey(input.provider, input.apiKey, input.baseUrl)
      return getCredentialStatus(input.provider)
    }),

  clearKey: publicProcedure.input(z.object({ provider: providerSchema })).mutation(({ input }) => {
    clearProviderKey(input.provider)
    return getCredentialStatus(input.provider)
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
          ? { available: false, reason: resolution.reason }
          : { available: true, kind: resolution.kind, command: resolution.command },
      note: isSidecarRuntimeEnabled()
        ? "Sidecar runtime enabled."
        : "Sidecar runtime disabled by FLAPSTACK_OPENCODE_SIDECAR_ENABLED=0.",
    }
  }),

  /**
   * Persisted OpenCode-backed run. The renderer wiring can subscribe to this
   * exactly like the existing harness streams; the server remains gated until
   * real provider credentials have passed the manual matrix.
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
        sessionId: z.string().optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<any>((emit) => {
        const existing = activeStreams.get(input.subChatId)
        if (existing) existing.controller.abort()

        const controller = new AbortController()
        const runId = input.runId || crypto.randomUUID()
        activeStreams.set(input.subChatId, { runId, controller })
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
          try {
            const db = getDatabase()
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
            const messagesWithPrompt = duplicate ? messages : [...messages, promptMessage]
            if (!duplicate) {
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
            const before = await captureCheckpoint(runId, input.cwd, "before")
            db.update(agentRuns)
              .set({ beforeCheckpointId: before.id })
              .where(eq(agentRuns.id, runId))
              .run()
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
            let text = ""
            let reasoning = ""
            let sawSidecarError = false
            const toolActivity: Array<{ name: string; id: string }> = []
            let sidecarSessionId: string | undefined

            for await (const event of runSidecarSession(
              {
                provider: input.provider,
                model: input.model,
                prompt: input.prompt,
                cwd: input.cwd,
                permissionMode,
                resumeSessionId: input.sessionId || subChat.sessionId || undefined,
                signal: controller.signal,
              },
              async (request) =>
                new Promise((resolve) => {
                  pendingApprovals.set(request.requestId, {
                    provider: input.provider,
                    runId,
                    permission: request.permission,
                    resolve,
                  })
                }),
            )) {
              if (event.kind === "session-start") {
                sidecarSessionId = event.sessionId
                db.update(subChats)
                  .set({ sessionId: event.sessionId, updatedAt: new Date() })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              }
              if (event.kind === "text-delta") text += event.delta
              if (event.kind === "reasoning-delta") reasoning += event.delta
              if (event.kind === "error") sawSidecarError = true
              if (event.kind === "tool-input-start") {
                toolActivity.push({ id: event.toolCallId, name: event.toolName })
              }
              if (event.kind === "permission-asked") {
                safeEmit({ type: "opencode-permission-request", ...event, runId })
              }
              for (const chunk of mapper.map(event)) safeEmit(chunk)
            }

            for (const chunk of mapper.finish()) safeEmit(chunk)
            const assistantParts = [
              ...(reasoning ? [{ type: "reasoning", text: reasoning, state: "done" }] : []),
              ...(text ? [{ type: "text", text, state: "done" }] : []),
            ]
            if (assistantParts.length > 0) {
              db.update(subChats)
                .set({
                  messages: JSON.stringify([
                    ...messagesWithPrompt,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      parts: assistantParts,
                      metadata: {
                        harness: input.provider,
                        model: input.model,
                        runId,
                        sessionId: sidecarSessionId,
                        permissionMode,
                        toolActivity,
                      },
                    },
                  ]),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }
            status = controller.signal.aborted
              ? "cancelled"
              : sawSidecarError
                ? "failure"
                : "success"
          } catch (error) {
            status = controller.signal.aborted ? "cancelled" : "failure"
            safeEmit({
              type: "error",
              errorText: error instanceof Error ? error.message : String(error),
            })
          } finally {
            for (const [requestId, approval] of pendingApprovals) {
              if (approval.runId === runId) {
                pendingApprovals.delete(requestId)
                approval.resolve({ reply: "reject", message: "Run ended before approval." })
              }
            }
            if (!completed) {
              completed = true
              try {
                const db = getDatabase()
                const after = await captureCheckpoint(runId, input.cwd, "after")
                await captureRunManifest(runId)
                db.update(agentRuns)
                  .set({ status, completedAt: new Date(), afterCheckpointId: after.id })
                  .where(eq(agentRuns.id, runId))
                  .run()
                db.update(subChats)
                  .set({ runStatus: status, updatedAt: new Date() })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              } catch (persistenceError) {
                console.error("[opencode] Failed to finalize run", persistenceError)
              }
            }
            if (activeStreams.get(input.subChatId)?.runId === runId) {
              activeStreams.delete(input.subChatId)
            }
            safeEmit({ type: "finish" })
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
      permission: approval.permission,
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
