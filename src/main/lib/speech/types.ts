export type SpeechAdapterKind = "cloud" | "local" | "os"
export type SpeechAdapterStatus = "available" | "unavailable" | "not-configured"

export type SpeechAdapterAvailability = {
  available: boolean
  status: SpeechAdapterStatus
  reason?: string
}

export type SttAdapterInfo = {
  id: string
  label: string
  kind: SpeechAdapterKind
  supportsStreaming: boolean
  offline: boolean
}

export type TtsAdapterInfo = {
  id: string
  label: string
  kind: SpeechAdapterKind
  offline: boolean
  platform: NodeJS.Platform | "all"
}

export type VoiceSettings = {
  sttAdapterId: string
  ttsAdapterId: string
  voiceId: string | null
  rate: number
  autoReadAloud: boolean
  preferOffline: boolean
}

export const defaultVoiceSettings: VoiceSettings = {
  sttAdapterId: "openai-whisper",
  ttsAdapterId: "native-os",
  voiceId: null,
  rate: 1,
  autoReadAloud: false,
  preferOffline: true,
}
