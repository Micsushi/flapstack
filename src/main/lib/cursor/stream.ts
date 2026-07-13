import type { UIMessageChunk } from "../claude/types"
import { normalizeCursorReasoningOutput } from "../../../shared/reasoning-output"

/**
 * cursor-agent stream-json translation (Stage 2 Track D / D2).
 *
 * `cursor-agent -p --output-format stream-json --stream-partial-output` emits
 * newline-delimited JSON events modeled on Claude Code's stream-json, plus
 * Cursor-specific `thinking` events. The exact schema iterates quickly and the
 * D0 fixture (`tests/fixtures/cursor-agent/`) is the source of truth, so this
 * translator is deliberately tolerant: it maps the shapes it recognizes into
 * Flapstack `UIMessageChunk`s and ignores everything else instead of throwing.
 *
 * Recognized events (best-effort, all fields optional):
 *   { "type": "system",   "subtype": "init", "session_id", "model", "cwd" }
 *   { "type": "assistant","message": { "content": [ { "type":"text","text" } ] } }
 *   { "type": "assistant","delta":   { "text" } }              // partial output
 *   { "type": "thinking", "subtype": "delta"|"completed", "text" }
 *   { "type": "tool_call","subtype": "started"|"completed", "call_id","name","input"|"result" }
 *   { "type": "result",   "subtype": "success"|"error", "result", "session_id", "duration_ms", "usage" }
 *   { "type": "error",    "message"|"error" }
 */

export type CursorRawEvent = Record<string, unknown>

export type CursorStreamMetadata = {
  sessionId?: string
  model?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  resultSubtype?: string
}

export type CursorAssistantPart =
  | { type: "text"; text: string; state: "done" }
  | { type: "reasoning"; text: string; state: "done" }
  | {
      type: string
      toolCallId: string
      toolName: string
      input?: unknown
      output?: unknown
      result?: unknown
      state: "call" | "result"
    }

const AUTH_PATTERNS = [
  /\bnot logged in\b/i,
  /\bplease log in\b/i,
  /\bauthentication required\b/i,
  /\bauth required\b/i,
  /\blogin required\b/i,
  /(?:^|\s|[:(])unauthorized(?:\s|$|[).,:])/i,
  /(?:^|\s|[:(])forbidden(?:\s|$|[).,:])/i,
  /\bcursor-agent login\b/i,
  /\bno credentials\b/i,
  /(?:^|\s|[:(])401(?:\s|$|[).,:])/,
  /(?:^|\s|[:(])403(?:\s|$|[).,:])/,
]

/** Parse one NDJSON line into a raw event, tolerating blank/partial lines. */
export function parseCursorStreamLine(line: string): CursorRawEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === "object" ? (parsed as CursorRawEvent) : null
  } catch {
    return null
  }
}

export function isCursorAuthText(text: string | null | undefined): boolean {
  if (!text) return false
  return AUTH_PATTERNS.some((pattern) => pattern.test(text))
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function assistantTextMode(event: CursorRawEvent): "incremental" | "cumulative" {
  const subtype = asString(event.subtype)?.toLowerCase()
  const message = asRecord(event.message)
  const hasCompletionReason =
    firstDefined(
      event.stop_reason,
      event.stopReason,
      event.finish_reason,
      event.finishReason,
      message?.stop_reason,
      message?.stopReason,
      message?.finish_reason,
      message?.finishReason,
    ) !== undefined
  if (
    event.is_final === true ||
    event.isFinal === true ||
    event.final === true ||
    hasCompletionReason ||
    (subtype && ["final", "complete", "completed", "finished", "result"].includes(subtype))
  ) {
    return "cumulative"
  }
  if (subtype && ["delta", "partial", "stream", "streaming", "update"].includes(subtype)) {
    return "incremental"
  }

  // Current cursor-agent marks streamed `message.content` chunks with a
  // timestamp, then emits the cumulative final message without one. Explicit
  // final markers above win if a newer Cursor release timestamps that message.
  if (event.timestamp_ms !== undefined || event.timestampMs !== undefined) {
    return "incremental"
  }

  return "cumulative"
}

/** Pull assistant text out of the several shapes cursor-agent can emit. */
function extractAssistantText(
  event: CursorRawEvent,
): { text: string; mode: "incremental" | "cumulative" } | undefined {
  const delta = event.delta as Record<string, unknown> | undefined
  const deltaText = asString(delta?.text)
  if (deltaText) return { text: deltaText, mode: "incremental" }

  const message = event.message as Record<string, unknown> | undefined
  const directText = asString(message?.text) ?? asString(event.text)
  if (directText) return { text: directText, mode: assistantTextMode(event) }

  const content = message?.content ?? event.content
  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (part): part is Record<string, unknown> =>
          Boolean(part) && typeof part === "object" && (part as any).type === "text",
      )
      .map((part) => asString(part.text))
      .filter((text): text is string => Boolean(text))
    if (textParts.length > 0) {
      return { text: textParts.join(""), mode: assistantTextMode(event) }
    }
  }

  return undefined
}

type NormalizedCursorToolEvent = {
  callId: string
  name: string
  input?: unknown
  output?: unknown
  isResult: boolean
}

function toolNameFromPayloadKey(key: string): string | undefined {
  if (!/(?:_?tool_?call)$/i.test(key)) return undefined
  const name = key.replace(/(?:_?tool_?call)$/i, "")
  if (!name) return undefined
  return name[0].toLowerCase() + name.slice(1)
}

/** Normalize both historical flat events and current nested Cursor tool envelopes. */
function normalizeCursorToolEvent(event: CursorRawEvent): NormalizedCursorToolEvent {
  const envelope = asRecord(event.tool_call) ?? asRecord(event.toolCall) ?? asRecord(event.tool)
  const payloadEntry = envelope
    ? Object.entries(envelope).find(
        ([key, value]) => Boolean(toolNameFromPayloadKey(key)) && Boolean(asRecord(value)),
      )
    : undefined
  const payload = asRecord(payloadEntry?.[1])

  const callId =
    asString(event.call_id) ??
    asString(event.callId) ??
    asString(event.id) ??
    asString(envelope?.toolCallId) ??
    asString(envelope?.call_id) ??
    asString(envelope?.callId) ??
    asString(payload?.toolCallId) ??
    asString(payload?.call_id) ??
    asString(payload?.callId) ??
    nextId("tool")
  const name =
    asString(event.name) ??
    asString(event.tool_name) ??
    asString(event.toolName) ??
    asString(event.tool) ??
    asString(envelope?.name) ??
    asString(envelope?.tool_name) ??
    asString(envelope?.toolName) ??
    asString(payload?.name) ??
    (payloadEntry ? toolNameFromPayloadKey(payloadEntry[0]) : undefined) ??
    "tool"
  const input = firstDefined(
    event.input,
    event.arguments,
    event.args,
    envelope?.input,
    envelope?.arguments,
    envelope?.args,
    payload?.input,
    payload?.arguments,
    payload?.args,
  )
  const output = firstDefined(
    event.output,
    event.result,
    envelope?.output,
    envelope?.result,
    payload?.output,
    payload?.result,
  )
  const subtype = asString(event.subtype)?.toLowerCase()
  const isResult =
    output !== undefined ||
    Boolean(
      subtype &&
      ["completed", "complete", "finished", "result", "failed", "error"].includes(subtype),
    )

  return { callId, name, input, output, isResult }
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `cursor-${prefix}-${idCounter}`
}

/**
 * Stateful translator. Feed it raw events with `push()`; it returns the
 * `UIMessageChunk`s to emit and accumulates the assistant `parts` + metadata
 * that the router persists to `subChats.messages` on completion.
 */
export class CursorStreamTranslator {
  private textId: string | null = null
  private accumulatedText = ""
  private emittedText = ""
  private currentAssistantText = ""
  private hasEmittedText = false
  private reasoningId: string | null = null
  private reasoningText = ""
  private readonly reasoningIdsWithDeltas = new Set<string>()
  private readonly parts: CursorAssistantPart[] = []
  private readonly metadata: CursorStreamMetadata = {}
  private authErrorSeen = false
  private errorSeen = false

  push(event: CursorRawEvent): UIMessageChunk[] {
    const type = asString(event.type)
    if (!type) return []

    switch (type) {
      case "system":
        return this.handleSystem(event)
      case "assistant":
      case "message":
        return this.handleAssistant(event)
      case "thinking":
      case "reasoning":
        return this.handleReasoningOutput(event)
      case "tool_call":
      case "tool":
        return this.handleToolCall(event)
      case "result":
        return this.handleResult(event)
      case "error":
        return this.handleError(event)
      default:
        return []
    }
  }

  /** Flush any open text/reasoning blocks. Call once the process closes. */
  finish(): UIMessageChunk[] {
    return this.closeOpenBlocks()
  }

  getParts(): CursorAssistantPart[] {
    return this.parts
  }

  getMetadata(): CursorStreamMetadata {
    return this.metadata
  }

  sawAuthError(): boolean {
    return this.authErrorSeen
  }

  /** True when the structured stream reports failure, even if the process exits zero. */
  sawError(): boolean {
    return this.errorSeen
  }

  private handleSystem(event: CursorRawEvent): UIMessageChunk[] {
    this.metadata.sessionId = asString(event.session_id) ?? this.metadata.sessionId
    this.metadata.model = asString(event.model) ?? this.metadata.model
    return []
  }

  private handleAssistant(event: CursorRawEvent): UIMessageChunk[] {
    const assistantText = extractAssistantText(event)
    if (!assistantText) return []
    const { text } = assistantText

    const chunks: UIMessageChunk[] = []
    // Close a pending reasoning block before assistant text starts.
    chunks.push(...this.closeReasoning())

    // `--stream-partial-output` may send cumulative text or incremental deltas.
    // Emit only the newly-added suffix; fall back to the whole chunk on reset.
    let delta = text
    if (assistantText.mode === "cumulative") {
      if (this.emittedText && text.startsWith(this.emittedText)) {
        // Some Cursor versions emit a cumulative answer for the full run.
        delta = text.slice(this.emittedText.length)
      } else if (this.currentAssistantText && text.startsWith(this.currentAssistantText)) {
        // Current Cursor emits a cumulative final for only the post-tool model
        // call. Compare against that segment so pre-tool progress text does not
        // make the final answer appear new.
        delta = text.slice(this.currentAssistantText.length)
      } else if (
        (this.emittedText && this.emittedText.endsWith(text)) ||
        (this.currentAssistantText && this.currentAssistantText.endsWith(text))
      ) {
        delta = ""
      }
    }
    this.emittedText += delta
    this.currentAssistantText += delta
    this.accumulatedText += delta

    if (!delta) return chunks

    if (!this.textId) {
      this.textId = nextId("text")
      chunks.push({ type: "text-start", id: this.textId })
    }
    chunks.push({ type: "text-delta", id: this.textId, delta })
    this.hasEmittedText = true
    return chunks
  }

  private handleReasoningOutput(event: CursorRawEvent): UIMessageChunk[] {
    // Keep Cursor's live stream on Track T's provider contract. The emitted AI
    // SDK chunks remain `reasoning-*` so the existing incremental renderer and
    // persisted message shape keep working, but an unknown/malformed provider
    // event can no longer invent display content outside the shared contract.
    const [reasoningOutput] = normalizeCursorReasoningOutput(event)
    if (!reasoningOutput) return []

    if (reasoningOutput.phase === "final") {
      // Some Cursor versions emit only a completed reasoning event. Preserve
      // that text when no deltas were seen, while avoiding duplicate final text
      // after an incremental stream.
      const chunks: UIMessageChunk[] = []
      const hadStreamedDeltas = this.reasoningIdsWithDeltas.delete(reasoningOutput.id)
      if (!this.reasoningId && reasoningOutput.text && !hadStreamedDeltas) {
        this.reasoningId = nextId("reasoning")
        this.reasoningText = reasoningOutput.text
        chunks.push({ type: "reasoning-start", id: this.reasoningId })
        chunks.push({ type: "reasoning-delta", id: this.reasoningId, delta: reasoningOutput.text })
      }
      chunks.push(...this.closeReasoning())
      return chunks
    }

    const text = reasoningOutput.text
    if (!text) return []
    this.reasoningIdsWithDeltas.add(reasoningOutput.id)

    const chunks: UIMessageChunk[] = []
    if (!this.reasoningId) {
      this.reasoningId = nextId("reasoning")
      chunks.push({ type: "reasoning-start", id: this.reasoningId })
    }
    this.reasoningText += text
    // Track T5 finalizes reasoning-output rendering; emit the documented reasoning delta.
    chunks.push({ type: "reasoning-delta", id: this.reasoningId, delta: text })
    return chunks
  }

  private handleToolCall(event: CursorRawEvent): UIMessageChunk[] {
    const { callId, name, input, output, isResult } = normalizeCursorToolEvent(event)

    // Assistant text/reasoning blocks must close before a tool part.
    const chunks: UIMessageChunk[] = this.closeOpenBlocks()
    this.currentAssistantText = ""

    if (isResult) {
      const existing = this.parts.find(
        (part) => "toolCallId" in part && part.toolCallId === callId,
      ) as Extract<CursorAssistantPart, { toolCallId: string }> | undefined
      if (existing) {
        existing.output = output
        existing.result = output
        existing.state = "result"
      } else {
        this.parts.push({
          type: `tool-${name}`,
          toolCallId: callId,
          toolName: name,
          output,
          result: output,
          state: "result",
        })
      }
      chunks.push({ type: "tool-output-available", toolCallId: callId, output })
      return chunks
    }

    this.parts.push({
      type: `tool-${name}`,
      toolCallId: callId,
      toolName: name,
      input,
      state: "call",
    })
    chunks.push({ type: "tool-input-available", toolCallId: callId, toolName: name, input })
    return chunks
  }

  private handleResult(event: CursorRawEvent): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = this.closeOpenBlocks()

    this.metadata.sessionId = asString(event.session_id) ?? this.metadata.sessionId
    this.metadata.durationMs = asNumber(event.duration_ms) ?? this.metadata.durationMs
    this.metadata.resultSubtype = asString(event.subtype) ?? this.metadata.resultSubtype
    if (
      this.metadata.resultSubtype &&
      ["error", "failed", "failure"].includes(this.metadata.resultSubtype.toLowerCase())
    ) {
      this.errorSeen = true
    }

    const resultText = asString(event.result)
    if (this.errorSeen) {
      const errorText = resultText || "cursor-agent reported a failed result."
      if (isCursorAuthText(errorText)) {
        this.authErrorSeen = true
        return [...chunks, { type: "auth-error", errorText }]
      }
      return [...chunks, { type: "error", errorText }]
    }

    const usage = event.usage as Record<string, unknown> | undefined
    if (usage) {
      // Current cursor-agent emits camelCase fields while older captures used
      // snake_case. Accept both so persisted run usage stays accurate across
      // CLI releases.
      this.metadata.inputTokens =
        asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? this.metadata.inputTokens
      this.metadata.outputTokens =
        asNumber(usage.output_tokens) ?? asNumber(usage.outputTokens) ?? this.metadata.outputTokens
      this.metadata.totalTokens =
        asNumber(usage.total_tokens) ?? asNumber(usage.totalTokens) ?? this.metadata.totalTokens
    }

    // A trailing `result` string is the final answer for non-partial output; if
    // we never streamed text, surface it so the reply is never empty.
    if (resultText && !this.hasEmittedText) {
      const id = nextId("text")
      chunks.push({ type: "text-start", id })
      chunks.push({ type: "text-delta", id, delta: resultText })
      chunks.push({ type: "text-end", id })
      this.hasEmittedText = true
      this.parts.push({ type: "text", text: resultText, state: "done" })
    }

    return chunks
  }

  private handleError(event: CursorRawEvent): UIMessageChunk[] {
    const message =
      asString(event.message) ??
      asString(event.error) ??
      asString((event.error as any)?.message) ??
      "cursor-agent returned an error."
    this.errorSeen = true
    if (isCursorAuthText(message)) {
      this.authErrorSeen = true
      return [{ type: "auth-error", errorText: message }]
    }
    return [{ type: "error", errorText: message }]
  }

  private closeOpenBlocks(): UIMessageChunk[] {
    return [...this.closeText(), ...this.closeReasoning()]
  }

  private closeText(): UIMessageChunk[] {
    if (!this.textId) return []
    const chunks: UIMessageChunk[] = [{ type: "text-end", id: this.textId }]
    if (this.accumulatedText.trim()) {
      this.parts.push({ type: "text", text: this.accumulatedText, state: "done" })
    }
    this.textId = null
    this.accumulatedText = ""
    return chunks
  }

  private closeReasoning(): UIMessageChunk[] {
    if (!this.reasoningId) return []
    const id = this.reasoningId
    if (this.reasoningText.trim()) {
      this.parts.push({ type: "reasoning", text: this.reasoningText, state: "done" })
    }
    this.reasoningId = null
    this.reasoningText = ""
    return [{ type: "reasoning-end", id }]
  }
}
