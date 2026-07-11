import type { TtsAdapter, TtsInput, TtsResult } from "./types"

export type TtsFallbackOptions = {
  shouldContinue?: () => boolean
}

/**
 * Use the system voice when the selected engine cannot synthesize. This covers
 * Kokoro's first model download as well as an installed runtime failing later.
 */
export async function speakWithTtsFallback(
  adapter: TtsAdapter,
  nativeAdapter: TtsAdapter,
  input: TtsInput,
  options: TtsFallbackOptions = {},
): Promise<TtsResult> {
  assertSpeechActive(options)
  try {
    const result = await adapter.speak(input)
    assertSpeechActive(options)
    return result
  } catch (error) {
    assertSpeechActive(options)
    if (adapter.id === nativeAdapter.id) throw error
    const availability = await nativeAdapter.isAvailable()
    assertSpeechActive(options)
    if (!availability.available) throw error

    // Voice identifiers are adapter-specific. A Kokoro voice such as
    // `af_heart` is not a valid macOS/Windows native voice and must never be
    // forwarded into the fallback adapter.
    const result = await nativeAdapter.speak({ ...input, voiceId: null })
    assertSpeechActive(options)
    return result
  }
}

function assertSpeechActive(options: TtsFallbackOptions) {
  if (options.shouldContinue?.() === false) {
    throw new Error("Speech request was cancelled.")
  }
}
