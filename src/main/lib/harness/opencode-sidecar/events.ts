/**
 * OpenCode SSE event bridge + thinking normalization (Track E — E4).
 *
 * Two pure pieces, both unit-testable without a running server:
 *  1. `parseSseChunk` — incremental SSE framing (id/event/data lines).
 *  2. `normalizeOpencodeEvent` — one raw OpenCode event -> NormalizedSidecarEvent.
 *
 * Reasoning handling maps OpenRouter (`reasoning`, `reasoning_details`) and
 * NanoGPT (`reasoning`, legacy `reasoning_content`) visible reasoning into the
 * shared Thinking contract. Encrypted / provider-private reasoning is preserved
 * only as opaque metadata upstream — never fabricated here.
 */

import type { NormalizedSidecarEvent, SidecarUsage } from "./contract"

export type SseEvent = { id?: string; event?: string; data: string }

/**
 * Incremental SSE parser. Feed it raw text chunks; it returns any complete
 * events and retains the trailing partial frame in `buffer` for the next call.
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { buffer: string; events: SseEvent[] } {
  const combined = buffer + chunk
  const frames = combined.split(/\n\n/)
  // The last element is an incomplete frame (or empty) — keep it buffered.
  const remainder = frames.pop() ?? ""
  const events: SseEvent[] = []

  for (const frame of frames) {
    if (!frame.trim()) continue
    const evt: SseEvent = { data: "" }
    const dataLines: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue // comment
      const colon = line.indexOf(":")
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
      if (field === "id") evt.id = value
      else if (field === "event") evt.event = value
      else if (field === "data") dataLines.push(value)
    }
    evt.data = dataLines.join("\n")
    if (evt.data) events.push(evt)
  }

  return { buffer: remainder, events }
}

function pointer(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return cur
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** Extract the sessionID an event belongs to, across the known event shapes. */
export function eventSessionId(event: Record<string, unknown>): string | undefined {
  const type = asString(event.type)
  const props = ["properties"]
  switch (type) {
    case "message.updated":
      return asString(pointer(event, [...props, "info", "sessionID"]))
    case "message.part.updated":
    case "message.part.delta":
      return (
        asString(pointer(event, [...props, "part", "sessionID"])) ??
        asString(pointer(event, [...props, "sessionID"]))
      )
    default:
      return (
        asString(pointer(event, [...props, "sessionID"])) ??
        asString(pointer(event, [...props, "info", "sessionID"])) ??
        asString(pointer(event, [...props, "part", "sessionID"]))
      )
  }
}

function extractUsage(event: Record<string, unknown>): SidecarUsage | undefined {
  const tokens = pointer(event, ["properties", "info", "tokens"]) as
    Record<string, unknown> | undefined
  const cost = asNumber(pointer(event, ["properties", "info", "cost"]))
  const generationId = asString(pointer(event, ["properties", "info", "id"]))
  if (!tokens && cost === undefined) return undefined

  const input = asNumber(tokens?.input)
  const output = asNumber(tokens?.output)
  const reasoning = asNumber(tokens?.reasoning)
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    ...(cost !== undefined ? { costUsd: cost } : {}),
    ...(generationId ? { generationId } : {}),
    costQuality: cost !== undefined ? "provider-reported" : "estimated",
  }
}

/**
 * Normalize one parsed OpenCode event into zero-or-more Flapstack events.
 * Returns an array because a single OpenCode event (e.g. a part update carrying
 * both text and reasoning) can fan out.
 */
export function normalizeOpencodeEvent(event: Record<string, unknown>): NormalizedSidecarEvent[] {
  return new OpencodeEventNormalizer().normalize(event)
}

/**
 * Stateful normalizer for one OpenCode session. OpenCode emits a compact
 * `message.part.delta` shape and later full part updates; tracking part kinds
 * and text prevents reasoning from being rendered as prose or duplicated.
 */
export class OpencodeEventNormalizer {
  private readonly partKinds = new Map<string, string>()
  private readonly partText = new Map<string, string>()

  normalize(event: Record<string, unknown>): NormalizedSidecarEvent[] {
    const type = asString(event.type)
    if (!type) return []
    const out: NormalizedSidecarEvent[] = []

    switch (type) {
      case "message.part.delta": {
        const part = pointer(event, ["properties", "part"])
        // Compatibility with older server payloads that included the full part.
        if (part && typeof part === "object")
          return this.normalizePartUpdate(part as Record<string, unknown>)

        const partId = asString(pointer(event, ["properties", "partID"]))
        const field = asString(pointer(event, ["properties", "field"]))
        const delta = asString(pointer(event, ["properties", "delta"]))
        if (!partId || !field || !delta) break
        const kind = this.partKinds.get(partId)
        const isReasoning = kind === "reasoning" || field.startsWith("reasoning")
        this.partText.set(partId, (this.partText.get(partId) ?? "") + delta)
        out.push(
          isReasoning
            ? { kind: "reasoning-delta", partId, delta }
            : { kind: "text-delta", partId, delta },
        )
        break
      }
      case "message.part.updated": {
        const part = (pointer(event, ["properties", "part"]) ?? {}) as Record<string, unknown>
        out.push(...this.normalizePartUpdate(part))
        break
      }
      case "message.updated": {
        const usage = extractUsage(event)
        if (usage) out.push({ kind: "usage", usage })
        break
      }
      case "session.idle":
        out.push({ kind: "idle" })
        break
      case "session.status": {
        const status = asString(pointer(event, ["properties", "status", "type"]))
        if (status?.toLowerCase() === "idle") out.push({ kind: "idle" })
        break
      }
      case "session.error": {
        const name =
          asString(pointer(event, ["properties", "error", "name"])) ??
          asString(pointer(event, ["properties", "error", "type"])) ??
          "unknown"
        const message =
          asString(pointer(event, ["properties", "error", "data", "message"])) ??
          asString(pointer(event, ["properties", "error", "message"])) ??
          "OpenCode session error"
        out.push({ kind: "error", errorText: message, auth: name === "ProviderAuthError" })
        break
      }
      case "permission.asked": {
        const requestId = asString(pointer(event, ["properties", "id"])) ?? ""
        const toolCallId = asString(pointer(event, ["properties", "tool", "callID"])) ?? requestId
        const permission = asString(pointer(event, ["properties", "permission"])) ?? "tool"
        if (requestId) {
          out.push({ kind: "permission-asked", requestId, toolCallId, permission })
        }
        break
      }
      default:
        break
    }

    return out
  }

  private normalizePartUpdate(part: Record<string, unknown>): NormalizedSidecarEvent[] {
    const out: NormalizedSidecarEvent[] = []
    const partType = asString(part.type)
    const partId = asString(part.id) ?? asString(part.partID) ?? "part"
    if (partType) this.partKinds.set(partId, partType)

    const text = asString(part.text)
    if (text && (partType === "text" || partType === "reasoning" || !partType)) {
      const previous = this.partText.get(partId) ?? ""
      const delta = text.startsWith(previous) ? text.slice(previous.length) : text
      this.partText.set(partId, text)
      if (delta) {
        out.push(
          partType === "reasoning"
            ? { kind: "reasoning-delta", partId, delta }
            : { kind: "text-delta", partId, delta },
        )
      }
    }

    // Visible reasoning from OpenRouter/NanoGPT compatibility fields.
    const reasoning = asString(part.reasoning) ?? asString(part.reasoning_content)
    if (reasoning) {
      const previous = this.partText.get(partId) ?? ""
      const delta = reasoning.startsWith(previous) ? reasoning.slice(previous.length) : reasoning
      this.partText.set(partId, reasoning)
      if (delta) out.push({ kind: "reasoning-delta", partId, delta })
    }

    if (partType === "tool") {
      const toolCallId = asString(part.callID) ?? asString(part.id) ?? partId
      const toolName = asString(part.tool) ?? "tool"
      const state = asString(pointer(part, ["state", "status"]))
      const input = pointer(part, ["state", "input"])
      if (state === "completed") {
        out.push({ kind: "tool-output", toolCallId, output: pointer(part, ["state", "output"]) })
      } else if (state === "error") {
        out.push({
          kind: "tool-error",
          toolCallId,
          errorText: asString(pointer(part, ["state", "error"])) ?? "OpenCode tool failed",
        })
      } else {
        out.push({ kind: "tool-input-start", toolCallId, toolName })
        if (input !== undefined) {
          out.push({ kind: "tool-input-available", toolCallId, toolName, input })
        }
      }
    }
    return out
  }
}
