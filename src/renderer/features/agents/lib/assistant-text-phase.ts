type TextPart = {
  type?: string
  text?: string
  providerMetadata?: { runtime?: { phase?: string } }
}

export function isProgressText(
  part: TextPart,
  live: boolean,
  index = 0,
  lastActivity = -1,
): boolean {
  if (part.type !== "text" || !part.text?.trim()) return false
  const phase = part.providerMetadata?.runtime?.phase
  if (phase === "assistant_text") return index <= lastActivity
  return phase === "commentary" || (live && phase !== "final_answer")
}

export function lastActivityPartIndex(parts: TextPart[], live: boolean): number {
  return parts.findLastIndex(
    (part) =>
      part.type?.startsWith("tool-") ||
      part.type === "reasoning" ||
      part.type === "data-user-steer" ||
      isProgressText(part, live),
  )
}

export function findAnswerPartIndex(
  parts: TextPart[],
  live: boolean,
  lastActivity = lastActivityPartIndex(parts, live),
): number {
  return parts.findLastIndex((part, index) => {
    if (part.type !== "text" || !part.text?.trim()) return false
    return !isProgressText(part, live, index, lastActivity)
  })
}
