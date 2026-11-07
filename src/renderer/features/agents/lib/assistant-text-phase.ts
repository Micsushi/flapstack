type TextPart = {
  type?: string
  text?: string
  providerMetadata?: { runtime?: { phase?: string } }
}

export function isProgressText(part: TextPart, live: boolean): boolean {
  if (part.type !== "text" || !part.text?.trim()) return false
  const phase = part.providerMetadata?.runtime?.phase
  return phase === "commentary" || (live && phase !== "final_answer")
}

export function findAnswerPartIndex(parts: TextPart[], live: boolean): number {
  return parts.findLastIndex(
    (part) => part.type === "text" && Boolean(part.text?.trim()) && !isProgressText(part, live),
  )
}
