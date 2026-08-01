export type SpeechAdapterKind = "cloud" | "local" | "os"
export type SpeechAdapterStatus = "available" | "unavailable" | "not-configured"

export type SpeechAdapterAvailability = {
  available: boolean
  status: SpeechAdapterStatus
  reason?: string
  missingDependency?: "engine" | "audio-converter" | "model"
}

export type SttInput = {
  audioBuffer: Buffer
  format: "webm" | "wav" | "mp3" | "m4a" | "ogg"
  language?: string
  vocabularyHints?: readonly string[]
}

export type SttResult = {
  text: string
  adapterId: string
}

export type SttAdapter = SttAdapterInfo & {
  isAvailable(): Promise<SpeechAdapterAvailability>
  /** True when runtime dependencies exist and transcribe() can provision its missing model. */
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
  /** Electron-window ownership for scoped native cancellation. */
  requestScopeId?: string
  /** Cheap cooperative cancellation between local synthesis chunks. */
  shouldContinue?: () => boolean
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
  stop(requestScopeId?: string): Promise<void>
}

export type SttAdapterInfo = {
  id: string
  label: string
  kind: SpeechAdapterKind
  supportsStreaming: boolean
  offline: boolean
  supportsVocabularyHints: boolean
}

export type TtsAdapterInfo = {
  id: string
  label: string
  kind: SpeechAdapterKind
  offline: boolean
  platform: NodeJS.Platform | "all"
}

export type VoiceSettings = {
  voiceSettingsVersion: 2
  sttAdapterId: string
  parakeetModelId: "parakeet-unified-en-q8"
  retainDictationAudio: boolean
  sttModelUnloadMinutes: number
  whisperModelId: WhisperModelId
  whisperCppBinPath: string | null
  ttsAdapterId: string
  voiceId: string | null
  voiceByTtsAdapterId: Record<string, string | null>
  rate: number
  preferOffline: boolean
}

export type WhisperModelId = "tiny" | "base" | "small"

export const defaultVoiceSettings: VoiceSettings = {
  voiceSettingsVersion: 2,
  sttAdapterId: "local-parakeet",
  parakeetModelId: "parakeet-unified-en-q8",
  retainDictationAudio: true,
  sttModelUnloadMinutes: 5,
  whisperModelId: "base",
  whisperCppBinPath: null,
  ttsAdapterId: "kokoro",
  voiceId: null,
  voiceByTtsAdapterId: {},
  rate: 1,
  preferOffline: true,
}
