import { filterSpeakableText } from "./speakable-filter"
import { createFallbackSpokenSummary } from "./spoken-summary"

export function resolveSpeechText(input: string, storedText?: string | null): string | null {
  if (storedText?.trim()) return storedText
  const speakable = filterSpeakableText(input)
  if (speakable.shouldSpeak) return speakable.text
  if (speakable.source === "spoken") return null
  const fallback = createFallbackSpokenSummary(input)
  return fallback.trim() ? fallback : null
}
