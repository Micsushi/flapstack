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
import { buildHarnessStartupContext, prependStartupContext } from "../../harness/launch-context"
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
}

const activeStreams = new Map<string, ActiveCursorStream>()

export function hasActiveCursorStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllCursorStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[cursor] Aborting stream ${subChatId} before reload`)
    stream.cancelRequested = true
    stream.child.kill("SIGTERM")
  }
  // Keep each entry until its async finalizer observes cancelRequested. Clearing
  // here loses that signal and can incorrectly mark a killed run as successful.
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

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""
  const textParts: string[] = []
  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content" && typeof part.content === "string") {
      const fileName = part.filePath?.split("/").pop() || part.filePath || "file"
      textParts.push(`\n--- ${fileName} ---\n${part.content}`)
    }
  }
  return textParts.join("\n")
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

  db.update(subChats)
    .set({ runStatus: params.status, updatedAt: new Date() })
    .where(eq(subChats.id, params.subChatId))
    .run()

  return completedRun
}

export const cursorRouter = router({
  getIntegration: publicProcedure.query(async () => {
    return await getCursorIntegration()
  }),

  listModels: publicProcedure.query(async () => {
    const catalogFallback = [DEFAULT_CURSOR_MODEL_ID]
    const live = await listCursorModels()
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

    const urlMatch = await new Promise<string | null>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(null), 8_000)
      const check = () => {
        const match = output.match(/https?:\/\/[^\s]+/)
        if (match) {
          clearTimeout(timer)
          resolvePromise(match[0])
        }
      }
      child.stdout.on("data", check)
      child.stderr.on("data", check)
    })

    return {
      started: true,
      url: urlMatch,
      note: "Complete the browser login, then re-check status.",
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
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        // Supersede any in-flight stream for this sub-chat.
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.child.kill("SIGTERM")
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
            const permissionMode = resolveCursorPermissionMode({
              subChatPermissionMode: existingSubChat.permissionMode,
              chatPermissionMode: existingChat.permissionMode,
            })
            const permissionApplication = buildCursorPermissionApplication({
              permissionMode,
              cwd: input.cwd,
            })
            const { id: metadataModel, cliArg: modelArg } = resolveCursorModelArg(input.model)

            const startupContext = await buildHarnessStartupContext({
              cwd: input.cwd,
              projectPath: input.projectPath,
              harness: HARNESS,
            })
            const promptForModel = prependStartupContext(input.prompt, startupContext)

            // Persist the user message (dedupe a resent prompt like Codex).
            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
            let promptMessageId =
              isDuplicatePrompt && typeof lastMessage?.id === "string" ? lastMessage.id : undefined

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
              worktreePath: input.cwd || null,
              promptMessageId,
            })

            const sessionId = input.forceNewSession
              ? undefined
              : (input.sessionId ?? getLastSessionId(existingMessages))
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
              env: buildCursorEnv(),
              windowsHide: true,
            })
            activeStreamForRun = {
              runId: input.runId,
              child,
              cancelRequested: false,
            }
            activeStreams.set(input.subChatId, activeStreamForRun)

            // Feed the prompt over stdin to avoid argv length limits.
            child.stdin?.write(promptForModel)
            child.stdin?.end()

            const startedAt = Date.now()
            const translator = new CursorStreamTranslator()
            let stdoutBuffer = ""
            let stderrBuffer = ""

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

            if (wasCancelled) {
              runStatus = "cancelled"
            } else if (translator.sawAuthError()) {
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
            const isAuthoritative = !currentStream || currentStream.runId === input.runId
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
                },
              }
              db.update(subChats)
                .set({
                  messages: JSON.stringify([...messagesForStream, assistantMessage]),
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
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
            activeStream.child.kill("SIGTERM")
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string() }))
    .mutation(({ input }) => {
      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) return { cancelled: false, ignoredStale: false }
      if (activeStream.runId !== input.runId) return { cancelled: false, ignoredStale: true }

      activeStream.cancelRequested = true
      activeStream.child.kill("SIGTERM")
      return { cancelled: true, ignoredStale: false }
    }),

  cleanup: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    const activeStream = activeStreams.get(input.subChatId)
    if (activeStream) {
      activeStream.cancelRequested = true
      activeStream.child.kill("SIGTERM")
      activeStreams.delete(input.subChatId)
    }
    return { success: true }
  }),
})
