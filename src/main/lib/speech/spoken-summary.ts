const MAX_SPOKEN_CHARS = 700

export function createFallbackSpokenSummary(markdown: string): string {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, (match) => match.slice(1, match.indexOf("]")))
    .replace(/[#>*_\-|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!withoutCode) return "The assistant replied with content that is better read on screen."
  if (withoutCode.length <= MAX_SPOKEN_CHARS) return withoutCode

  const sentenceBoundary = withoutCode.lastIndexOf(".", MAX_SPOKEN_CHARS)
  const end = sentenceBoundary > 160 ? sentenceBoundary + 1 : MAX_SPOKEN_CHARS
  return `${withoutCode.slice(0, end).trim()} More detail is available on screen.`
}
