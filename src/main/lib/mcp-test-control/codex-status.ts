import {
  DEFAULT_CHATGPT_CODEX_MODEL_WITH_THINKING,
  DEFAULT_CODEX_MODEL_WITH_THINKING,
} from "../../../shared/model-catalog"

export const SAFE_CHATGPT_CODEX_MODEL = DEFAULT_CHATGPT_CODEX_MODEL_WITH_THINKING

export function normalizeCodexStatus(output: string): {
  state: "connected_chatgpt" | "connected_api_key" | "not_logged_in" | "unknown"
  recommendedModel: string
} {
  const normalized = output.toLowerCase()

  if (normalized.includes("logged in using chatgpt")) {
    return { state: "connected_chatgpt", recommendedModel: SAFE_CHATGPT_CODEX_MODEL }
  }

  if (normalized.includes("api key") && normalized.includes("logged in")) {
    return { state: "connected_api_key", recommendedModel: DEFAULT_CODEX_MODEL_WITH_THINKING }
  }

  if (normalized.includes("not logged in") || normalized.includes("login")) {
    return { state: "not_logged_in", recommendedModel: SAFE_CHATGPT_CODEX_MODEL }
  }

  return { state: "unknown", recommendedModel: SAFE_CHATGPT_CODEX_MODEL }
}
