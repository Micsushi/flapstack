export function getVisibleReasoningText(part: any): string {
  if (typeof part?.input?.text === "string") return part.input.text
  if (typeof part?.text === "string") return part.text
  return ""
}

export function dedupeVisibleReasoningParts<T>(
  parts: T[],
  isReasoningPart: (part: T) => boolean,
): T[] {
  const seen = new Set<string>()

  return parts.filter((part) => {
    if (!isReasoningPart(part)) return true

    const text = getVisibleReasoningText(part).trim().replace(/\s+/g, " ")
    if (!text) return true
    if (seen.has(text)) return false

    seen.add(text)
    return true
  })
}
