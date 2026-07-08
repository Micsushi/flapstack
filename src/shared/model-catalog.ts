export type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

const CLAUDE_DEEP_EFFORTS: readonly ClaudeEffortLevel[] = ["low", "medium", "high", "xhigh", "max"]

// Picker list: only concrete model versions, matching what Claude Code exposes
// by default. Alias ids ("opus", "best", …) stay in CLAUDE_MODEL_ID_MAP so
// previously stored selections keep resolving.
export const CLAUDE_MODELS = [
  { id: "claude-opus-4-8", name: "Opus", version: "4.8", efforts: CLAUDE_DEEP_EFFORTS },
  { id: "claude-fable-5", name: "Fable", version: "5", efforts: CLAUDE_DEEP_EFFORTS },
  { id: "claude-sonnet-5", name: "Sonnet", version: "5", efforts: CLAUDE_DEEP_EFFORTS },
  { id: "claude-haiku-4-5", name: "Haiku", version: "4.5" },
] as const

export const CLAUDE_MODEL_ID_MAP: Record<string, string> = {
  best: "best",
  fable: "fable",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
  opusplan: "opusplan",
  "sonnet[1m]": "sonnet[1m]",
  "opus[1m]": "opus[1m]",
  "claude-fable-5": "claude-fable-5",
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
}

export type CodexAuthSurface = "chatgpt" | "api-key"
export type CodexThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh"

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: ["none", "low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: ["none", "low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    thinkings: ["none", "low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: false,
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
    authSurfaces: ["chatgpt"] as CodexAuthSurface[],
    supportsFastMode: false,
  },
] as const

const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  best: "Best",
  fable: "Fable 5",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  opusplan: "Opus Plan",
}

/**
 * Human-readable label for any stored model id: alias ("opus" → "Opus"),
 * full Claude id ("claude-opus-4-8-20250514" → "Opus 4.8"), or Codex id
 * ("gpt-5.3-codex-spark" → "GPT-5.3 Codex Spark"). Unknown ids pass through.
 */
export function formatModelDisplayName(model?: string | null): string | null {
  const raw = model?.trim()
  if (!raw) return null

  // Strip thinking/effort suffix like "gpt-5.5/high"
  let base = raw.split("/")[0].toLowerCase()

  let suffix = ""
  if (base.endsWith("[1m]")) {
    base = base.slice(0, -4)
    suffix = " 1M"
  }

  const alias = CLAUDE_ALIAS_LABELS[base]
  if (alias) return alias + suffix

  const codexModel = CODEX_MODELS.find((m) => m.id === base)
  if (codexModel) return codexModel.name + suffix

  // Full Claude ids, with optional trailing date: claude-opus-4-8[-YYYYMMDD]
  const withoutDate = base.replace(/-\d{8}$/, "")
  let match = withoutDate.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)$/)
  if (!match) {
    // Legacy version-first ids: claude-3-5-sonnet
    const legacy = withoutDate.match(/^claude-(\d+(?:-\d+)*)-([a-z]+)$/)
    if (legacy) match = [legacy[0], legacy[2], legacy[1]]
  }
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
    const version = match[2].replace(/-/g, ".")
    return `${family} ${version}${suffix}`
  }

  return raw
}

export const DEFAULT_CLAUDE_MODEL_ID = "claude-opus-4-8"
export const DEFAULT_CLAUDE_EFFORT: ClaudeEffortLevel = "high"
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.5"
export const DEFAULT_CODEX_THINKING: CodexThinkingLevel = "high"
export const DEFAULT_CODEX_MODEL_WITH_THINKING = `${DEFAULT_CODEX_MODEL_ID}/${DEFAULT_CODEX_THINKING}`
export const DEFAULT_CHATGPT_CODEX_MODEL_ID = "gpt-5.3-codex-spark"
export const DEFAULT_CHATGPT_CODEX_MODEL_WITH_THINKING = `${DEFAULT_CHATGPT_CODEX_MODEL_ID}/${DEFAULT_CODEX_THINKING}`
