import os from "node:os"
import { whisperCppAdapter } from "./stt-whisper-cpp"
import { parakeetStreamingAdapter } from "./stt-parakeet-streaming"
import { kokoroTtsAdapter } from "./tts-kokoro"
import { nativeTtsAdapter } from "./tts-native"
import type { SttAdapter, SttAdapterInfo, TtsAdapter, TtsAdapterInfo, VoiceSettings } from "./types"

// Stage 2 is local-only for dictation. Keep Cloud Whisper's credential helpers
// in the Models surface for future provider work, but never register it as a
// microphone adapter or transmit recorded audio off-device.
export const sttAdapterImplementations: SttAdapter[] = [parakeetStreamingAdapter, whisperCppAdapter]
export const ttsAdapterImplementations: TtsAdapter[] = [kokoroTtsAdapter, nativeTtsAdapter]

export const sttAdapters: SttAdapterInfo[] = sttAdapterImplementations.map(toSttInfo)
export const ttsAdapters: TtsAdapterInfo[] = ttsAdapterImplementations.map(toTtsInfo)

export function resolveSttAdapter(settings: Pick<VoiceSettings, "sttAdapterId" | "preferOffline">) {
  const explicit = sttAdapterImplementations.find((adapter) => adapter.id === settings.sttAdapterId)
  if (explicit) return explicit
  if (settings.preferOffline)
    return (
      sttAdapterImplementations.find((adapter) => adapter.offline) ?? sttAdapterImplementations[0]!
    )
  return sttAdapterImplementations[0]!
}

export function resolveTtsAdapter(settings: Pick<VoiceSettings, "ttsAdapterId">) {
  return (
    ttsAdapterImplementations.find((adapter) => adapter.id === settings.ttsAdapterId) ??
    ttsAdapterImplementations[0]!
  )
}

export async function resolveAvailableSttAdapter(
  settings: Pick<VoiceSettings, "sttAdapterId" | "preferOffline">,
) {
  // STT selection is privacy-sensitive: choosing Local Whisper must never
  // silently upload microphone audio to a cloud fallback. The selected adapter
  // owns both its availability message and any first-use provisioning flow.
  return resolveSttAdapter(settings)
}

export async function resolveAvailableTtsAdapter(settings: Pick<VoiceSettings, "ttsAdapterId">) {
  const preferred = resolveTtsAdapter(settings)
  const ordered = [
    preferred,
    ...ttsAdapterImplementations.filter((adapter) => adapter.id !== preferred.id),
  ]
  for (const adapter of ordered) {
    const availability = await adapter.isAvailable()
    if (availability.available) return adapter
  }
  return preferred
}

export function resolveTtsVoiceId(
  configuredAdapterId: string,
  resolvedAdapterId: string,
  requestedVoiceId: string | null | undefined,
): string | null {
  return configuredAdapterId === resolvedAdapterId ? (requestedVoiceId ?? null) : null
}

export function resolveSupportedTtsVoiceId(
  requestedVoiceId: string | null,
  voices: Array<{ id: string }>,
): string | null {
  return requestedVoiceId && voices.some((voice) => voice.id === requestedVoiceId)
    ? requestedVoiceId
    : null
}

export function getNativeTtsAvailability() {
  const platform = os.platform()
  if (platform === "darwin" || platform === "win32") {
    return { available: true, status: "available" as const }
  }
  return {
    available: false,
    status: "unavailable" as const,
    reason: `Native TTS scaffold does not support ${platform}`,
  }
}

function toSttInfo(adapter: SttAdapter): SttAdapterInfo {
  return {
    id: adapter.id,
    label: adapter.label,
    kind: adapter.kind,
    supportsStreaming: adapter.supportsStreaming,
    offline: adapter.offline,
    supportsVocabularyHints: adapter.supportsVocabularyHints,
  }
}

function toTtsInfo(adapter: TtsAdapter): TtsAdapterInfo {
  return {
    id: adapter.id,
    label: adapter.label,
    kind: adapter.kind,
    offline: adapter.offline,
    platform: adapter.platform,
  }
}
