import type { UIMessageChunk } from "../claude/types"

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

const AUTH_HINTS = [
  "not logged in",
  "please log in",
  "authentication required",
  "auth required",
  "login required",
  "unauthorized",
  "forbidden",
  "cursor-agent login",
  "no credentials",
  "401",
  "403",
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
  const normalized = text.toLowerCase()
  return AUTH_HINTS.some((hint) => normalized.includes(hint))
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Pull assistant text out of the several shapes cursor-agent can emit. */
function extractAssistantText(event: CursorRawEvent): string | undefined {
  const delta = event.delta as Record<string, unknown> | undefined
  const deltaText = asString(delta?.text)
  if (deltaText) return deltaText

  const message = event.message as Record<string, unknown> | undefined
  const directText = asString(message?.text) ?? asString(event.text)
  if (directText) return directText

  const content = message?.content ?? event.content
  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (part): part is Record<string, unknown> =>
          Boolean(part) && typeof part === "object" && (part as any).type === "text",
      )
      .map((part) => asString(part.text))
      .filter((text): text is string => Boolean(text))
    if (textParts.length > 0) return textParts.join("")
  }

  return undefined
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
  private hasEmittedText = false
  private reasoningId: string | null = null
  private reasoningText = ""
  private readonly parts: CursorAssistantPart[] = []
  private readonly metadata: CursorStreamMetadata = {}
  private authErrorSeen = false

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
        return this.handleThinking(event)
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

  private handleSystem(event: CursorRawEvent): UIMessageChunk[] {
    this.metadata.sessionId = asString(event.session_id) ?? this.metadata.sessionId
    this.metadata.model = asString(event.model) ?? this.metadata.model
    return []
  }

  private handleAssistant(event: CursorRawEvent): UIMessageChunk[] {
    const text = extractAssistantText(event)
    if (!text) return []

    const chunks: UIMessageChunk[] = []
    // Close a pending reasoning block before assistant text starts.
    chunks.push(...this.closeReasoning())

    // `--stream-partial-output` may send cumulative text or incremental deltas.
    // Emit only the newly-added suffix; fall back to the whole chunk on reset.
    let delta = text
    if (text.startsWith(this.accumulatedText) && text.length >= this.accumulatedText.length) {
      delta = text.slice(this.accumulatedText.length)
      this.accumulatedText = text
    } else {
      this.accumulatedText += text
    }

    if (!delta) return chunks

    if (!this.textId) {
      this.textId = nextId("text")
      chunks.push({ type: "text-start", id: this.textId })
    }
    chunks.push({ type: "text-delta", id: this.textId, delta })
    this.hasEmittedText = true
    return chunks
  }

  private handleThinking(event: CursorRawEvent): UIMessageChunk[] {
    const subtype = asString(event.subtype)
    if (subtype === "completed") {
      return this.closeReasoning()
    }

    const text = asString(event.text) ?? asString((event.delta as any)?.text)
    if (!text) return []

    const chunks: UIMessageChunk[] = []
    if (!this.reasoningId) {
      this.reasoningId = nextId("reasoning")
      chunks.push({ type: "reasoning-start", id: this.reasoningId })
    }
    this.reasoningText += text
    // Track T5 finalizes Thinking rendering; emit the documented reasoning delta.
    chunks.push({ type: "reasoning-delta", id: this.reasoningId, delta: text })
    return chunks
  }

  private handleToolCall(event: CursorRawEvent): UIMessageChunk[] {
    const callId = asString(event.call_id) ?? asString(event.id) ?? nextId("tool")
    const name = asString(event.name) ?? asString(event.tool) ?? "tool"
    const subtype = asString(event.subtype)

    // Assistant text/reasoning blocks must close before a tool part.
    const chunks: UIMessageChunk[] = this.closeOpenBlocks()

    if (subtype === "completed" || "result" in event || "output" in event) {
      const output = event.result ?? event.output
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

    const input = event.input ?? event.arguments
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
    const resultText = asString(event.result)
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
