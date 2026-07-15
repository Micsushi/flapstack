export const AGENT_HARNESSES = [
  "codex",
  "claude-code",
  "cursor-agent",
  "openrouter",
  "nanogpt",
  "local",
] as const

export type AgentHarness = (typeof AGENT_HARNESSES)[number]

export function isAgentHarness(value: string): value is AgentHarness {
  return (AGENT_HARNESSES as readonly string[]).includes(value)
}

export const OPENCODE_HARNESSES = ["openrouter", "nanogpt"] as const
export type OpencodeHarness = (typeof OPENCODE_HARNESSES)[number]

export function isOpencodeHarness(harness: string | null | undefined): harness is OpencodeHarness {
  return harness === "openrouter" || harness === "nanogpt"
}

export type FutureHarnessProvider = "custom"
export type HarnessProvider = AgentHarness | FutureHarnessProvider
export type HarnessChipKind = HarnessProvider | "unknown"

export type RunPermissionMode =
  "read-only" | "ask-before-edits" | "auto-edit-project-only" | "full-access" | "custom"

export type HarnessPermissionControl =
  | "process-cwd"
  | "acp-session-cwd"
  | "codex-sandbox"
  | "codex-approval-policy"
  | "cursor-mode"
  | "cursor-sandbox"
  | "cursor-approval"
  | "filesystem-write-scope"
  | "shell"
  | "network"
  | "git"
  | "browser"
  | "mcp"
  | "secrets"
  | "subagents"
  | "third-party-mcp"
  | "product-mcp"

export type HarnessPermissionEnforcement = {
  control: HarnessPermissionControl
  applied: boolean
  value?: string
  reason?: string
}

export type HarnessPermissionLimitation = {
  control: HarnessPermissionControl
  requested: string
  reason: string
}

export type HarnessPermissionApplication = {
  requested: RunPermissionMode
  applied: boolean
  degraded: boolean
  enforced: HarnessPermissionEnforcement[]
  limitations: HarnessPermissionLimitation[]
  warnings: string[]
  reason: string
}

export type RunPromptPart =
  | {
      type: "text"
      text: string
    }
  | {
      type: "data-image"
      data: {
        url?: string
        mediaType?: string
        filename?: string
        base64Data?: string
      }
    }
  | {
      type: "file-content"
      filePath: string
      content: string
    }

export type RunAttachment =
  | {
      kind: "image"
      id?: string
      filename?: string
      mediaType: string
      base64Data: string
    }
  | {
      kind: "file"
      id?: string
      filename: string
      mediaType?: string
      base64Data?: string
      path?: string
      size?: number
    }
  | {
      kind: "text"
      id?: string
      filename?: string
      text: string
      source?: string
    }

export const CODEX_PERMISSION_TIMEOUT_MS = 60_000

export interface RunInput {
  chatId: string
  subChatId: string
  prompt: string
  promptParts?: RunPromptPart[]
  harness: AgentHarness
  model?: string
  permissionMode: RunPermissionMode
  worktreePath?: string | null
  attachments?: RunAttachment[]
}
