export type SpeechAdapterKind = "cloud" | "local" | "os"
export type SpeechAdapterStatus = "available" | "unavailable" | "not-configured"

export type SpeechAdapterAvailability = {
  available: boolean
  status: SpeechAdapterStatus
  reason?: string
}

export type SttInput = {
  audioBuffer: Buffer
  format: "webm" | "wav" | "mp3" | "m4a" | "ogg"
  language?: string
}

export type SttResult = {
  text: string
  adapterId: string
}

export type SttAdapter = SttAdapterInfo & {
  isAvailable(): Promise<SpeechAdapterAvailability>
  /** True when transcribe() can provision a missing runtime asset itself. */
  canAutoProvision?(): Promise<boolean>
  transcribe(input: SttInput): Promise<SttResult>
}

export type TtsVoice = {
  id: string
  label: string
  language?: string
}

export type TtsInput = {
  text: string
  voiceId?: string | null
  rate?: number
}

export type TtsResult = {
  audioBase64: string
  mimeType: "audio/wav" | "audio/mpeg"
  adapterId: string
  voiceId?: string
}

export type TtsAdapter = TtsAdapterInfo & {
  isAvailable(): Promise<SpeechAdapterAvailability>
  listVoices(): Promise<TtsVoice[]>
  speak(input: TtsInput): Promise<TtsResult>
  stop(): Promise<void>
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
  whisperCppBinPath: string | null
  ttsAdapterId: string
  voiceId: string | null
  rate: number
  autoReadAloud: boolean
  readAloudByChatId: Record<string, boolean>
  preferOffline: boolean
}

export const defaultVoiceSettings: VoiceSettings = {
  sttAdapterId: "local-whisper",
  whisperCppBinPath: null,
  ttsAdapterId: "kokoro",
  voiceId: null,
  rate: 1,
  autoReadAloud: false,
  readAloudByChatId: {},
  preferOffline: true,
}
