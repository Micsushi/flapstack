/**
 * Agents feature constants
 */

import type { HarnessChipKind, RunPermissionMode } from "../../../shared/harness-types"

export type DevicePreset = {
  name: string
  width: number
  height: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { name: "Custom", width: 397, height: 852 },
  { name: "iPhone 16", width: 393, height: 852 },
  { name: "iPhone 16 Pro", width: 393, height: 852 },
  { name: "iPhone 16 Pro Max", width: 430, height: 932 },
  { name: "iPhone 16 Plus", width: 430, height: 932 },
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPad Mini", width: 744, height: 1133 },
  { name: "iPad Air", width: 820, height: 1180 },
  { name: "iPad Pro", width: 1024, height: 1366 },
  { name: "Android Compact", width: 360, height: 640 },
  { name: "Android Medium", width: 412, height: 915 },
] as const

// Scale presets for preview
export const SCALE_PRESETS = [50, 75, 100, 125, 150] as const

export const AGENTS_PREVIEW_CONSTANTS = {
  DEVICE_PRESETS,
  SCALE_PRESETS,
  DEFAULT_WIDTH: 397,
  DEFAULT_HEIGHT: 852,
  MIN_WIDTH: 100,
  MAX_WIDTH: 2000,
  MIN_HEIGHT: 320,
  MAX_HEIGHT: 2000,
  MIN_SCALE: 25,
  MAX_SCALE: 200,
} as const

export type AgentsPreviewConstants = typeof AGENTS_PREVIEW_CONSTANTS

export type HarnessChipMeta = {
  name: string
  color: "blue" | "orange" | "green" | "purple" | "rose" | "teal" | "gray"
  className: string
}

export const HARNESS_CHIP_META: Record<HarnessChipKind, HarnessChipMeta> = {
  codex: {
    name: "Codex",
    color: "blue",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  "claude-code": {
    name: "Claude Code",
    color: "orange",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  "cursor-agent": {
    name: "Cursor",
    color: "teal",
    className: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  local: {
    name: "Local",
    color: "green",
    className: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  },
  openrouter: {
    name: "OpenRouter",
    color: "purple",
    className: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
  nanogpt: {
    name: "NanoGPT",
    color: "rose",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  custom: {
    name: "Custom",
    color: "gray",
    className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  },
  unknown: {
    name: "Unknown",
    color: "gray",
    className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  },
} as const

export function getHarnessChipMeta(harness?: string | null): HarnessChipMeta {
  if (harness && harness in HARNESS_CHIP_META) {
    return HARNESS_CHIP_META[harness as HarnessChipKind]
  }

  return HARNESS_CHIP_META.unknown
}

export function inferHarnessFromModel(model?: string | null): HarnessChipKind | null {
  const normalized = model?.toLowerCase().trim()
  if (!normalized) return null
  if (
    normalized.includes("claude") ||
    normalized.includes("opus") ||
    normalized.includes("sonnet") ||
    normalized.includes("haiku")
  ) {
    return "claude-code"
  }
  // `auto` is a generic model id. Use the persisted harness for Cursor runs
  // instead of mislabelling any legacy/unknown `auto` model as Cursor.
  if (normalized.includes("cursor")) {
    return "cursor-agent"
  }
  if (normalized.includes("codex") || normalized.startsWith("gpt-")) {
    return "codex"
  }
  if (normalized.includes("openrouter")) {
    return "openrouter"
  }
  if (normalized.includes("nanogpt") || normalized.includes("nano-gpt")) {
    return "nanogpt"
  }
  if (normalized.includes("local") || normalized.includes("ollama")) {
    return "local"
  }
  return null
}

export function getModelChipMeta(model?: string | null, harness?: string | null): HarnessChipMeta {
  return getHarnessChipMeta(harness || inferHarnessFromModel(model))
}

export const RUN_PERMISSION_MODE_LABELS: Record<RunPermissionMode, string> = {
  "read-only": "Read-only",
  "ask-before-edits": "Ask before edits",
  "auto-edit-project-only": "Auto-edit project only",
  "full-access": "Full access",
  custom: "Custom",
} as const

export const RUN_PERMISSION_MODE_OPTIONS = [
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
] as const satisfies readonly RunPermissionMode[]

export function formatPermissionMode(mode?: string | null): string {
  if (mode && mode in RUN_PERMISSION_MODE_LABELS) {
    return RUN_PERMISSION_MODE_LABELS[mode as RunPermissionMode]
  }

  return "Unknown"
}
