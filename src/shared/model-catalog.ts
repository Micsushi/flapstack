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
export type CodexReasoningLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"

const CODEX_STANDARD_REASONING_LEVELS: readonly CodexReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
]
const CODEX_DEEP_REASONING_LEVELS: readonly CodexReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]
const CODEX_ULTRA_REASONING_LEVELS: readonly CodexReasoningLevel[] = [
  ...CODEX_DEEP_REASONING_LEVELS,
  "ultra",
]

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    reasoningLevels: CODEX_STANDARD_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoningLevels: CODEX_ULTRA_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    reasoningLevels: CODEX_ULTRA_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    reasoningLevels: CODEX_DEEP_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoningLevels: CODEX_STANDARD_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: true,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    reasoningLevels: CODEX_STANDARD_REASONING_LEVELS,
    authSurfaces: ["chatgpt", "api-key"] as CodexAuthSurface[],
    supportsFastMode: false,
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    reasoningLevels: ["low", "medium", "high", "xhigh"] as readonly CodexReasoningLevel[],
    authSurfaces: ["chatgpt"] as CodexAuthSurface[],
    supportsFastMode: false,
  },
] as const

// ---------------------------------------------------------------------------
// Cursor (`cursor-agent` CLI) — Stage 2 Track D
//
// `cursor-agent --model <id>` accepts a bare model id, `auto`, or an id with
// parameterized overrides, e.g. `claude-opus-4-8[context=1m,effort=high,fast=false]`.
// Cursor iterates quickly and gates many named models behind paid plans, so this
// catalog stays intentionally small and honest. `auto` is always available and
// is the default; named ids are best-effort and validated at launch, not assumed.
// Live ids can be enumerated with `cursor-agent models` / `--list-models`.
// ---------------------------------------------------------------------------

export type CursorEffortLevel = "low" | "medium" | "high"

export const CURSOR_MODELS = [
  { id: "auto", name: "Auto", efforts: [] as readonly CursorEffortLevel[] },
] as const

const CURSOR_MODEL_LABELS: Record<string, string> = Object.fromEntries(
  CURSOR_MODELS.map((model) => [model.id, model.name]),
)

/**
 * Format a Cursor model id (+ optional effort) into the `cursor-agent --model`
 * argument. `auto` and ids without an effort pass through unchanged; an effort
 * is emitted with Cursor's bracket-override syntax: `claude-opus-4-8[effort=high]`.
 * If the id already carries a bracket override it is left untouched.
 */
export function formatCursorModelForCli(modelId: string, effort?: CursorEffortLevel): string {
  const normalized = modelId.trim()
  if (!normalized || normalized === "auto") return normalized || "auto"
  if (normalized.includes("[")) return normalized
  if (!effort) return normalized
  return `${normalized}[effort=${effort}]`
}

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

  // Strip the effort suffix ("gpt-5.5/high", "gpt-5.5[high]") but keep [1m].
  let base = raw.split("/")[0].toLowerCase()

  let suffix = ""
  if (base.endsWith("[1m]")) {
    base = base.slice(0, -4)
    suffix = " 1M"
  } else {
    base = base.replace(/\[[^\]]+\]$/, "")
  }

  const alias = CLAUDE_ALIAS_LABELS[base]
  if (alias) return alias + suffix

  const cursorLabel = CURSOR_MODEL_LABELS[base]
  if (cursorLabel) return cursorLabel + suffix

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

export function formatCodexModelForAcp(modelId: string): string {
  const normalizedModel = modelId.trim()
  const slashMatch = normalizedModel.match(/^(.+)\/([^/]+)$/)
  if (!slashMatch) return normalizedModel

  return `${slashMatch[1]}[${slashMatch[2]}]`
}

export const DEFAULT_CLAUDE_MODEL_ID = "claude-opus-4-8"
export const DEFAULT_CLAUDE_EFFORT: ClaudeEffortLevel = "high"
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.5"
export const DEFAULT_CODEX_REASONING: CodexReasoningLevel = "high"
export const DEFAULT_CODEX_MODEL_WITH_REASONING = `${DEFAULT_CODEX_MODEL_ID}/${DEFAULT_CODEX_REASONING}`
export const DEFAULT_CHATGPT_CODEX_MODEL_ID = "gpt-5.3-codex-spark"
export const DEFAULT_CHATGPT_CODEX_MODEL_WITH_REASONING = `${DEFAULT_CHATGPT_CODEX_MODEL_ID}/${DEFAULT_CODEX_REASONING}`
export const DEFAULT_CURSOR_MODEL_ID = "auto"
