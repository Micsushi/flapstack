import { z } from "zod"
import { requestOllamaJson } from "./request-json"

const discoverySchema = z.object({
  models: z.array(z.object({ name: z.string().min(1).max(512) })).max(10_000),
  version: z.string().optional(),
})

/**
 * Ollama detector and status checker
 */

export interface OllamaStatus {
  available: boolean // Is Ollama running and accessible
  version?: string // Ollama version
  models: string[] // Installed models
  recommendedModel?: string // Best model for coding
}

/**
 * Check if Ollama is running and get status
 */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  try {
    const data = discoverySchema.parse(
      await requestOllamaJson("/api/tags", { timeoutMs: 2_000, maxBytes: 2 * 1024 * 1024 }),
    )
    const models = data.models.map((model) => model.name)

    // Recommended coding models (in order of preference)
    // Check for exact matches first, then check for any qwen/deepseek/codestral variant
    const codingModels = [
      "qwen2.5-coder:7b",
      "qwen2.5-coder:3b",
      "qwen2.5-coder:1.5b",
      "qwen3-coder:30b",
      "qwen3-coder:14b",
      "qwen3-coder:8b",
      "qwen3-coder:4b",
      "deepseek-coder:6.7b",
      "deepseek-coder:33b",
      "codestral:22b",
    ]

    let recommendedModel = codingModels.find((m) => models.includes(m))

    // If no exact match, try to find any qwen-coder, deepseek-coder, or codestral variant
    if (!recommendedModel) {
      recommendedModel = models.find(
        (m: string) =>
          (m.includes("qwen") && m.includes("coder")) ||
          (m.includes("deepseek") && m.includes("coder")) ||
          m.includes("codestral"),
      )
    }

    return {
      available: true,
      models,
      recommendedModel: recommendedModel || models[0], // Fallback to any model
      version: data.version,
    }
  } catch {
    // Ollama not available - no need to log, this is expected when offline mode is disabled
    return { available: false, models: [] }
  }
}

/**
 * Get Ollama config for offline mode
 */
export function getOllamaConfig(modelName?: string): {
  model: string
  token: string
  baseUrl: string
} {
  return {
    model: modelName || "qwen2.5-coder:7b",
    token: "ollama",
    baseUrl: "http://localhost:11434",
  }
}
