import type { RunPermissionMode } from "./harness-types"

export const CHAT_MODES = ["write", "plan", "read", "review"] as const

export type ChatMode = (typeof CHAT_MODES)[number]
export type ProviderChatMode = "agent" | "plan"

export const CHAT_MODE_META: Record<
  ChatMode,
  { label: string; description: string; readOnly: boolean }
> = {
  write: {
    label: "Write",
    description: "Read, run tools, and make changes",
    readOnly: false,
  },
  plan: {
    label: "Plan",
    description: "Create a plan before making changes",
    readOnly: true,
  },
  read: {
    label: "Read",
    description: "Inspect and explain without making changes",
    readOnly: true,
  },
  review: {
    label: "Review",
    description: "Review the requested work and report findings",
    readOnly: true,
  },
}

export function normalizeChatMode(value: unknown): ChatMode {
  if (value === "agent") return "write"
  return CHAT_MODES.includes(value as ChatMode) ? (value as ChatMode) : "write"
}

export function isReadOnlyChatMode(mode: ChatMode): boolean {
  return CHAT_MODE_META[mode].readOnly
}

export function resolveChatModePermission(
  mode: ChatMode,
  requestedPermission: RunPermissionMode,
): RunPermissionMode {
  return isReadOnlyChatMode(mode) ? "read-only" : requestedPermission
}

export function toProviderChatMode(mode: ChatMode): ProviderChatMode {
  return mode === "plan" ? "plan" : "agent"
}

export function applyChatModeInstruction(prompt: string, mode: ChatMode): string {
  const instruction =
    mode === "plan"
      ? "Plan mode: inspect the relevant context and produce a plan. Do not implement the plan or modify files."
      : mode === "read"
        ? "Read mode: inspect and explain only. Do not modify files, run mutating commands, or change external state."
        : mode === "review"
          ? "Review mode: review the work requested by the user. Do not modify files or external state. Lead with concrete bugs, regressions, risks, and missing tests ordered by severity. Then list necessary questions and a short summary. If there are no findings, say so explicitly."
          : null

  return instruction ? `<flapstack-mode>\n${instruction}\n</flapstack-mode>\n\n${prompt}` : prompt
}
