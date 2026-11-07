import { z } from "zod"
import {
  getNativeTtsAvailability,
  resolveSttAdapter,
  resolveSupportedTtsVoiceId,
  resolveTtsAdapter,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapterImplementations,
  ttsAdapters,
} from "../../speech/registry"
import { getVoiceSettings, setVoiceSettings } from "../../speech/settings"
import { createFallbackSpokenSummary } from "../../speech/spoken-summary"
import { prepareSpeech } from "../../speech/prepare"
import { SpeechRequestOwnership } from "../../speech/request-ownership"
import { ensureModel, getSttModelStatus, listWhisperModels } from "../../speech/stt-whisper-cpp"
import {
  ensureParakeetModel,
  getParakeetModelStatus,
  parakeetSidecar,
  PARAKEET_MODEL,
} from "../../speech/stt-parakeet-streaming"
import {
  readSpeechAudio,
  markSpeechPlayed,
  searchVoiceHistory,
  deleteVoiceHistoryEntry,
  getVoiceHistoryAudioPath,
} from "../../speech/history"
import { shell } from "electron"
import { cancelCloudTranscriptions } from "../../speech/stt-cloud"
import { publicProcedure, router } from "../index"

const speechOwnership = new SpeechRequestOwnership()

function beginSpeechRequest(windowId: number) {
  return speechOwnership.begin(windowId)
}

function cancelSpeechRequests(windowId: number) {
  speechOwnership.cancel(windowId)
}

function isSpeechRequestActive(windowId: number, requestId: number) {
  return speechOwnership.isActive(windowId, requestId)
}

async function stopTtsAdapters(requestScopeId: string) {
  await Promise.allSettled(ttsAdapterImplementations.map((adapter) => adapter.stop(requestScopeId)))
}

export const speechRouter = router({
  getSettings: publicProcedure.query(() => {
    return getVoiceSettings()
  }),

  updateSettings: publicProcedure
    .input(
      z.object({
        voiceSettingsVersion: z.literal(2).optional(),
        sttAdapterId: z.string().optional(),
        cloudTranscriptionEnabled: z.boolean().optional(),
        parakeetModelId: z.literal("parakeet-unified-en-q8").optional(),
        retainDictationAudio: z.boolean().optional(),
        sttModelUnloadMinutes: z.number().int().min(1).max(60).optional(),
        whisperModelId: z.enum(["tiny", "base", "small"]).optional(),
        whisperCppBinPath: z.string().nullable().optional(),
        ttsAdapterId: z.string().optional(),
        voiceId: z.string().nullable().optional(),
        voiceByTtsAdapterId: z.record(z.string(), z.string().nullable()).optional(),
        rate: z.number().min(0.5).max(2).optional(),
        preferOffline: z.boolean().optional(),
        prepareReplyAudio: z.boolean().optional(),
        unplayedAudioRetentionDays: z
          .union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)])
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      const previous = getVoiceSettings()
      const next = setVoiceSettings(input)
      if (!next.cloudTranscriptionEnabled || next.sttAdapterId !== "openai-whisper")
        cancelCloudTranscriptions()
      if (previous.sttModelUnloadMinutes !== next.sttModelUnloadMinutes)
        parakeetSidecar.rescheduleIdleUnload()
      return next
    }),

  listAdapters: publicProcedure.query(async () => {
    const settings = getVoiceSettings()
    const sttAdapter = resolveSttAdapter(settings)
    const ttsAdapter = resolveTtsAdapter(settings)
    const sttAvailability = Object.fromEntries(
      await Promise.all(
        sttAdapterImplementations.map(async (adapter) => {
          const availability = await adapter.isAvailable()
          const canAutoProvision = (await adapter.canAutoProvision?.()) ?? false
          return [adapter.id, { ...availability, canAutoProvision }] as const
        }),
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
        localStt: sttAvailability[settings.sttAdapterId],
      },
    }
  }),

  listVoices: publicProcedure.query(async () => {
    const settings = getVoiceSettings()
    const adapter = resolveTtsAdapter(settings)
    const voices = await adapter.listVoices()
    const configuredVoiceId =
      settings.voiceByTtsAdapterId[settings.ttsAdapterId] ?? settings.voiceId
    return {
      adapterId: adapter.id,
      voices,
      resolvedVoiceId: resolveSupportedTtsVoiceId(configuredVoiceId, voices),
      invalidVoiceId:
        configuredVoiceId && !voices.some((voice) => voice.id === configuredVoiceId)
          ? configuredVoiceId
          : null,
    }
  }),

  listSttModels: publicProcedure.query(() => [PARAKEET_MODEL, ...listWhisperModels()]),

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
    .mutation(async ({ input, ctx }) => {
      const windowId = ctx.getWindow()?.id ?? 0
      const requestScopeId = String(windowId)
      const requestId = beginSpeechRequest(windowId)
      await stopTtsAdapters(requestScopeId)
      if (!isSpeechRequestActive(windowId, requestId))
        throw new Error("Speech request was cancelled.")

      const result = await prepareSpeech(input)
      if (!isSpeechRequestActive(windowId, requestId))
        throw new Error("Speech request was cancelled.")
      return result
    }),

  prepareReply: publicProcedure
    .input(
      z.object({
        text: z.string(),
        chatId: z.string(),
        subChatId: z.string(),
        messageId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!getVoiceSettings().prepareReplyAudio) return { prepared: false }
      const result = await prepareSpeech(input)
      if (!result.historySaved) throw new Error(result.historyError || "Could not save reply audio")
      return { prepared: !result.skipped, artifactId: result.artifactId }
    }),

  markPlayed: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => markSpeechPlayed(input.id)),

  stopSpeaking: publicProcedure.mutation(async ({ ctx }) => {
    const windowId = ctx.getWindow()?.id ?? 0
    cancelSpeechRequests(windowId)
    await stopTtsAdapters(String(windowId))
    return { success: true }
  }),

  createSpokenFallback: publicProcedure
    .input(z.object({ markdown: z.string() }))
    .mutation(({ input }) => {
      return { spoken: createFallbackSpokenSummary(input.markdown) }
    }),

  // Local Whisper model status for the settings UI (absent/downloading/present/error).
  getSttModelStatus: publicProcedure.query(async () => {
    return getVoiceSettings().sttAdapterId === "local-parakeet"
      ? await getParakeetModelStatus()
      : await getSttModelStatus()
  }),

  // Trigger download-on-first-use from the settings UI. Resolves when the model
  // is present; poll getSttModelStatus for live progress while it runs.
  downloadSttModel: publicProcedure.mutation(async () => {
    try {
      const settings = getVoiceSettings()
      if (settings.sttAdapterId === "local-parakeet") await ensureParakeetModel()
      else await ensureModel()
      return {
        status:
          settings.sttAdapterId === "local-parakeet"
            ? await getParakeetModelStatus()
            : await getSttModelStatus(),
      }
    } catch (error) {
      return {
        status:
          getVoiceSettings().sttAdapterId === "local-parakeet"
            ? await getParakeetModelStatus()
            : await getSttModelStatus(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }),

  searchHistory: publicProcedure
    .input(z.object({ query: z.string().default(""), chatId: z.string().optional() }))
    .query(({ input }) => searchVoiceHistory(input.query, input.chatId)),

  getHistoryAudio: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => readSpeechAudio(input.id)),

  deleteHistoryEntry: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => deleteVoiceHistoryEntry(input.id)),

  revealHistoryAudio: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => {
      const audioPath = getVoiceHistoryAudioPath(input.id)
      if (!audioPath) throw new Error("Voice recording not found")
      shell.showItemInFolder(audioPath)
      return { revealed: true as const }
    }),
})
