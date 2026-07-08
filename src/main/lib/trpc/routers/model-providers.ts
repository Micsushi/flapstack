import { z } from "zod"
import { publicProcedure, router } from "../index"

const providerSchema = z.enum(["ollama", "openrouter"])

export const modelProvidersRouter = router({
  listProviders: publicProcedure.query(() => {
    return [
      {
        id: "ollama",
        label: "Ollama",
        status: "scaffolded" as const,
        offline: true,
        requiresAppOwnedLoop: true,
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        status: "scaffolded" as const,
        offline: false,
        requiresAppOwnedLoop: true,
      },
    ]
  }),

  getLoopCapabilities: publicProcedure
    .input(z.object({ provider: providerSchema }))
    .query(({ input }) => {
      return {
        provider: input.provider,
        enabled: false,
        tools: ["read-files"],
        blockedTools: ["write-files", "shell", "git"],
        reason:
          "App-owned agent loop requires the later-stage planning gate before tool execution is enabled.",
      }
    }),
})
