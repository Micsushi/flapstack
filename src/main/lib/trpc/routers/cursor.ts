import { observable } from "@trpc/server/observable"
import { and, eq, ne } from "drizzle-orm"
import { spawn, type ChildProcess } from "node:child_process"
import { z } from "zod"
import {
  DEFAULT_CURSOR_MODEL_ID,
  formatCursorModelForCli,
  type CursorEffortLevel,
} from "../../../../shared/model-catalog"
import { captureCheckpoint, captureNoChangeManifest } from "../../checkpoints"
import { agentRuns, chats, getDatabase, subChats } from "../../db"
import {
  buildCursorEnv,
  CursorAgentNotFoundError,
  resolveCursorRunTimeoutMs,
  resolveCursorAgentBinary,
} from "../../cursor/binary"
import { buildCursorArgs } from "../../cursor/args"
import {
  getCursorIntegration,
  listCursorModels,
  normalizeCursorStatus,
} from "../../cursor/integration"
import {
  CursorStreamTranslator,
  isCursorAuthText,
  parseCursorStreamLine,
} from "../../cursor/stream"
import { findReusableCursorPromptMessage } from "../../cursor/turn"
import {
  buildHarnessContextBundle,
  getLastHarnessContextFingerprint,
  prependStartupContext,
} from "../../harness/launch-context"
import { getUsageSecret } from "../../usage/secrets"
import {
  buildCursorPermissionApplication,
  getGlobalDefault,
  parsePermissionMode,
  type PermissionMode,
} from "../../permissions"
import { publicProcedure, router } from "../index"

const HARNESS = "cursor-agent" as const

type CursorRunStatus = "success" | "failure" | "cancelled"

type ActiveCursorStream = {
  runId: string
  child: ChildProcess
  cancelRequested: boolean
  failureReason?: string
  killTimer?: ReturnType<typeof setTimeout>
  runTimeout?: ReturnType<typeof setTimeout>
}

const activeStreams = new Map<string, ActiveCursorStream>()
const devRunSubscriptions = new Map<string, { unsubscribe?: () => void }>()

function terminateCursorStream(stream: ActiveCursorStream): void {
  stream.cancelRequested = true
  const send = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && stream.child.pid) process.kill(-stream.child.pid, signal)
      else stream.child.kill(signal)
    } catch {
      stream.child.kill(signal)
    }
  }
  send("SIGTERM")
  if (stream.killTimer) clearTimeout(stream.killTimer)
  stream.killTimer = setTimeout(() => {
    if (stream.child.exitCode == null && stream.child.signalCode == null) send("SIGKILL")
  }, 2_000)
  stream.killTimer.unref?.()
}

export function hasActiveCursorStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllCursorStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[cursor] Aborting stream ${subChatId} before reload`)
    terminateCursorStream(stream)
  }
  // Keep each entry until its async finalizer observes cancelRequested. Clearing
  // here loses that signal and can incorrectly mark a killed run as successful.
}

export function cancelActiveCursorRun(input: { subChatId: string; runId: string }) {
  const activeStream = activeStreams.get(input.subChatId)
  if (!activeStream) return { cancelled: false, ignoredStale: false }
  if (activeStream.runId !== input.runId) return { cancelled: false, ignoredStale: true }

  terminateCursorStream(activeStream)
  return { cancelled: true, ignoredStale: false }
}

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildUserParts(
  prompt: string,
  images: Array<{ base64Data?: string; mediaType?: string; filename?: string }> | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]
  for (const image of images ?? []) {
    if (!image.base64Data || !image.mediaType) continue
    parts.push({
      type: "data-image",
      data: {
        base64Data: image.base64Data,
        mediaType: image.mediaType,
        filename: image.filename,
      },
    })
  }
  return parts
}

function getLastSessionId(messages: any[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant")
  const sessionId = lastAssistant?.metadata?.sessionId
  return typeof sessionId === "string" ? sessionId : undefined
}

function resolveCursorPermissionMode(params: {
  subChatPermissionMode?: string | null
  chatPermissionMode?: string | null
}): PermissionMode {
  return (
    parsePermissionMode(params.subChatPermissionMode) ||
    parsePermissionMode(params.chatPermissionMode) ||
    getGlobalDefault()
  )
}

/** Split a stored model id + optional `/effort` suffix into a CLI --model arg. */
function resolveCursorModelArg(model: string | undefined): { id: string; cliArg: string } {
  const raw = model?.trim() || DEFAULT_CURSOR_MODEL_ID
  const [base, effort] = raw.split("/")
  const cliArg = formatCursorModelForCli(base, effort as CursorEffortLevel | undefined)
  return { id: raw, cliArg }
}

async function createCursorRun(params: {
  runId: string
  chatId: string
  subChatId: string
  model: string
  permissionMode: PermissionMode
  customPermissions: string | null
  worktreePath: string | null
  promptMessageId?: string
}) {
  const db = getDatabase()
  const existingRun = db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  if (existingRun) return existingRun

  // Cancel stale running rows for this sub-chat (Codex fix pattern).
  db.update(agentRuns)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(agentRuns.subChatId, params.subChatId),
        eq(agentRuns.status, "running"),
        ne(agentRuns.id, params.runId),
      ),
    )
    .run()

  const run = db
    .insert(agentRuns)
    .values({
      id: params.runId,
      chatId: params.chatId,
      subChatId: params.subChatId,
      harness: HARNESS,
      model: params.model,
      permissionMode: params.permissionMode,
      customPermissions: params.customPermissions,
      worktreePath: params.worktreePath,
      promptMessageId: params.promptMessageId,
      status: "running",
    })
    .returning()
    .get()

  db.update(subChats)
    .set({
      harness: HARNESS,
      model: params.model,
      permissionMode: params.permissionMode,
      worktreePath: params.worktreePath,
      runStatus: "running",
      updatedAt: new Date(),
    })
    .where(eq(subChats.id, params.subChatId))
    .run()

  db.update(chats)
    .set({ harness: HARNESS, model: params.model })
    .where(eq(chats.id, params.chatId))
    .run()

  const before = await captureCheckpoint(run.id, params.worktreePath, "before")
  return db
    .update(agentRuns)
    .set({ beforeCheckpointId: before.id })
    .where(eq(agentRuns.id, run.id))
    .returning()
    .get()
}

async function completeCursorRun(params: {
  runId: string
  subChatId: string
  status: CursorRunStatus
}) {
  const db = getDatabase()
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  if (!run || run.completedAt) return run

  const after = await captureCheckpoint(run.id, run.worktreePath, "after")
  await captureNoChangeManifest(run.id)

  const completedRun = db
    .update(agentRuns)
    .set({ status: params.status, completedAt: new Date(), afterCheckpointId: after.id })
    .where(eq(agentRuns.id, params.runId))
    .returning()
    .get()

  const active = activeStreams.get(params.subChatId)
  if (active?.runId === params.runId) {
    db.update(subChats)
      .set({ runStatus: params.status, updatedAt: new Date() })
      .where(eq(subChats.id, params.subChatId))
      .run()
  }

  return completedRun
}

export const cursorRouter = router({
  getIntegration: publicProcedure.query(async () => {
    return await getCursorIntegration(getUsageSecret("cursor.api_key"))
  }),

  listModels: publicProcedure.query(async () => {
    const catalogFallback = [DEFAULT_CURSOR_MODEL_ID]
    const live = await listCursorModels(getUsageSecret("cursor.api_key"))
    return {
      models: live.length > 0 ? live : catalogFallback,
      source: live.length > 0 ? "cli" : "fallback",
    }
  }),

  isInstalled: publicProcedure.query(() => {
    return { installed: Boolean(resolveCursorAgentBinary()) }
  }),

  logout: publicProcedure.mutation(async () => {
    const { runCursorCli } = await import("../../cursor/binary")
    await runCursorCli(["logout"], { timeoutMs: 15_000 }).catch(() => undefined)
    const status = await runCursorCli(["status"], { timeoutMs: 15_000 })
    const combined = [status.stdout, status.stderr].join("\n").trim()
    const normalized = normalizeCursorStatus(combined)
    return {
      success: normalized.state !== "connected",
      state: normalized.state,
      rawOutput: combined,
    }
  }),

  startLogin: publicProcedure.mutation(async () => {
    const binary = resolveCursorAgentBinary()
    if (!binary) throw new CursorAgentNotFoundError()

    // cursor-agent login opens a browser OAuth flow. NO_OPEN_BROWSER lets the
    // renderer surface the URL instead; here we let it open and report exit.
    const child = spawn(binary, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildCursorEnv(),
      windowsHide: true,
    })

    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8")
    })

    const loginStart = await new Promise<{ url: string | null; error?: string }>(
      (resolvePromise) => {
        let settled = false
        const finish = (result: { url: string | null; error?: string }) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolvePromise(result)
        }
        const timer = setTimeout(() => finish({ url: null }), 8_000)
        const check = () => {
          const match = output.match(/https?:\/\/[^\s]+/)
          if (match) finish({ url: match[0] })
        }
        child.stdout.on("data", check)
        child.stderr.on("data", check)
        child.once("error", (error) => finish({ url: null, error: error.message }))
        child.once("close", (code) => {
          if (code !== 0)
            finish({
              url: null,
              error: output.trim() || `cursor-agent login exited with code ${code}`,
            })
        })
      },
    )

    return {
      started: !loginStart.error,
      url: loginStart.url,
      note: loginStart.error || "Complete the browser login, then re-check status.",
    }
  }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        reasoningEnabled: z.boolean().default(true),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        // Supersede any in-flight stream for this sub-chat.
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          terminateCursorStream(existingStream)
          activeStreams.delete(input.subChatId)
        }

        let isActive = true
        let runCompleted = false

        const safeEmit = (chunk: any): boolean => {
          if (!isActive) return false
          try {
            emit.next(chunk)
            return true
          } catch {
            isActive = false
            return false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion.
          }
        }

        const completeRunOnce = async (status: CursorRunStatus) => {
          if (runCompleted) return
          runCompleted = true
          try {
            await completeCursorRun({ runId: input.runId, subChatId: input.subChatId, status })
          } catch (error) {
            console.error("[cursor] Failed to complete run:", error)
          }
        }

        let child: ChildProcess | null = null
        let runStatus: CursorRunStatus = "failure"
        let activeStreamForRun: ActiveCursorStream | null = null

        ;(async () => {
          try {
            if (input.images && input.images.length > 0) {
              throw new Error(
                "Cursor image attachments are not supported yet. Remove the images and resend the prompt.",
              )
            }
            const binary = resolveCursorAgentBinary()
            if (!binary) throw new CursorAgentNotFoundError()

            const db = getDatabase()
            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()
            if (!existingSubChat) throw new Error("Sub-chat not found")

            const existingChat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
            if (!existingChat) throw new Error("Chat not found")

            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const persistedRunSnapshot = db
              .select({
                permissionMode: agentRuns.permissionMode,
                customPermissions: agentRuns.customPermissions,
              })
              .from(agentRuns)
              .where(eq(agentRuns.id, input.runId))
              .get()
            const permissionMode =
              parsePermissionMode(persistedRunSnapshot?.permissionMode) ??
              resolveCursorPermissionMode({
                subChatPermissionMode: existingSubChat.permissionMode,
                chatPermissionMode: existingChat.permissionMode,
              })
            const permissionApplication = buildCursorPermissionApplication({
              permissionMode,
              cwd: input.cwd,
            })
            const { id: metadataModel, cliArg: modelArg } = resolveCursorModelArg(input.model)

            const storedSessionId = getLastSessionId(existingMessages)
            if (input.sessionId && input.sessionId !== storedSessionId) {
              console.warn(`[cursor] Ignoring sessionId not stored on sub-chat ${input.subChatId}`)
            }
            const sessionId = input.forceNewSession ? undefined : storedSessionId
            const contextBundle = await buildHarnessContextBundle({
              cwd: input.cwd,
              projectPath: input.projectPath,
              harness: HARNESS,
              userPrompt: input.prompt,
              sessionMode: sessionId ? "resumed" : "new",
              previousSourceFingerprint: getLastHarnessContextFingerprint(existingMessages),
            })
            const promptForModel = prependStartupContext(input.prompt, contextBundle.context)

            // Persist the user message (dedupe a resent prompt like Codex).
            const reusablePromptMessage = findReusableCursorPromptMessage(
              existingMessages,
              input.prompt,
              input.forceNewSession === true,
            )
            const isDuplicatePrompt = Boolean(reusablePromptMessage)

            let messagesForStream = existingMessages
            let promptMessageId =
              typeof reusablePromptMessage?.id === "string" ? reusablePromptMessage.id : undefined

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: metadataModel },
              }
              promptMessageId = userMessage.id
              messagesForStream = [...existingMessages, userMessage]
              db.update(subChats)
                .set({ messages: JSON.stringify(messagesForStream), updatedAt: new Date() })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            await createCursorRun({
              runId: input.runId,
              chatId: input.chatId,
              subChatId: input.subChatId,
              model: metadataModel,
              permissionMode,
              customPermissions:
                permissionMode === "custom"
                  ? (persistedRunSnapshot?.customPermissions ?? existingChat.customPermissions)
                  : null,
              worktreePath: input.cwd || null,
              promptMessageId,
            })

            const args = buildCursorArgs({
              model: modelArg,
              cwd: input.cwd,
              permissionMode,
              sessionId,
              forceNewSession: input.forceNewSession,
            })

            child = spawn(binary, args, {
              stdio: ["pipe", "pipe", "pipe"],
              cwd: input.cwd,
              env: buildCursorEnv({
                CURSOR_API_KEY: getUsageSecret("cursor.api_key") ?? undefined,
              }),
              windowsHide: true,
              detached: process.platform !== "win32",
            })
            activeStreamForRun = {
              runId: input.runId,
              child,
              cancelRequested: false,
            }
            activeStreams.set(input.subChatId, activeStreamForRun)
            const runTimeoutMs = resolveCursorRunTimeoutMs()
            activeStreamForRun.runTimeout = setTimeout(() => {
              if (!activeStreamForRun || child?.exitCode != null || child?.signalCode != null)
                return
              activeStreamForRun.failureReason = `Cursor run timed out after ${runTimeoutMs}ms.`
              const timedOutStream = activeStreamForRun
              terminateCursorStream(timedOutStream)
              timedOutStream.cancelRequested = false
            }, runTimeoutMs)
            activeStreamForRun.runTimeout.unref?.()

            const startedAt = Date.now()
            const translator = new CursorStreamTranslator()
            let stdoutBuffer = ""
            let stderrBuffer = ""

            // Install the stream error boundary before writing. cursor-agent
            // can close stdin immediately; EPIPE must fail this run, not escape
            // as a process-wide uncaught exception.
            child.stdin?.on("error", (error) => {
              stderrBuffer += `\nstdin: ${error.message}`
            })
            child.stdin?.write(promptForModel)
            child.stdin?.end()

            const emitChunks = (chunks: any[]) => {
              for (const chunk of chunks) safeEmit(chunk)
            }

            child.stdout?.on("data", (data: Buffer) => {
              stdoutBuffer += data.toString("utf8")
              let newlineIndex = stdoutBuffer.indexOf("\n")
              while (newlineIndex !== -1) {
                const line = stdoutBuffer.slice(0, newlineIndex)
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
                const event = parseCursorStreamLine(line)
                if (event) emitChunks(translator.push(event))
                newlineIndex = stdoutBuffer.indexOf("\n")
              }
            })

            child.stderr?.on("data", (data: Buffer) => {
              stderrBuffer += data.toString("utf8")
            })

            const exitCode: number | null = await new Promise((resolveExit) => {
              child?.once("error", (error) => {
                stderrBuffer += `\n${error.message}`
                resolveExit(null)
              })
              child?.once("close", (code) => resolveExit(code))
            })

            // Flush any trailing buffered line + open blocks.
            const trailing = parseCursorStreamLine(stdoutBuffer)
            if (trailing) emitChunks(translator.push(trailing))
            emitChunks(translator.finish())

            const wasCancelled = activeStreamForRun?.cancelRequested === true

            if (activeStreamForRun?.failureReason) {
              runStatus = "failure"
              safeEmit({ type: "error", errorText: activeStreamForRun.failureReason })
            } else if (wasCancelled) {
              runStatus = "cancelled"
            } else if (translator.sawError()) {
              runStatus = "failure"
            } else if (exitCode === 0) {
              runStatus = "success"
            } else {
              runStatus = "failure"
              const errorText = stderrBuffer.trim() || `cursor-agent exited with code ${exitCode}`
              if (isCursorAuthText(errorText) || translator.sawAuthError()) {
                safeEmit({ type: "auth-error", errorText })
              } else {
                safeEmit({ type: "error", errorText })
              }
            }

            // Persist the assistant message if this run is still authoritative.
            const currentStream = activeStreams.get(input.subChatId)
            const isAuthoritative = currentStream?.runId === input.runId
            const metadata = translator.getMetadata()
            const parts = translator.getParts()
            if (isAuthoritative && parts.length > 0) {
              const assistantMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                parts,
                metadata: {
                  harness: HARNESS,
                  model: metadataModel,
                  permissionMode,
                  permissionApplication,
                  runId: input.runId,
                  sessionId: metadata.sessionId,
                  durationMs: metadata.durationMs ?? Date.now() - startedAt,
                  inputTokens: metadata.inputTokens,
                  outputTokens: metadata.outputTokens,
                  totalTokens: metadata.totalTokens,
                  resultSubtype: metadata.resultSubtype,
                  context: contextBundle.metadata,
                },
              }
              const latest = db
                .select({ messages: subChats.messages })
                .from(subChats)
                .where(eq(subChats.id, input.subChatId))
                .get()
              const latestMessages = parseStoredMessages(latest?.messages)
              db.update(subChats)
                .set({
                  messages: JSON.stringify([...latestMessages, assistantMessage]),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            safeEmit({
              type: "finish",
              messageMetadata: {
                harness: HARNESS,
                model: metadataModel,
                permissionMode,
                permissionApplication,
                runId: input.runId,
                sessionId: metadata.sessionId,
                durationMs: metadata.durationMs ?? Date.now() - startedAt,
                context: contextBundle.metadata,
                resultSubtype:
                  metadata.resultSubtype ?? (runStatus === "success" ? "success" : "error"),
              },
            })

            await completeRunOnce(runStatus)
            safeComplete()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            runStatus = "failure"
            console.error("[cursor] chat stream error:", error)
            if (isCursorAuthText(message)) {
              safeEmit({ type: "auth-error", errorText: message })
            } else {
              safeEmit({ type: "error", errorText: message })
            }
            await completeRunOnce(runStatus)
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            if (!runCompleted) {
              await completeRunOnce(activeStreamForRun?.cancelRequested ? "cancelled" : runStatus)
            }
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              if (activeStream.killTimer) clearTimeout(activeStream.killTimer)
              if (activeStream.runTimeout) clearTimeout(activeStream.runTimeout)
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            terminateCursorStream(activeStream)
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string() }))
    .mutation(({ input }) => cancelActiveCursorRun(input)),

  cleanup: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    const activeStream = activeStreams.get(input.subChatId)
    if (activeStream) {
      terminateCursorStream(activeStream)
      activeStreams.delete(input.subChatId)
    }
    const db = getDatabase()
    db.update(agentRuns)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(agentRuns.subChatId, input.subChatId), eq(agentRuns.status, "running")))
      .run()
    db.update(subChats)
      .set({ runStatus: "cancelled", updatedAt: new Date() })
      .where(and(eq(subChats.id, input.subChatId), eq(subChats.runStatus, "running")))
      .run()
    return { success: true }
  }),
})

export async function startCursorDevRun(input: {
  subChatId: string
  chatId: string
  model: string
  prompt: string
  cwd: string
  projectPath?: string
  forceNewSession?: boolean
}): Promise<{ runId: string }> {
  const runId = crypto.randomUUID()
  const stream = (await cursorRouter.createCaller({ getWindow: () => null }).chat({
    ...input,
    runId,
    reasoningEnabled: true,
  })) as unknown as {
    subscribe?: (observer: {
      next?: (value: unknown) => void
      error?: (error: unknown) => void
      complete?: () => void
    }) => { unsubscribe?: () => void }
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
  }

  const finish = () => devRunSubscriptions.delete(runId)
  if (typeof stream.subscribe === "function") {
    const subscription = stream.subscribe({
      error: (error) => {
        console.error(`[dev-mcp] Cursor run ${runId} failed`, error)
        finish()
      },
      complete: finish,
    })
    devRunSubscriptions.set(runId, subscription)
  } else if (stream[Symbol.asyncIterator]) {
    void (async () => {
      try {
        for await (const _chunk of stream as AsyncIterable<unknown>) {
          // Consuming the stream drives the production Cursor subscription lifecycle.
        }
      } catch (error) {
        console.error(`[dev-mcp] Cursor run ${runId} failed`, error)
      } finally {
        finish()
      }
    })()
  } else {
    throw new Error("Cursor chat subscription did not return a consumable stream")
  }

  return { runId }
}
