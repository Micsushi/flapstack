export {
  CLAUDE_MODELS,
  CODEX_MODELS,
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CHATGPT_CODEX_MODEL_ID,
  DEFAULT_CHATGPT_CODEX_MODEL_WITH_THINKING,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_MODEL_WITH_THINKING,
  DEFAULT_CODEX_THINKING,
  DEFAULT_CLAUDE_MODEL_ID,
  type ClaudeEffortLevel,
  type CodexAuthSurface,
  type CodexThinkingLevel,
} from "../../../../shared/model-catalog"

import type { ClaudeEffortLevel, CodexThinkingLevel } from "../../../../shared/model-catalog"

export function formatClaudeEffortLabel(effort: ClaudeEffortLevel): string {
  if (effort === "max") return "Max"
  if (effort === "xhigh") return "Extra High"
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "none") return "None"
  if (thinking === "xhigh") return "Extra High"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}
