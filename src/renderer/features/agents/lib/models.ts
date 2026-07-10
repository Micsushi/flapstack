export {
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CHATGPT_CODEX_MODEL_ID,
  DEFAULT_CHATGPT_CODEX_MODEL_WITH_THINKING,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_MODEL_WITH_THINKING,
  DEFAULT_CODEX_THINKING,
  DEFAULT_CURSOR_MODEL_ID,
  DEFAULT_CLAUDE_MODEL_ID,
  formatCursorModelForCli,
  type ClaudeEffortLevel,
  type CodexAuthSurface,
  type CodexThinkingLevel,
  type CursorEffortLevel,
} from "../../../../shared/model-catalog"

import type {
  ClaudeEffortLevel,
  CodexThinkingLevel,
  CursorEffortLevel,
} from "../../../../shared/model-catalog"

export function formatClaudeEffortLabel(effort: ClaudeEffortLevel): string {
  if (effort === "max") return "Max"
  if (effort === "xhigh") return "Extra High"
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "none") return "None"
  if (thinking === "xhigh") return "Extra High"
  if (thinking === "max") return "Max"
  if (thinking === "ultra") return "Ultra"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

export function formatCursorEffortLabel(effort: CursorEffortLevel): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}
