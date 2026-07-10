import { z } from "zod"
import {
  getNativeTtsAvailability,
  resolveAvailableTtsAdapter,
  resolveSttAdapter,
  resolveTtsAdapter,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapterImplementations,
  ttsAdapters,
} from "../../speech/registry"
import { READ_ALOUD_INSTRUCTION } from "../../speech/read-aloud-instruction"
import {
  getReadAloudEnabled,
  getVoiceSettings,
  setReadAloudForChat,
  setVoiceSettings,
} from "../../speech/settings"
import { filterSpeakableText } from "../../speech/speakable-filter"
import { createFallbackSpokenSummary } from "../../speech/spoken-summary"
import { ensureModel, getSttModelStatus } from "../../speech/stt-whisper-cpp"
import { speakWithTtsFallback } from "../../speech/tts-fallback"
import { nativeTtsAdapter } from "../../speech/tts-native"
import { readSpeechAudio, recordSpeech, searchVoiceHistory } from "../../speech/history"
import { publicProcedure, router } from "../index"

export const speechRouter = router({
  getSettings: publicProcedure.query(() => {
    return getVoiceSettings()
  }),

  updateSettings: publicProcedure
    .input(
      z.object({
        sttAdapterId: z.string().optional(),
        whisperCppBinPath: z.string().nullable().optional(),
        ttsAdapterId: z.string().optional(),
        voiceId: z.string().nullable().optional(),
        rate: z.number().min(0.5).max(2).optional(),
        autoReadAloud: z.boolean().optional(),
        preferOffline: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      return setVoiceSettings(input)
    }),

  getReadAloudForChat: publicProcedure
    .input(z.object({ chatId: z.string().min(1) }))
    .query(({ input }) => ({
      enabled: getReadAloudEnabled(input.chatId),
      inherited: !Object.hasOwn(getVoiceSettings().readAloudByChatId, input.chatId),
    })),

  setReadAloudForChat: publicProcedure
    .input(z.object({ chatId: z.string().min(1), enabled: z.boolean().nullable() }))
    .mutation(({ input }) => setReadAloudForChat(input.chatId, input.enabled)),

  listAdapters: publicProcedure.query(async () => {
    const settings = getVoiceSettings()
    const sttAdapter = resolveSttAdapter(settings)
    const ttsAdapter = resolveTtsAdapter(settings)
    const sttAvailability = Object.fromEntries(
      await Promise.all(
        sttAdapterImplementations.map(
          async (adapter) => [adapter.id, await adapter.isAvailable()] as const,
        ),
      ),
    )
    const ttsAvailability = Object.fromEntries(
      await Promise.all(
        ttsAdapterImplementations.map(
          async (adapter) => [adapter.id, await adapter.isAvailable()] as const,
        ),
      ),
    )

    return {
      stt: sttAdapters,
      tts: ttsAdapters,
      selected: {
        sttAdapterId: sttAdapter.id,
        ttsAdapterId: ttsAdapter.id,
      },
      availability: {
        nativeTts: getNativeTtsAvailability(),
        stt: sttAvailability,
        tts: ttsAvailability,
        localStt: sttAvailability["local-whisper"],
      },
    }
  }),

  listVoices: publicProcedure.query(async () => {
    const settings = getVoiceSettings()
    const adapter = resolveTtsAdapter(settings)
    return { adapterId: adapter.id, voices: await adapter.listVoices() }
  }),

  speak: publicProcedure
    .input(
      z.object({
        text: z.string(),
        voiceId: z.string().nullable().optional(),
        rate: z.number().optional(),
        chatId: z.string().optional(),
        subChatId: z.string().nullable().optional(),
        messageId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const settings = getVoiceSettings()
      const speakable = filterSpeakableText(input.text)
      const text = speakable.shouldSpeak ? speakable.text : createFallbackSpokenSummary(input.text)
      const adapter = await resolveAvailableTtsAdapter(settings)
      const ttsInput = {
        text,
        voiceId: input.voiceId ?? settings.voiceId,
        rate: input.rate ?? settings.rate,
      }
      const result = await speakWithTtsFallback(adapter, nativeTtsAdapter, ttsInput)
      const artifact = input.chatId
        ? await recordSpeech({
            chatId: input.chatId,
            subChatId: input.subChatId,
            messageId: input.messageId,
            text,
            result,
          })
        : null
      return { ...result, artifactId: artifact?.id ?? null }
    }),

  stopSpeaking: publicProcedure.mutation(async () => {
    // speak() may fall back off the configured adapter, so stop them all.
    await Promise.all(ttsAdapterImplementations.map((adapter) => adapter.stop()))
    return { success: true }
  }),

  createSpokenFallback: publicProcedure
    .input(z.object({ markdown: z.string() }))
    .mutation(({ input }) => {
      return { spoken: createFallbackSpokenSummary(input.markdown) }
    }),

  // Local Whisper model status for the settings UI (absent/downloading/present/error).
  getSttModelStatus: publicProcedure.query(() => {
    return getSttModelStatus()
  }),

  // Trigger download-on-first-use from the settings UI. Resolves when the model
  // is present; poll getSttModelStatus for live progress while it runs.
  downloadSttModel: publicProcedure.mutation(async () => {
    try {
      await ensureModel()
      return { status: getSttModelStatus() }
    } catch (error) {
      return {
        status: getSttModelStatus(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }),

  // The read-aloud Spoken:/Displayed: instruction, for display in settings and
  // for non-Claude harness prompt injection (Codex/Cursor) done elsewhere.
  getReadAloudInstruction: publicProcedure.query(() => {
    return { instruction: READ_ALOUD_INSTRUCTION }
  }),

  searchHistory: publicProcedure
    .input(z.object({ query: z.string().default(""), chatId: z.string().optional() }))
    .query(({ input }) => searchVoiceHistory(input.query, input.chatId)),

  getHistoryAudio: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => readSpeechAudio(input.id)),
})
