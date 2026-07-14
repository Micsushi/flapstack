/**
 * Voice TRPC router
 * Provides voice-to-text transcription through Stage 2 speech adapters.
 *
 * Uses the local whisper.cpp adapter only. OpenAI credential procedures remain
 * here for the separate Models settings surface.
 */

import { z } from "zod"
import { resolveAvailableSttAdapter, sttAdapterImplementations } from "../../speech/registry"
import { getVoiceSettings } from "../../speech/settings"
import { clearOpenAIKeyCache, getOpenAIApiKey } from "../../speech/stt-cloud"
import { getCredentialService } from "../../credential-service"
import { recordTranscription } from "../../speech/history"
import { parakeetSidecar } from "../../speech/stt-parakeet-streaming"
import { StreamingTranscriptState } from "../../../../shared/streaming-transcript"
import { publicProcedure, router } from "../index"

// Max audio size: 25MB (Whisper API limit)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024
const MAX_STREAM_PCM_BYTES = 10 * 60 * 16_000 * 4

type ActiveDictation = {
  sessionId: string
  windowId: number
  chatId?: string
  subChatId?: string
  chunks: Buffer[]
  bytes: number
  startedAt: number
  originKind?: "chat" | "new-chat"
  originId?: string
  originLabel?: string
  transcript: StreamingTranscriptState
}

let activeDictation: ActiveDictation | null = null
let pendingDictation: { sessionId: string; windowId: number; cancelled: boolean } | null = null
let streamingStartTransition: Promise<void> = Promise.resolve()

function serializeStreamingStart<T>(operation: () => Promise<T>): Promise<T> {
  const result = streamingStartTransition.then(operation, operation)
  streamingStartTransition = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function floatPcmToWav(chunks: Buffer[]) {
  const floatBytes = Buffer.concat(chunks)
  const samples = new Float32Array(
    floatBytes.buffer,
    floatBytes.byteOffset,
    Math.floor(floatBytes.byteLength / 4),
  )
  const output = Buffer.alloc(44 + samples.length * 2)
  output.write("RIFF", 0)
  output.writeUInt32LE(36 + samples.length * 2, 4)
  output.write("WAVEfmt ", 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(16_000, 24)
  output.writeUInt32LE(32_000, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write("data", 36)
  output.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    output.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2)
  }
  return output
}

/**
 * Clear plan cache (for testing or when subscription changes)
 */
export function clearPlanCache(): void {}

export const voiceRouter = router({
  /**
   * Transcribe audio to text
   * Local-only: browser audio is transcribed by whisper.cpp.
   */
  transcribe: publicProcedure
    .input(
      z.object({
        audio: z.string(), // base64 encoded audio
        format: z.enum(["webm", "wav", "mp3", "m4a", "ogg"]).default("webm"),
        language: z.string().optional(), // ISO 639-1 code (e.g., "en", "ru")
        chatId: z.string().optional(),
        subChatId: z.string().optional(),
        originKind: z.enum(["chat", "new-chat"]).optional(),
        originId: z.string().optional(),
        originLabel: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const audioBuffer = Buffer.from(input.audio, "base64")

      console.log(`[Voice] Transcribing ${audioBuffer.length} bytes of ${input.format} audio`)

      // Check audio size limit
      if (audioBuffer.length > MAX_AUDIO_SIZE) {
        throw new Error(
          `Audio too large (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum is 25MB.`,
        )
      }

      const settings = getVoiceSettings()
      const adapter = await resolveAvailableSttAdapter(settings)
      const availability = await adapter.isAvailable()
      const canAutoProvision = await adapter.canAutoProvision?.()
      if (!availability.available && !canAutoProvision)
        throw new Error(availability.reason || "Voice input is not configured.")
      const result = await adapter.transcribe({
        audioBuffer,
        format: input.format,
        language: input.language,
      })
      console.log(
        `[Voice] ${result.adapterId} transcription completed (${result.text.length} chars)`,
      )
      let historyError: string | null = null
      if (result.text.trim()) {
        try {
          await recordTranscription({
            chatId: input.chatId,
            subChatId: input.subChatId,
            text: result.text,
            adapterId: result.adapterId,
            modelId:
              result.adapterId === "local-whisper"
                ? settings.whisperModelId
                : settings.parakeetModelId,
            originKind: input.originKind,
            originId: input.originId,
            originLabel: input.originLabel,
          })
        } catch (error) {
          historyError = error instanceof Error ? error.message : String(error)
          console.error("[Voice] Failed to save transcription history:", error)
        }
      }
      return { ...result, historySaved: historyError === null, historyError }
    }),

  startStreaming: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        chatId: z.string().optional(),
        subChatId: z.string().optional(),
        originKind: z.enum(["chat", "new-chat"]).optional(),
        originId: z.string().optional(),
        originLabel: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const windowId = ctx.getWindow()?.id ?? 0
      if (pendingDictation) pendingDictation.cancelled = true
      const pending = { sessionId: input.sessionId, windowId, cancelled: false }
      pendingDictation = pending
      return await serializeStreamingStart(async () => {
        if (activeDictation) {
          activeDictation = null
          await parakeetSidecar.cancel()
        }
        try {
          await parakeetSidecar.start()
          if (pending.cancelled || pendingDictation !== pending) {
            await parakeetSidecar.cancel()
            throw new Error("Dictation start was cancelled")
          }
          activeDictation = {
            sessionId: input.sessionId,
            windowId,
            chatId: input.chatId,
            subChatId: input.subChatId,
            chunks: [],
            bytes: 0,
            startedAt: Date.now(),
            originKind: input.originKind,
            originId: input.originId,
            originLabel: input.originLabel,
            transcript: new StreamingTranscriptState(),
          }
          return { started: true as const, adapterId: "local-parakeet" }
        } finally {
          if (pendingDictation === pending) pendingDictation = null
        }
      })
    }),

  feedStreaming: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), pcmBase64: z.string().max(2_000_000) }))
    .mutation(async ({ input, ctx }) => {
      const windowId = ctx.getWindow()?.id ?? 0
      if (
        !activeDictation ||
        activeDictation.windowId !== windowId ||
        activeDictation.sessionId !== input.sessionId
      )
        throw new Error("No active dictation for this window")
      const dictation = activeDictation
      const chunk = Buffer.from(input.pcmBase64, "base64")
      if (chunk.length % 4 !== 0) throw new Error("Streaming PCM must be float32-aligned")
      if (activeDictation.bytes + chunk.length > MAX_STREAM_PCM_BYTES)
        throw new Error("Dictation is longer than 10 minutes")
      activeDictation.chunks.push(chunk)
      activeDictation.bytes += chunk.length
      const sidecarUpdate = await parakeetSidecar.feed(chunk)
      if (activeDictation !== dictation) throw new Error("Dictation was cancelled")
      const update = dictation.transcript.apply(sidecarUpdate)
      return {
        committed: update.committed ?? "",
        tentative: update.tentative ?? "",
        adapterId: "local-parakeet" as const,
      }
    }),

  finalizeStreaming: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const windowId = ctx.getWindow()?.id ?? 0
      if (
        !activeDictation ||
        activeDictation.windowId !== windowId ||
        activeDictation.sessionId !== input.sessionId
      )
        throw new Error("No active dictation for this window")
      const dictation = activeDictation
      activeDictation = null
      const result = await parakeetSidecar.finalize()
      const text = (result.final_text ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/ +/g, " ")
        .trim()
      const durationMs = Math.round((dictation.bytes / 4 / 16_000) * 1_000)
      let historyError: string | null = null
      if (text) {
        const settings = getVoiceSettings()
        try {
          await recordTranscription({
            chatId: dictation.chatId,
            subChatId: dictation.subChatId,
            text,
            adapterId: "local-parakeet",
            modelId: settings.parakeetModelId,
            originKind: dictation.originKind,
            originId: dictation.originId,
            originLabel: dictation.originLabel,
            durationMs,
            audioWav: settings.retainDictationAudio ? floatPcmToWav(dictation.chunks) : null,
          })
        } catch (error) {
          historyError = error instanceof Error ? error.message : String(error)
          console.error("[Voice] Failed to save streaming history:", error)
        }
      }
      return {
        text,
        adapterId: "local-parakeet" as const,
        durationMs,
        historySaved: historyError === null,
        historyError,
      }
    }),

  cancelStreaming: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const windowId = ctx.getWindow()?.id ?? 0
      if (
        pendingDictation?.windowId === windowId &&
        pendingDictation.sessionId === input.sessionId
      ) {
        pendingDictation.cancelled = true
      }
      if (activeDictation?.windowId === windowId && activeDictation.sessionId === input.sessionId) {
        activeDictation = null
        await parakeetSidecar.cancel()
      }
      return { cancelled: true as const }
    }),

  /** Check local-only dictation readiness, including model auto-provisioning. */
  isAvailable: publicProcedure.query(async () => {
    const settings = getVoiceSettings()
    const availability = await Promise.all(
      sttAdapterImplementations.map(async (adapter) => {
        const adapterAvailability = await adapter.isAvailable()
        const canAutoProvision = (await adapter.canAutoProvision?.()) ?? false
        return {
          adapterId: adapter.id,
          ...adapterAvailability,
          canAutoProvision,
        }
      }),
    )
    const available = availability.find((entry) => entry.available)
    if (available) {
      return {
        available: true,
        method: available.adapterId,
        reason: undefined,
        adapters: availability,
      }
    }

    return {
      available: false,
      method: null,
      reason: availability[0]?.reason || "Configure local Whisper.",
      adapters: availability,
    }
  }),

  /**
   * Set OpenAI API key from user settings
   * This allows users without a paid subscription to use their own API key
   */
  setOpenAIKey: publicProcedure.input(z.object({ key: z.string() })).mutation(({ input }) => {
    const key = input.key.trim()

    // Validate key format if provided
    if (key && !key.startsWith("sk-")) {
      throw new Error("Invalid OpenAI API key format. Key should start with 'sk-'")
    }

    const status = key
      ? getCredentialService().set("openai.voice-api-key", key)
      : getCredentialService().remove("openai.voice-api-key")

    // Clear plan cache so isAvailable re-evaluates
    clearPlanCache()

    return { success: true, status }
  }),

  /**
   * Check if user has configured an OpenAI API key
   */
  hasOpenAIKey: publicProcedure.query(() => {
    const status = getCredentialService().status("openai.voice-api-key")
    const hasKey = !!getOpenAIApiKey()
    return {
      hasKey,
      status,
      source: status.source ?? (hasKey ? ("environment-or-shell" as const) : null),
    }
  }),
})
