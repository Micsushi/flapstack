import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { UIMessageChunk } from "../claude/types"
import { agentRuns, chats, subChats } from "../db/schema"
import { getDatabase } from "../db"
import { captureCheckpoint, captureRunManifest } from "../checkpoints"
import { McpApprovalLifecycle } from "../mcp-control/approval-lifecycle"
import { createSqliteMcpApprovalCoordinator } from "../mcp-control/approval-coordinator"
import { publishProductMcpInvalidation } from "../mcp-control/invalidation-bridge"
import type * as schema from "../db/schema"
import type { LocalModelRunMetadata } from "../../../shared/local-model-contract"
import type { RunPermissionMode } from "../../../shared/harness-types"
import { parseCustomPermissionCapabilities } from "../../../shared/permission-capabilities"
import { buildHarnessContextBundle, type HarnessContextBundle } from "./launch-context"
import { getOllamaEndpointConfig, type OllamaEndpointConfig } from "./local-model-catalog"
import {
  createReadOnlyLocalModelToolExecutor,
  LocalModelToolLoopError,
  runBoundedLocalModelToolLoop,
  type LocalModelLoopMessage,
  type LocalModelProviderTurnEvent,
  type LocalModelReadToolExecutor,
  type LocalModelToolEvidence,
  type LocalModelToolLoopLimits,
  type LocalModelToolProvider,
} from "./local-model-read-tools"
import { LOCAL_MODEL_READ_TOOL_SCHEMAS } from "./local-model-read-tools"
import {
  createProjectLocalModelWriteToolExecutor,
  LOCAL_MODEL_WRITE_TOOL_NAMES,
  LOCAL_MODEL_WRITE_TOOL_SCHEMAS,
  type LocalModelWriteApprovalRequest,
  type LocalModelWriteApprovalDecision,
  type LocalModelWriteToolOptions,
} from "./local-model-write-tools"

const DEFAULT_STREAM_TIMEOUT_MS = 120_000
const DEFAULT_TRANSCRIPT_CHARS = 48_000
const LOCAL_TEXT_PART_ID = "local-response"

type AppDatabase = BetterSQLite3Database<typeof schema>

export type LocalModelTranscriptMessage = {
  id: string
  role: "user" | "assistant"
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  metadata?: Record<string, unknown>
}

export type OllamaChatMessage = LocalModelLoopMessage

export type NormalizedLocalModelEvent = LocalModelProviderTurnEvent

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
  appendToolEvidence(input: {
    subChatId: string
    streamId: string
    assistantMessageId: string
    evidence: LocalModelToolEvidence
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
  toolLoopLimits?: Partial<LocalModelToolLoopLimits>
}

export type LocalModelChatServiceDependencies = {
  persistence: LocalModelRunPersistence
  fetchImpl?: typeof fetch
  buildContext?: (input: StreamLocalModelChatInput) => Promise<HarnessContextBundle>
  createReadToolExecutor?: (rootPath: string) => LocalModelReadToolExecutor
  createWriteToolExecutor?: (options: LocalModelWriteToolOptions) => LocalModelReadToolExecutor
  createWriteApprovalSession?: () => LocalModelWriteApprovalSession
  runChanges?: LocalModelRunChangeTracker
  now?: () => number
}

export type LocalModelWriteApprovalSession = {
  request(input: LocalModelWriteApprovalRequest): Promise<LocalModelWriteApprovalDecision>
  shutdown(): void
}

export type LocalModelRunChangeTracker = {
  captureBefore(runId: string, worktreePath: string): Promise<void>
  captureAfterAndManifest(runId: string, worktreePath: string): Promise<void>
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
  | "change-tracking-failed"
  | LocalModelToolLoopError["code"]

const SAFE_ERROR_TEXT: Record<LocalModelStreamErrorCode, string> = {
  "provider-unavailable": "Ollama is not reachable on the configured local endpoint.",
  "provider-endpoint-error": "Ollama rejected the local chat request.",
  "provider-timeout": "The local model response timed out.",
  "provider-response-invalid": "Ollama returned an invalid streaming response.",
  "provider-disconnected": "The local model stream disconnected before completion.",
  "abandoned-stream": "The local model stream was abandoned when Flapstack stopped.",
  "consumer-disconnected": "The local model stream ended when its consumer disconnected.",
  "run-not-startable": "This local model run is already active or terminal and cannot resume.",
  "change-tracking-failed": "The local model run could not preserve recoverable change evidence.",
  "tool-iteration-limit": "The local model tool loop reached its iteration limit.",
  "tool-call-limit": "The local model tool loop reached its tool-call limit.",
  "tool-context-limit": "The local model tool loop reached its context limit.",
  "tool-output-limit": "The local model tool loop reached its output limit.",
  "tool-time-limit": "The local model tool loop reached its wall-time limit.",
  "tool-recursion-limit": "The local model repeated the same tool call too many times.",
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
    let usage: LocalModelPersistedRunFinish["usage"]
    let approvalSession: LocalModelWriteApprovalSession | undefined
    let changeTrackingStarted = false
    let changeTrackingAttempted = false
    const worktreePath = input.worktreePath ?? input.cwd
    const runChanges = this.dependencies.runChanges ?? defaultLocalModelRunChangeTracker

    const finishChangeTracking = async () => {
      if (!changeTrackingStarted || changeTrackingAttempted) return
      changeTrackingAttempted = true
      try {
        await runChanges.captureAfterAndManifest(runId, worktreePath)
      } catch {
        throw new LocalModelStreamError("change-tracking-failed")
      }
    }

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

      const writeToolsEnabled = localWriteToolsEnabled(input)
      if (writeToolsEnabled) {
        try {
          await runChanges.captureBefore(runId, worktreePath)
          changeTrackingStarted = true
        } catch {
          throw new LocalModelStreamError("change-tracking-failed")
        }
      }

      const endpoint = input.endpoint ?? getOllamaEndpointConfig()
      const messages = assembleLocalModelMessages({
        context: context.context,
        transcript,
        prompt: input.prompt,
        maxTranscriptChars: input.maxTranscriptChars,
      })
      const toolsEnabled = localReadToolsEnabled(input.metadata)
      const tools = writeToolsEnabled
        ? [...LOCAL_MODEL_READ_TOOL_SCHEMAS, ...LOCAL_MODEL_WRITE_TOOL_SCHEMAS]
        : LOCAL_MODEL_READ_TOOL_SCHEMAS
      const provider = createOllamaToolProvider({
        endpoint,
        model: input.model,
        fetchImpl: this.dependencies.fetchImpl ?? fetch,
      })
      const executor = toolsEnabled
        ? (this.dependencies.createReadToolExecutor?.(worktreePath) ??
          createReadOnlyLocalModelToolExecutor({ rootPath: worktreePath }))
        : undefined
      let toolExecutor = executor
      if (writeToolsEnabled && executor) {
        if (input.permissionMode === "ask-before-edits") {
          approvalSession =
            this.dependencies.createWriteApprovalSession?.() ??
            createLocalModelWriteApprovalSession()
        }
        const writer =
          this.dependencies.createWriteToolExecutor?.({
            rootPath: worktreePath,
            runId,
            chatId: input.chatId,
            permissionMode: input.permissionMode,
            projectWriteAllowed: true,
            requestApproval: approvalSession?.request,
          }) ??
          createProjectLocalModelWriteToolExecutor({
            rootPath: worktreePath,
            runId,
            chatId: input.chatId,
            permissionMode: input.permissionMode,
            projectWriteAllowed: true,
            requestApproval: approvalSession?.request,
          })
        toolExecutor = {
          execute: (call, signal) =>
            LOCAL_MODEL_WRITE_TOOL_NAMES.includes(
              call.name as (typeof LOCAL_MODEL_WRITE_TOOL_NAMES)[number],
            )
              ? writer.execute(call, signal)
              : executor.execute(call, signal),
        }
      }

      yield { type: "start", messageId: assistantMessageId }

      let sawDone = false
      for await (const event of runBoundedLocalModelToolLoop({
        runId,
        messages,
        toolsEnabled,
        tools,
        provider,
        executor: toolExecutor,
        signal: controller.signal,
        limits: {
          ...input.toolLoopLimits,
          maxWallTimeMs: Math.min(input.toolLoopLimits?.maxWallTimeMs ?? timeoutMs, timeoutMs),
        },
        now: this.dependencies.now,
      })) {
        if (event.kind === "text-delta") {
          if (!textStarted) {
            yield { type: "text-start", id: LOCAL_TEXT_PART_ID }
            textStarted = true
          }
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
        if (event.kind === "tool-input" || event.kind === "tool-output") {
          const persisted = this.dependencies.persistence.appendToolEvidence({
            subChatId: input.subChatId,
            streamId,
            assistantMessageId,
            evidence: event.evidence,
          })
          if (!persisted) throw new LocalModelStreamError("consumer-disconnected")
          if (event.kind === "tool-input") {
            yield {
              type: "tool-input-start",
              toolCallId: event.evidence.callId,
              toolName: event.evidence.tool,
            }
            yield {
              type: "tool-input-available",
              toolCallId: event.evidence.callId,
              toolName: event.evidence.tool,
              input: event.evidence.input,
            }
          } else if (event.evidence.result?.ok) {
            yield {
              type: "tool-output-available",
              toolCallId: event.evidence.callId,
              output: event.evidence.result,
            }
          } else {
            yield {
              type: "tool-output-error",
              toolCallId: event.evidence.callId,
              errorText: event.evidence.result?.content ?? "The read-only tool failed safely.",
            }
          }
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

      await finishChangeTracking()
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
      if (textStarted) yield { type: "text-end", id: LOCAL_TEXT_PART_ID }
      if (usage && Object.keys(usage).length > 0) {
        yield { type: "message-metadata", messageMetadata: usage }
      }
      yield { type: "finish", messageMetadata: usage }
    } catch (error) {
      const cancelled = controller.signal.aborted && !timedOut
      let streamError = normalizeStreamError(error, timedOut)
      try {
        await finishChangeTracking()
      } catch (trackingError) {
        streamError = normalizeStreamError(trackingError, false)
      }
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
      approvalSession?.shutdown()
      if (!terminal && began) {
        controller.abort()
        let errorCode: LocalModelStreamErrorCode = "consumer-disconnected"
        try {
          await finishChangeTracking()
        } catch {
          errorCode = "change-tracking-failed"
        }
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
  if (isRecord(parsed.message)) {
    if (parsed.message.tool_calls !== undefined && !Array.isArray(parsed.message.tool_calls)) {
      throw new LocalModelStreamError("provider-response-invalid")
    }
    if (typeof parsed.message.content === "string" && parsed.message.content) {
      events.push({ kind: "text-delta", delta: parsed.message.content })
    }
    if (Array.isArray(parsed.message.tool_calls)) {
      for (const rawCall of parsed.message.tool_calls) {
        const call = isRecord(rawCall) ? rawCall : {}
        const fn = isRecord(call.function) ? call.function : {}
        events.push({
          kind: "tool-call",
          call: {
            id: call.id,
            name: fn.name,
            arguments: fn.arguments,
          },
        })
      }
    }
  } else if (!parsed.done) {
    throw new LocalModelStreamError("provider-response-invalid")
  }
  if (!parsed.done && events.length === 0) {
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

function createOllamaToolProvider(input: {
  endpoint: OllamaEndpointConfig
  model: string
  fetchImpl: typeof fetch
}): LocalModelToolProvider {
  return {
    async *streamTurn(request) {
      const response = await raceAbort(
        input.fetchImpl(`${input.endpoint.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            stream: true,
            messages: request.messages.map(toOllamaRequestMessage),
            ...(request.tools.length > 0 ? { tools: request.tools } : {}),
          }),
          signal: request.signal,
        }),
        request.signal,
      )
      if (!response.ok) throw new LocalModelStreamError("provider-endpoint-error")
      if (!response.body) throw new LocalModelStreamError("provider-response-invalid")
      const reader = response.body.getReader()
      try {
        let sawDone = false
        for await (const event of readOllamaChatEvents(reader, request.signal)) {
          if (event.kind === "done") sawDone = true
          yield event
        }
        if (!sawDone) throw new LocalModelStreamError("provider-disconnected")
      } finally {
        void reader.cancel().catch(() => undefined)
      }
    },
  }
}

function toOllamaRequestMessage(message: LocalModelLoopMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
    ...(message.toolName ? { tool_name: message.toolName } : {}),
  }
}

function localReadToolsEnabled(metadata: LocalModelRunMetadata): boolean {
  return (
    metadata.capabilities.tools.state === "supported" &&
    metadata.permission.toolTiers.some((tier) => tier.tier === "read" && tier.available)
  )
}

function localWriteToolsEnabled(input: StreamLocalModelChatInput): boolean {
  const metadata = input.metadata
  if (
    metadata.capabilities.tools.state !== "supported" ||
    metadata.permission.mode !== input.permissionMode ||
    !metadata.permission.toolTiers.some((tier) => tier.tier === "project-write" && tier.available)
  ) {
    return false
  }
  if (input.permissionMode === "read-only") return false
  if (input.permissionMode !== "custom") return true
  let parsed: unknown
  try {
    parsed = JSON.parse(input.customPermissions ?? "null")
  } catch {
    return false
  }
  const persisted = parseCustomPermissionCapabilities(parsed)
  return Boolean(
    persisted?.projectWrite && metadata.permission.customPermissions?.projectWrite === true,
  )
}

const defaultLocalModelRunChangeTracker: LocalModelRunChangeTracker = {
  async captureBefore(runId, worktreePath) {
    const before = await captureCheckpoint(runId, worktreePath, "before")
    getDatabase()
      .update(agentRuns)
      .set({ beforeCheckpointId: before.id })
      .where(eq(agentRuns.id, runId))
      .run()
  },
  async captureAfterAndManifest(runId, worktreePath) {
    const after = await captureCheckpoint(runId, worktreePath, "after")
    getDatabase()
      .update(agentRuns)
      .set({ afterCheckpointId: after.id })
      .where(eq(agentRuns.id, runId))
      .run()
    await captureRunManifest(runId)
  },
}

function createLocalModelWriteApprovalSession(): LocalModelWriteApprovalSession {
  const publishApprovalChange = () => {
    void publishProductMcpInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["approvals"],
    })
  }
  const lifecycle = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase(), publishApprovalChange),
    publishApprovalChange,
  )
  return {
    request: async (input) => {
      const id = randomUUID()
      const cancel = () => lifecycle.cancel(id)
      input.signal.addEventListener("abort", cancel, { once: true })
      try {
        const wait = lifecycle.request({
          id,
          invocationId: id,
          caller: { chatId: input.chatId, runId: input.runId },
          toolName: `local_model.${input.tool}`,
          tier: 2,
          input: {
            path: input.path,
            callId: input.callId,
            expectedSha256: input.expectedSha256,
            nextSha256: input.nextSha256,
            byteLength: input.byteLength,
          },
        })
        if (input.signal.aborted) lifecycle.cancel(id)
        const decision = await wait.decision
        if (decision.state === "approved") return "approved"
        if (decision.state === "denied") return "denied"
        if (decision.state === "timed-out") return "timed-out"
        return "cancelled"
      } finally {
        input.signal.removeEventListener("abort", cancel)
      }
    },
    shutdown: () => lifecycle.shutdown(),
  }
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
    appendToolEvidence(input) {
      const row = db
        .select({ messages: subChats.messages })
        .from(subChats)
        .where(and(eq(subChats.id, input.subChatId), eq(subChats.streamId, input.streamId)))
        .get()
      if (!row) return false
      const messages = parseTranscript(row.messages)
      const message = messages.find((candidate) => candidate.id === input.assistantMessageId)
      if (!message) return false

      const evidenceRows = Array.isArray(message.metadata?.toolEvidence)
        ? message.metadata.toolEvidence.filter(isRecord)
        : []
      const evidenceIndex = evidenceRows.findIndex(
        (candidate) => candidate.callId === input.evidence.callId,
      )
      if (evidenceIndex >= 0) evidenceRows[evidenceIndex] = input.evidence
      else evidenceRows.push(input.evidence)
      message.metadata = { ...(message.metadata ?? {}), toolEvidence: evidenceRows.slice(-256) }

      let part = message.parts.find((candidate) => candidate.toolCallId === input.evidence.callId)
      if (!part) {
        part = {
          type: `tool-${input.evidence.tool}`,
          toolCallId: input.evidence.callId,
          toolName: input.evidence.tool,
          input: input.evidence.input,
          state: "call",
          startedAt: Date.parse(input.evidence.startedAt),
        }
        message.parts.push(part)
      }
      if (input.evidence.result) {
        if (input.evidence.result.ok) {
          part.result = input.evidence.result
          part.output = input.evidence.result
          part.state = "result"
        } else {
          part.errorText = input.evidence.result.content
          part.state = "error"
        }
        part.completedAt = input.evidence.completedAt
          ? Date.parse(input.evidence.completedAt)
          : undefined
      }

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
              ...(row.streamId === input.streamId ? { streamId: null } : {}),
              updatedAt: completedAt,
            })
            .where(eq(subChats.id, input.subChatId))
            .run()
        }
        tx.update(agentRuns)
          .set({ status: input.status, completedAt })
          .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.status, "running")))
          .run()
        updateLocalSubChatStatusIfAuthoritative(tx, {
          runId: input.runId,
          subChatId: input.subChatId,
          status: input.status,
          updatedAt: completedAt,
        })
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
  if (error instanceof LocalModelToolLoopError) return new LocalModelStreamError(error.code)
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
