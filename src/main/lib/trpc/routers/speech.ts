import { z } from "zod"
import {
  getNativeTtsAvailability,
  resolveSttAdapter,
  resolveTtsAdapter,
  sttAdapters,
  ttsAdapters,
} from "../../speech/registry"
import { getVoiceSettings, setVoiceSettings } from "../../speech/settings"
import { createFallbackSpokenSummary } from "../../speech/spoken-summary"
import { publicProcedure, router } from "../index"

export const speechRouter = router({
  getSettings: publicProcedure.query(() => {
    return getVoiceSettings()
  }),

  updateSettings: publicProcedure
    .input(
      z.object({
        sttAdapterId: z.string().optional(),
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

  listAdapters: publicProcedure.query(() => {
    const settings = getVoiceSettings()
    const sttAdapter = resolveSttAdapter(settings)
    const ttsAdapter = resolveTtsAdapter(settings)

    return {
      stt: sttAdapters,
      tts: ttsAdapters,
      selected: {
        sttAdapterId: sttAdapter.id,
        ttsAdapterId: ttsAdapter.id,
      },
      availability: {
        nativeTts: getNativeTtsAvailability(),
        localStt: {
          available: false,
          status: "not-configured" as const,
          reason: "Local STT engine selection is gated by Stage 2 speech architecture decisions.",
        },
      },
    }
  }),

  createSpokenFallback: publicProcedure
    .input(z.object({ markdown: z.string() }))
    .mutation(({ input }) => {
      return { spoken: createFallbackSpokenSummary(input.markdown) }
    }),
})
