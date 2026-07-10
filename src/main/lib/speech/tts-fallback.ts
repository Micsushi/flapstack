import type { TtsAdapter, TtsInput, TtsResult } from "./types"

/**
 * Use the system voice when the selected engine cannot synthesize. This covers
 * Kokoro's first model download as well as an installed runtime failing later.
 */
export async function speakWithTtsFallback(
  adapter: TtsAdapter,
  nativeAdapter: TtsAdapter,
  input: TtsInput,
): Promise<TtsResult> {
  try {
    return await adapter.speak(input)
  } catch (error) {
    if (adapter.id === nativeAdapter.id) throw error
    const availability = await nativeAdapter.isAvailable()
    if (!availability.available) throw error
    return nativeAdapter.speak(input)
  }
}
