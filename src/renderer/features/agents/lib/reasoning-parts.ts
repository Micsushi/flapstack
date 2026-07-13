import { sanitizeHarnessEnvelopeEcho } from "../../../../shared/harness-envelope-sanitizer"

export function getVisibleReasoningText(part: any): string {
  if (typeof part?.input?.text === "string") return sanitizeHarnessEnvelopeEcho(part.input.text)
  if (typeof part?.text === "string") return sanitizeHarnessEnvelopeEcho(part.text)
  return ""
}

export function dedupeVisibleReasoningParts<T>(
  parts: T[],
  isReasoningPart: (part: T) => boolean,
): T[] {
  const seen = new Set<string>()
  let priorReasoningText = ""

  return parts.filter((part) => {
    if (!isReasoningPart(part)) return true

    const text = getVisibleReasoningText(part).trim().replace(/\s+/g, " ")
    if (!text) return true
    if (seen.has(text)) return false

    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const label = (part as any)?.label ?? (part as any)?.input?.label
    if (label === "Reasoning summary" && normalized && priorReasoningText.includes(normalized)) {
      return false
    }

    seen.add(text)
    priorReasoningText += normalized
    return true
  })
}
