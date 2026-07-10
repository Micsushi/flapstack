import {
  ReasoningOutputAccumulator,
  normalizeCodexReasoningOutput,
  type ReasoningOutputEvent,
  type ReasoningOutputUiPart,
} from "../../../shared/reasoning-output"

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

/**
 * Extract the newest Codex reasoning response item from a saved session.
 * Visible summaries become message events. Encrypted reasoning remains opaque
 * and is never copied into a renderer part.
 */
export function extractLatestCodexReasoningEvents(
  rawContent: string,
  options?: { notBeforeTimestampMs?: number },
): ReasoningOutputEvent[] {
  const lines = rawContent.split("\n")
  let newestOpaqueEvents: ReasoningOutputEvent[] = []

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) continue

    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (parsed?.type !== "response_item" || parsed?.payload?.type !== "reasoning") continue

    const timestampMs = toTimestampMs(parsed.timestamp)
    const notBeforeTimestampMs = options?.notBeforeTimestampMs
    if (
      notBeforeTimestampMs !== undefined &&
      (timestampMs === undefined || timestampMs < notBeforeTimestampMs)
    ) {
      continue
    }

    const events = normalizeCodexReasoningOutput(parsed.payload)
    if (newestOpaqueEvents.length === 0) {
      newestOpaqueEvents = events.filter((event) => event.kind === "opaque")
    }
    if (events.some((event) => event.kind === "reasoning-summary" && event.text)) {
      return events
    }
  }

  return newestOpaqueEvents
}

export function codexReasoningEventsToParts(
  events: Iterable<ReasoningOutputEvent>,
): ReasoningOutputUiPart[] {
  const accumulator = new ReasoningOutputAccumulator()
  accumulator.applyAll(events)
  return accumulator
    .toParts()
    .filter((part) => part.label === "Reasoning summary" && part.input.text.length > 0)
}

export function appendUniqueReasoningOutputParts<T extends { parts?: unknown[] }>(
  message: T,
  reasoningOutputParts: ReasoningOutputUiPart[],
): T {
  if (reasoningOutputParts.length === 0) return message

  const existingParts = Array.isArray(message.parts) ? message.parts : []
  const existingTexts = new Set(
    existingParts
      .map((part: any) =>
        typeof part?.input?.text === "string"
          ? part.input.text
          : typeof part?.text === "string"
            ? part.text
            : "",
      )
      .filter(Boolean),
  )
  const additions = reasoningOutputParts.filter((part) => !existingTexts.has(part.input.text))
  if (additions.length === 0) return message

  return { ...message, parts: [...existingParts, ...additions] }
}
