import os from "node:os"
import type { SttAdapterInfo, TtsAdapterInfo, VoiceSettings } from "./types"

export const sttAdapters: SttAdapterInfo[] = [
  {
    id: "openai-whisper",
    label: "OpenAI Whisper",
    kind: "cloud",
    supportsStreaming: false,
    offline: false,
  },
  {
    id: "local-whisper",
    label: "Local Whisper",
    kind: "local",
    supportsStreaming: false,
    offline: true,
  },
]

export const ttsAdapters: TtsAdapterInfo[] = [
  {
    id: "native-os",
    label: "Native OS Voice",
    kind: "os",
    offline: true,
    platform: "all",
  },
]

export function resolveSttAdapter(settings: Pick<VoiceSettings, "sttAdapterId" | "preferOffline">) {
  const explicit = sttAdapters.find((adapter) => adapter.id === settings.sttAdapterId)
  if (explicit) return explicit
  if (settings.preferOffline)
    return sttAdapters.find((adapter) => adapter.offline) ?? sttAdapters[0]!
  return sttAdapters[0]!
}

export function resolveTtsAdapter(settings: Pick<VoiceSettings, "ttsAdapterId">) {
  return ttsAdapters.find((adapter) => adapter.id === settings.ttsAdapterId) ?? ttsAdapters[0]!
}

export function getNativeTtsAvailability() {
  const platform = os.platform()
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return { available: true, status: "available" as const }
  }
  return {
    available: false,
    status: "unavailable" as const,
    reason: `Native TTS scaffold does not support ${platform}`,
  }
}
