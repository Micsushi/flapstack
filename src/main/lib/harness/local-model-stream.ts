import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { UIMessageChunk } from "../claude/types"
import { agentRuns, chats, subChats } from "../db/schema"
import type * as schema from "../db/schema"
import type { LocalModelRunMetadata } from "../../../shared/local-model-contract"
import type { RunPermissionMode } from "../../../shared/harness-types"
import { buildHarnessContextBundle, type HarnessContextBundle } from "./launch-context"
import { getOllamaEndpointConfig, type OllamaEndpointConfig } from "./local-model-catalog"

const DEFAULT_STREAM_TIMEOUT_MS = 120_000
const DEFAULT_TRANSCRIPT_CHARS = 48_000
const LOCAL_TEXT_PART_ID = "local-response"

type AppDatabase = BetterSQLite3Database<typeof schema>

export type LocalModelTranscriptMessage = {
  id: string
  role: "user" | "assistant"
  parts: Array<{ type: string; text?: string }>
  metadata?: Record<string, unknown>
}

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type NormalizedLocalModelEvent =
  | { kind: "text-delta"; delta: string }
  | {
      kind: "done"
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      reason?: string
    }

export type LocalModelTerminalStatus = "success" | "failure" | "cancelled"

export type LocalModelRunPersistence = {
  loadTranscript(subChatId: string): LocalModelTranscriptMessage[]
  begin(input: LocalModelPersistedRunStart): void
  appendAssistantText(input: {
    subChatId: string
    streamId: string
    assistantMessageId: string
    delta: string
  }): boolean
  finalize(input: LocalModelPersistedRunFinish): void
  recoverAbandoned(now?: Date): number
}

export type LocalModelPersistedRunStart = {
  runId: string
  streamId: string
  chatId: string
  subChatId: string
  prompt: string
  promptMessageId: string
  assistantMessageId: string
  model: string
  permissionMode: RunPermissionMode
  customPermissions: string | null
  worktreePath: string | null
  metadata: LocalModelRunMetadata
  context: HarnessContextBundle["metadata"]
}

export type LocalModelPersistedRunFinish = {
  runId: string
  streamId: string
  subChatId: string
  assistantMessageId: string
  status: LocalModelTerminalStatus
  errorCode?: LocalModelStreamErrorCode
  errorText?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  completedAt?: Date
}

export type StreamLocalModelChatInput = {
  runId?: string
  chatId: string
  subChatId: string
  prompt: string
  model: string
  permissionMode: RunPermissionMode
  customPermissions?: string | null
  cwd: string
  projectPath?: string
  worktreePath?: string | null
  metadata: LocalModelRunMetadata
  endpoint?: OllamaEndpointConfig
  timeoutMs?: number
  maxTranscriptChars?: number
}

export type LocalModelChatServiceDependencies = {
  persistence: LocalModelRunPersistence
  fetchImpl?: typeof fetch
  buildContext?: (input: StreamLocalModelChatInput) => Promise<HarnessContextBundle>
  now?: () => number
}

export type LocalModelReconnectResult = {
  reconnectable: false
  reason: "ordinary-streams-are-not-resumable"
  message: string
}

export type LocalModelStreamErrorCode =
  | "provider-unavailable"
  | "provider-endpoint-error"
  | "provider-timeout"
  | "provider-response-invalid"
  | "provider-disconnected"
  | "abandoned-stream"
  | "consumer-disconnected"
  | "run-not-startable"

const SAFE_ERROR_TEXT: Record<LocalModelStreamErrorCode, string> = {
  "provider-unavailable": "Ollama is not reachable on the configured local endpoint.",
  "provider-endpoint-error": "Ollama rejected the local chat request.",
  "provider-timeout": "The local model response timed out.",
  "provider-response-invalid": "Ollama returned an invalid streaming response.",
  "provider-disconnected": "The local model stream disconnected before completion.",
  "abandoned-stream": "The local model stream was abandoned when Flapstack stopped.",
  "consumer-disconnected": "The local model stream ended when its consumer disconnected.",
  "run-not-startable": "This local model run is already active or terminal and cannot resume.",
}

class LocalModelStreamError extends Error {
  constructor(readonly code: LocalModelStreamErrorCode) {
    super(SAFE_ERROR_TEXT[code])
  }
}

export class LocalModelChatService {
  private readonly activeByRun = new Map<string, AbortController>()
  private readonly activeRunBySubChat = new Map<string, string>()

  constructor(private readonly dependencies: LocalModelChatServiceDependencies) {}

  stream(input: StreamLocalModelChatInput): AsyncGenerator<UIMessageChunk> {
    return this.run(input)
  }

  cancel(runId: string): boolean {
    const controller = this.activeByRun.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  reconnect(_runId: string): LocalModelReconnectResult {
    return {
      reconnectable: false,
      reason: "ordinary-streams-are-not-resumable",
      message: "Local model streams cannot reconnect after their owning process exits.",
    }
  }

  recoverAbandoned(now = new Date()): number {
    return this.dependencies.persistence.recoverAbandoned(now)
  }

  private async *run(input: StreamLocalModelChatInput): AsyncGenerator<UIMessageChunk> {
    const runId = input.runId ?? randomUUID()
    const streamId = randomUUID()
    const promptMessageId = randomUUID()
    const assistantMessageId = randomUUID()
    const controller = new AbortController()
    const previousRunId = this.activeRunBySubChat.get(input.subChatId)
    if (previousRunId) this.activeByRun.get(previousRunId)?.abort()
    this.activeRunBySubChat.set(input.subChatId, runId)
    this.activeByRun.set(runId, controller)

    const timeoutMs = boundedPositive(input.timeoutMs, DEFAULT_STREAM_TIMEOUT_MS, 100, 600_000)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let began = false
    let terminal = false
    let textStarted = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let usage: LocalModelPersistedRunFinish["usage"]

    try {
      const transcript = this.dependencies.persistence.loadTranscript(input.subChatId)
      const context = await (this.dependencies.buildContext ?? defaultContextBuilder)(input)
      this.dependencies.persistence.begin({
        runId,
        streamId,
        chatId: input.chatId,
        subChatId: input.subChatId,
        prompt: input.prompt,
        promptMessageId,
        assistantMessageId,
        model: input.model,
        permissionMode: input.permissionMode,
        customPermissions: input.customPermissions ?? null,
        worktreePath: input.worktreePath ?? input.cwd,
        metadata: input.metadata,
        context: context.metadata,
      })
      began = true

      const endpoint = input.endpoint ?? getOllamaEndpointConfig()
      const response = await raceAbort(
        (this.dependencies.fetchImpl ?? fetch)(`${endpoint.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            stream: true,
            messages: assembleLocalModelMessages({
              context: context.context,
              transcript,
              prompt: input.prompt,
              maxTranscriptChars: input.maxTranscriptChars,
            }),
          }),
          signal: controller.signal,
        }),
        controller.signal,
      )
      if (!response.ok) throw new LocalModelStreamError("provider-endpoint-error")
      if (!response.body) throw new LocalModelStreamError("provider-response-invalid")

      reader = response.body.getReader()
      yield { type: "start", messageId: assistantMessageId }
      yield { type: "text-start", id: LOCAL_TEXT_PART_ID }
      textStarted = true

      let sawDone = false
      for await (const event of readOllamaChatEvents(reader, controller.signal)) {
        if (event.kind === "text-delta") {
          const persisted = this.dependencies.persistence.appendAssistantText({
            subChatId: input.subChatId,
            streamId,
            assistantMessageId,
            delta: event.delta,
          })
          if (!persisted) throw new LocalModelStreamError("consumer-disconnected")
          yield { type: "text-delta", id: LOCAL_TEXT_PART_ID, delta: event.delta }
          continue
        }
        sawDone = true
        usage = {
          ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
          ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
          ...(event.totalTokens !== undefined ? { totalTokens: event.totalTokens } : {}),
        }
      }
      if (!sawDone) throw new LocalModelStreamError("provider-disconnected")

      this.dependencies.persistence.finalize({
        runId,
        streamId,
        subChatId: input.subChatId,
        assistantMessageId,
        status: "success",
        usage,
        completedAt: new Date((this.dependencies.now ?? Date.now)()),
      })
      terminal = true
      yield { type: "text-end", id: LOCAL_TEXT_PART_ID }
      if (usage && Object.keys(usage).length > 0) {
        yield { type: "message-metadata", messageMetadata: usage }
      }
      yield { type: "finish", messageMetadata: usage }
    } catch (error) {
      const cancelled = controller.signal.aborted && !timedOut
      const streamError = normalizeStreamError(error, timedOut)
      if (began) {
        this.dependencies.persistence.finalize({
          runId,
          streamId,
          subChatId: input.subChatId,
          assistantMessageId,
          status: cancelled ? "cancelled" : "failure",
          ...(!cancelled ? { errorCode: streamError.code, errorText: streamError.message } : {}),
          completedAt: new Date((this.dependencies.now ?? Date.now)()),
        })
      }
      terminal = true
      if (textStarted) yield { type: "text-end", id: LOCAL_TEXT_PART_ID }
      if (!cancelled) yield { type: "error", errorText: streamError.message }
      yield { type: "finish" }
    } finally {
      clearTimeout(timer)
      if (!terminal && began) {
        controller.abort()
        const errorCode = "consumer-disconnected"
        this.dependencies.persistence.finalize({
          runId,
          streamId,
          subChatId: input.subChatId,
          assistantMessageId,
          status: "failure",
          errorCode,
          errorText: SAFE_ERROR_TEXT[errorCode],
          completedAt: new Date((this.dependencies.now ?? Date.now)()),
        })
      }
      if (reader) void reader.cancel().catch(() => undefined)
      this.activeByRun.delete(runId)
      if (this.activeRunBySubChat.get(input.subChatId) === runId) {
        this.activeRunBySubChat.delete(input.subChatId)
      }
    }
  }
}

export function assembleLocalModelMessages(input: {
  context: string
  transcript: readonly LocalModelTranscriptMessage[]
  prompt: string
  maxTranscriptChars?: number
}): OllamaChatMessage[] {
  const maxChars = boundedPositive(
    input.maxTranscriptChars,
    DEFAULT_TRANSCRIPT_CHARS,
    1_000,
    500_000,
  )
  const transcript = input.transcript
    .map(toOllamaTranscriptMessage)
    .filter((message): message is OllamaChatMessage => Boolean(message))

  const selected: OllamaChatMessage[] = []
  let used = input.prompt.length
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index]!
    if (used + message.content.length > maxChars) break
    selected.unshift(message)
    used += message.content.length
  }

  return [
    ...(input.context.trim() ? [{ role: "system" as const, content: input.context.trim() }] : []),
    ...selected,
    { role: "user", content: input.prompt },
  ]
}

export function parseOllamaChatLine(line: string): NormalizedLocalModelEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new LocalModelStreamError("provider-response-invalid")
  }
  if (!isRecord(parsed)) {
    throw new LocalModelStreamError("provider-response-invalid")
  }
  if (typeof parsed.error === "string") {
    throw new LocalModelStreamError("provider-endpoint-error")
  }
  if (typeof parsed.done !== "boolean") {
    throw new LocalModelStreamError("provider-response-invalid")
  }

  const events: NormalizedLocalModelEvent[] = []
  if (isRecord(parsed.message) && Array.isArray(parsed.message.tool_calls)) {
    throw new LocalModelStreamError("provider-response-invalid")
  }
  if (isRecord(parsed.message) && typeof parsed.message.content === "string") {
    if (parsed.message.content) events.push({ kind: "text-delta", delta: parsed.message.content })
  } else if (!parsed.done) {
    throw new LocalModelStreamError("provider-response-invalid")
  }
  if (parsed.done) {
    const inputTokens = nonNegativeInteger(parsed.prompt_eval_count)
    const outputTokens = nonNegativeInteger(parsed.eval_count)
    events.push({
      kind: "done",
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(inputTokens !== undefined && outputTokens !== undefined
        ? { totalTokens: inputTokens + outputTokens }
        : {}),
      ...(typeof parsed.done_reason === "string" ? { reason: parsed.done_reason } : {}),
    })
  }
  return events
}

export function createDatabaseLocalModelRunPersistence(db: AppDatabase): LocalModelRunPersistence {
  return {
    loadTranscript(subChatId) {
      const row = db
        .select({ messages: subChats.messages })
        .from(subChats)
        .where(eq(subChats.id, subChatId))
        .get()
      return parseTranscript(row?.messages)
    },
    begin(input) {
      db.transaction((tx) => {
        const existingRun = tx
          .select({ id: agentRuns.id, status: agentRuns.status })
          .from(agentRuns)
          .where(eq(agentRuns.id, input.runId))
          .get()
        if (existingRun && existingRun.status !== "pending") {
          throw new LocalModelStreamError("run-not-startable")
        }
        const existingSubChat = tx
          .select({ messages: subChats.messages })
          .from(subChats)
          .where(eq(subChats.id, input.subChatId))
          .get()
        if (!existingSubChat) throw new Error("Local model sub-chat does not exist.")

        const messages = parseTranscript(existingSubChat.messages)
        if (!messages.some((message) => message.id === input.promptMessageId)) {
          messages.push({
            id: input.promptMessageId,
            role: "user",
            parts: [{ type: "text", text: input.prompt }],
            metadata: { runId: input.runId },
          })
        }
        if (!messages.some((message) => message.id === input.assistantMessageId)) {
          messages.push({
            id: input.assistantMessageId,
            role: "assistant",
            parts: [{ type: "text", text: "" }],
            metadata: {
              runId: input.runId,
              localModel: input.metadata,
              context: input.context,
              streamState: "streaming",
            },
          })
        }

        const runValues = {
          chatId: input.chatId,
          subChatId: input.subChatId,
          harness: "local",
          model: input.model,
          permissionMode: input.permissionMode,
          customPermissions: input.customPermissions,
          worktreePath: input.worktreePath,
          promptMessageId: input.promptMessageId,
          initialPrompt: input.prompt,
          status: "running",
          completedAt: null,
        }
        if (existingRun) {
          tx.update(agentRuns).set(runValues).where(eq(agentRuns.id, input.runId)).run()
        } else {
          tx.insert(agentRuns)
            .values({ id: input.runId, ...runValues })
            .run()
        }
        tx.update(subChats)
          .set({
            streamId: input.streamId,
            sessionId: null,
            harness: "local",
            model: input.model,
            permissionMode: input.permissionMode,
            worktreePath: input.worktreePath,
            runStatus: "running",
            messages: JSON.stringify(messages),
            updatedAt: new Date(),
          })
          .where(eq(subChats.id, input.subChatId))
          .run()
        tx.update(chats)
          .set({ harness: "local", model: input.model })
          .where(eq(chats.id, input.chatId))
          .run()
      })
    },
    appendAssistantText(input) {
      const row = db
        .select({ messages: subChats.messages })
        .from(subChats)
        .where(and(eq(subChats.id, input.subChatId), eq(subChats.streamId, input.streamId)))
        .get()
      if (!row) return false
      const messages = parseTranscript(row.messages)
      const message = messages.find((candidate) => candidate.id === input.assistantMessageId)
      const textPart = message?.parts.find((part) => part.type === "text")
      if (!message || !textPart) return false
      textPart.text = `${textPart.text ?? ""}${input.delta}`
      const updated = db
        .update(subChats)
        .set({ messages: JSON.stringify(messages), updatedAt: new Date() })
        .where(and(eq(subChats.id, input.subChatId), eq(subChats.streamId, input.streamId)))
        .run()
      return updated.changes === 1
    },
    finalize(input) {
      const completedAt = input.completedAt ?? new Date()
      db.transaction((tx) => {
        const row = tx
          .select({ messages: subChats.messages, streamId: subChats.streamId })
          .from(subChats)
          .where(eq(subChats.id, input.subChatId))
          .get()
        if (row) {
          const isAuthoritativeStream = row.streamId === input.streamId
          const messages = parseTranscript(row.messages)
          const message = messages.find((candidate) => candidate.id === input.assistantMessageId)
          if (message) {
            message.metadata = {
              ...(message.metadata ?? {}),
              streamState: input.status,
              ...(input.errorCode ? { errorCode: input.errorCode } : {}),
              ...(input.errorText ? { errorText: input.errorText } : {}),
              ...(input.usage ? input.usage : {}),
            }
          }
          tx.update(subChats)
            .set({
              messages: JSON.stringify(messages),
              ...(isAuthoritativeStream ? { streamId: null, runStatus: input.status } : {}),
              updatedAt: completedAt,
            })
            .where(eq(subChats.id, input.subChatId))
            .run()
        }
        tx.update(agentRuns)
          .set({ status: input.status, completedAt })
          .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.status, "running")))
          .run()
      })
    },
    recoverAbandoned(now = new Date()) {
      const abandoned = db
        .select({ id: agentRuns.id, subChatId: agentRuns.subChatId })
        .from(agentRuns)
        .where(and(eq(agentRuns.harness, "local"), eq(agentRuns.status, "running")))
        .all()
      for (const run of abandoned) {
        db.update(agentRuns)
          .set({ status: "failure", completedAt: now })
          .where(and(eq(agentRuns.id, run.id), eq(agentRuns.status, "running")))
          .run()
        if (run.subChatId) {
          const row = db
            .select({ messages: subChats.messages })
            .from(subChats)
            .where(eq(subChats.id, run.subChatId))
            .get()
          const messages = parseTranscript(row?.messages)
          const assistant = messages.find(
            (message) => message.role === "assistant" && message.metadata?.runId === run.id,
          )
          if (assistant) {
            assistant.metadata = {
              ...(assistant.metadata ?? {}),
              streamState: "failure",
              errorCode: "abandoned-stream",
              errorText: SAFE_ERROR_TEXT["abandoned-stream"],
            }
          }
          db.update(subChats)
            .set({
              messages: JSON.stringify(messages),
              streamId: null,
              sessionId: null,
              updatedAt: now,
            })
            .where(eq(subChats.id, run.subChatId))
            .run()
          updateLocalSubChatStatusIfAuthoritative(db, {
            runId: run.id,
            subChatId: run.subChatId,
            status: "failure",
            updatedAt: now,
          })
        }
      }
      return abandoned.length
    },
  }
}

async function defaultContextBuilder(
  input: StreamLocalModelChatInput,
): Promise<HarnessContextBundle> {
  return buildHarnessContextBundle({
    cwd: input.cwd,
    projectPath: input.projectPath,
    harness: "local",
    userPrompt: input.prompt,
    sessionMode: "new",
    providerNativeInstructions: false,
  })
}

async function* readOllamaChatEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<NormalizedLocalModelEvent> {
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const result = await raceAbort(reader.read(), signal)
    buffer += decoder.decode(result.value, { stream: !result.done })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      for (const event of parseOllamaChatLine(line)) yield event
    }
    if (result.done) break
  }
  const trailing = buffer.trim()
  if (trailing) {
    for (const event of parseOllamaChatLine(trailing)) yield event
  }
}

function toOllamaTranscriptMessage(message: LocalModelTranscriptMessage): OllamaChatMessage | null {
  const content = message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
  return content ? { role: message.role, content } : null
}

function parseTranscript(value: string | null | undefined): LocalModelTranscriptMessage[] {
  try {
    const parsed = JSON.parse(value || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTranscriptMessage)
  } catch {
    return []
  }
}

function isTranscriptMessage(value: unknown): value is LocalModelTranscriptMessage {
  if (!isRecord(value) || typeof value.id !== "string") return false
  if (value.role !== "user" && value.role !== "assistant") return false
  return Array.isArray(value.parts)
}

function normalizeStreamError(error: unknown, timedOut: boolean): LocalModelStreamError {
  if (timedOut) return new LocalModelStreamError("provider-timeout")
  if (error instanceof LocalModelStreamError) return error
  return new LocalModelStreamError("provider-unavailable")
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

function boundedPositive(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)))
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function updateLocalSubChatStatusIfAuthoritative(
  db: AppDatabase,
  input: { runId: string; subChatId: string; status: string; updatedAt: Date },
): void {
  db.update(subChats)
    .set({
      runStatus: input.status,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(subChats.id, input.subChatId),
        sql`NOT EXISTS (
          SELECT 1
          FROM agent_runs newer
          JOIN agent_runs current ON current.id = ${input.runId}
          WHERE newer.sub_chat_id = ${input.subChatId}
            AND (
              newer.started_at > current.started_at OR
              (newer.started_at = current.started_at AND newer.id > current.id)
            )
        )`,
      ),
    )
    .run()
}
