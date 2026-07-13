import { z } from "zod"
import {
  getNativeTtsAvailability,
  resolveAvailableTtsAdapter,
  resolveSttAdapter,
  resolveSupportedTtsVoiceId,
  resolveTtsVoiceId,
  resolveTtsAdapter,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapterImplementations,
  ttsAdapters,
} from "../../speech/registry"
import { getVoiceSettings, setVoiceSettings } from "../../speech/settings"
import { createFallbackSpokenSummary } from "../../speech/spoken-summary"
import { resolveSpeechText } from "../../speech/speech-text"
import { SpeechRequestOwnership } from "../../speech/request-ownership"
import { ensureModel, getSttModelStatus, listWhisperModels } from "../../speech/stt-whisper-cpp"
import {
  ensureParakeetModel,
  getParakeetModelStatus,
  parakeetSidecar,
  PARAKEET_MODEL,
} from "../../speech/stt-parakeet-streaming"
import { speakWithTtsFallback } from "../../speech/tts-fallback"
import { nativeTtsAdapter } from "../../speech/tts-native"
import {
  createSpeechSynthesisKey,
  findReusableSpeech,
  getStoredSpokenText,
  persistSpokenText,
  readSpeechAudio,
  recordSpeech,
  searchVoiceHistory,
  deleteVoiceHistoryEntry,
  getVoiceHistoryAudioPath,
} from "../../speech/history"
import { shell } from "electron"
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
      }),
    )
    .mutation(({ input }) => {
      const previous = getVoiceSettings()
      const next = setVoiceSettings(input)
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

      const settings = getVoiceSettings()
      const storedText = getStoredSpokenText(input.subChatId, input.messageId)
      const text = resolveSpeechText(input.text, storedText)
      if (!text)
        return {
          skipped: true as const,
          reason: "no-speakable-text",
          artifactId: null,
          historySaved: true as const,
          historyError: null,
        }
      persistSpokenText({
        subChatId: input.subChatId,
        messageId: input.messageId,
        text,
      })
      const adapter = await resolveAvailableTtsAdapter(settings)
      if (!isSpeechRequestActive(windowId, requestId))
        throw new Error("Speech request was cancelled.")
      const requestedVoiceId = resolveTtsVoiceId(
        settings.ttsAdapterId,
        adapter.id,
        input.voiceId ?? settings.voiceByTtsAdapterId[settings.ttsAdapterId] ?? settings.voiceId,
      )
      const resolvedVoiceId = resolveSupportedTtsVoiceId(
        requestedVoiceId,
        await adapter.listVoices(),
      )
      const rate = input.rate ?? settings.rate
      const synthesisKey = createSpeechSynthesisKey({
        text,
        adapterId: adapter.id,
        voiceId: resolvedVoiceId,
        rate,
      })
      const reusable = input.chatId
        ? await findReusableSpeech({
            chatId: input.chatId,
            messageId: input.messageId,
            synthesisKey,
          })
        : null
      if (reusable)
        return {
          ...reusable.result,
          spokenText: text,
          skipped: false as const,
          artifactId: reusable.id,
          historySaved: true as const,
          historyError: null,
        }
      const ttsInput = {
        text,
        voiceId: resolvedVoiceId,
        rate,
        requestScopeId,
        shouldContinue: () => isSpeechRequestActive(windowId, requestId),
      }
      const result = await speakWithTtsFallback(adapter, nativeTtsAdapter, ttsInput, {
        shouldContinue: () => isSpeechRequestActive(windowId, requestId),
      })
      if (!isSpeechRequestActive(windowId, requestId))
        throw new Error("Speech request was cancelled.")
      let artifact = null
      let historyError: string | null = null
      if (input.chatId) {
        try {
          artifact = await recordSpeech({
            chatId: input.chatId,
            subChatId: input.subChatId,
            messageId: input.messageId,
            text,
            result,
            synthesisKey,
            voiceId: resolvedVoiceId,
            rate,
          })
        } catch (error) {
          historyError = error instanceof Error ? error.message : String(error)
          console.error("[Speech] Playback succeeded but history persistence failed:", error)
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
    }),

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
