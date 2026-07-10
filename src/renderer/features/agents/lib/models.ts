export {
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CHATGPT_CODEX_MODEL_ID,
  DEFAULT_CHATGPT_CODEX_MODEL_WITH_REASONING,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_MODEL_WITH_REASONING,
  DEFAULT_CODEX_REASONING,
  DEFAULT_CURSOR_MODEL_ID,
  DEFAULT_CLAUDE_MODEL_ID,
  formatCursorModelForCli,
  type ClaudeEffortLevel,
  type CodexAuthSurface,
  type CodexReasoningLevel,
  type CursorEffortLevel,
} from "../../../../shared/model-catalog"

import type {
  ClaudeEffortLevel,
  CodexReasoningLevel,
  CursorEffortLevel,
} from "../../../../shared/model-catalog"

export function formatClaudeEffortLabel(effort: ClaudeEffortLevel): string {
  if (effort === "max") return "Max"
  if (effort === "xhigh") return "Extra High"
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function formatCodexReasoningLevelLabel(reasoning: CodexReasoningLevel): string {
  if (reasoning === "none") return "None"
  if (reasoning === "xhigh") return "Extra High"
  if (reasoning === "max") return "Max"
  if (reasoning === "ultra") return "Ultra"
  return reasoning.charAt(0).toUpperCase() + reasoning.slice(1)
}

export function formatCursorEffortLabel(effort: CursorEffortLevel): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}
