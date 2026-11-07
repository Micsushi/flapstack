import { getVoiceSettings } from "./settings"
import { resolveTtsAdapter, resolveSupportedTtsVoiceId } from "./registry"
import { resolveSpeechText } from "./speech-text"
import {
  createSpeechSynthesisKey,
  findReusableSpeech,
  getStoredSpokenText,
  persistSpokenText,
  recordSpeech,
} from "./history"

export type SpeechPreparationInput = {
  text: string
  voiceId?: string | null
  chatId?: string
  subChatId?: string | null
  messageId?: string | null
}

let queue: Promise<unknown> = Promise.resolve()

/** Serialize CPU synthesis; queued requests recheck disk so Play reuses background work. */
export function prepareSpeech(input: SpeechPreparationInput) {
  const job = queue.then(() => synthesize(input))
  queue = job.catch(() => {})
  return job
}

async function synthesize(input: SpeechPreparationInput) {
  const settings = getVoiceSettings()
  const text = resolveSpeechText(input.text, getStoredSpokenText(input.subChatId, input.messageId))
  if (!text)
    return {
      skipped: true as const,
      reason: "no-speakable-text",
      artifactId: null,
      historySaved: true as const,
      historyError: null,
    }
  persistSpokenText({ ...input, text })
  const adapter = resolveTtsAdapter(settings)
  const voiceId = resolveSupportedTtsVoiceId(
    input.voiceId ?? settings.voiceByTtsAdapterId[adapter.id] ?? settings.voiceId,
    await adapter.listVoices(),
  )
  // Speed belongs to pitch-preserving playback, never Kokoro's duration predictor.
  const rate = 1
  const synthesisKey = createSpeechSynthesisKey({ text, adapterId: adapter.id, voiceId, rate })
  const reusable = input.chatId
    ? await findReusableSpeech({ chatId: input.chatId, messageId: input.messageId, synthesisKey })
    : null
  if (reusable && reusable.result.adapterId === adapter.id)
    return {
      ...reusable.result,
      spokenText: text,
      skipped: false as const,
      artifactId: reusable.id,
      historySaved: true as const,
      historyError: null,
    }
  // A selected Kokoro voice must never silently become a system voice.
  const result = await adapter.speak({ text, voiceId, rate })
  let artifact = null
  let historyError: string | null = null
  if (input.chatId) {
    try {
      artifact = await recordSpeech({
        ...input,
        chatId: input.chatId,
        text,
        result,
        synthesisKey,
        voiceId,
        rate,
      })
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error)
      console.error("[Speech] Could not save prepared audio:", error)
    }
  }
  return {
    ...result,
    spokenText: text,
    skipped: false as const,
    artifactId: artifact?.id ?? null,
    historySaved: historyError === null,
    historyError,
  }
}
