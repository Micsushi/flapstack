import type { SpeechAudioChunk, VoiceSettings } from "./types"
import { getVoiceSettings } from "./settings"
import { getDatabasePath, getSqliteDatabase } from "../db"
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

export async function prepareStoredReply(
  databasePath: string,
  reply: {
    chatId: string
    subChatId: string
    messageId: string
    text: string
  },
) {
  if (databasePath !== getDatabasePath() || !getVoiceSettings().prepareReplyAudio) return
  const saved = getSqliteDatabase()
    .prepare(
      `SELECT 1 FROM sub_chats s, json_each(s.messages) m
     WHERE s.id = ? AND s.chat_id = ? AND json_extract(m.value, '$.id') = ? LIMIT 1`,
    )
    .get(reply.subChatId, reply.chatId, reply.messageId)
  if (saved) {
    const result = await prepareSpeech(reply)
    if (!result.historySaved) throw new Error(result.historyError || "Could not save reply audio")
  }
}

/** Background and foreground reads of the same reply share one synthesis and history record. */
type Chunk = SpeechAudioChunk & { spokenText?: string }
type Listener = (chunk: Chunk) => void
const preparing = new Map<
  string,
  {
    chunks: Chunk[]
    listeners: Set<Listener>
    interest: { retain: boolean }
    promise: ReturnType<typeof synthesize>
  }
>()

export function prepareSpeech(
  input: SpeechPreparationInput,
  onChunk?: Listener,
  signal?: AbortSignal,
) {
  const settings = getVoiceSettings()
  const key = JSON.stringify([
    input.chatId,
    input.subChatId,
    input.messageId,
    input.text,
    input.voiceId,
    settings.ttsAdapterId,
    settings.voiceId,
    settings.voiceByTtsAdapterId[settings.ttsAdapterId],
    settings.replyReadMode,
  ])
  let job = preparing.get(key)
  if (!job) {
    const chunks: Chunk[] = []
    const listeners = new Set<Listener>()
    const interest = { retain: !onChunk }
    const start = () =>
      synthesize(
        input,
        settings,
        () => listeners.size > 0,
        () => interest.retain || listeners.size > 0,
        (chunk) => {
          chunks.push(chunk)
          for (const notify of listeners) notify(chunk)
        },
      )
    // Kokoro serializes individual sentences so a new Play click can overtake background work.
    const ready = settings.ttsAdapterId === "kokoro" ? Promise.resolve() : queue
    const promise = ready.then(start).finally(() => preparing.delete(key))
    job = { chunks, listeners, promise, interest }
    preparing.set(key, job)
    if (settings.ttsAdapterId !== "kokoro") queue = promise.catch(() => {})
  }
  if (onChunk && !signal?.aborted) {
    const listeners = job.listeners
    const detach = () => listeners.delete(onChunk)
    listeners.add(onChunk)
    signal?.addEventListener("abort", detach, { once: true })
    for (const chunk of job.chunks) onChunk(chunk)
    return job.promise.finally(() => {
      listeners.delete(onChunk)
      signal?.removeEventListener("abort", detach)
    })
  }
  if (!onChunk) job.interest.retain = true
  return job.promise
}

async function synthesize(
  input: SpeechPreparationInput,
  settings: VoiceSettings,
  interactive: () => boolean,
  shouldContinue: () => boolean,
  onChunk: Listener,
) {
  const mode = settings.replyReadMode
  const stored =
    mode === "summary" ? getStoredSpokenText(input.subChatId, input.messageId, mode) : null
  const text = resolveSpeechText(input.text, stored, mode)
  if (!text)
    return {
      skipped: true as const,
      reason: "no-speakable-text",
      artifactId: null,
      historySaved: true as const,
      historyError: null,
    }
  persistSpokenText({ ...input, text, mode })
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
  let first = true
  const result = await adapter.speak({
    text,
    voiceId,
    rate,
    interactive,
    shouldContinue,
    onChunk(chunk) {
      onChunk(first ? { ...chunk, spokenText: text } : chunk)
      first = false
    },
  })
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
