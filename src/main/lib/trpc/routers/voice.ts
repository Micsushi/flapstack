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
import { clearOpenAIKeyCache, getOpenAIApiKey, setUserOpenAIKey } from "../../speech/stt-cloud"
import { recordTranscription } from "../../speech/history"
import { publicProcedure, router } from "../index"

// Max audio size: 25MB (Whisper API limit)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024

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
      if (input.chatId && result.text.trim()) {
        recordTranscription({
          chatId: input.chatId,
          subChatId: input.subChatId,
          text: result.text,
          adapterId: result.adapterId,
        })
      }
      return result
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

    setUserOpenAIKey(key || null)

    // Clear plan cache so isAvailable re-evaluates
    clearPlanCache()

    return { success: true }
  }),

  /**
   * Check if user has configured an OpenAI API key
   */
  hasOpenAIKey: publicProcedure.query(() => {
    return { hasKey: !!getOpenAIApiKey() }
  }),
})
