import { filterSpeakableText } from "./speakable-filter"
import { createFallbackSpokenSummary } from "./spoken-summary"

// Roughly several minutes of normal prose. This bounds synthesis CPU, PCM
// allocation, persisted artifacts, and the base64 response returned to the renderer.
export const MAX_SPEECH_TEXT_CHARACTERS = 10_000

export function assertSpeechTextWithinLimit(text: string): void {
  if (text.length > MAX_SPEECH_TEXT_CHARACTERS) {
    throw new Error(`Speech text exceeds the ${MAX_SPEECH_TEXT_CHARACTERS} character limit.`)
  }
}

export function resolveSpeechText(input: string, storedText?: string | null): string | null {
  if (storedText?.trim()) {
    assertSpeechTextWithinLimit(storedText)
    return storedText
  }
  const speakable = filterSpeakableText(input)
  if (speakable.shouldSpeak) {
    assertSpeechTextWithinLimit(speakable.text)
    return speakable.text
  }
  if (speakable.source === "spoken") return null
  const fallback = createFallbackSpokenSummary(input)
  if (!fallback.trim()) return null
  assertSpeechTextWithinLimit(fallback)
  return fallback
}
