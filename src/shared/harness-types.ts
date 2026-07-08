export const AGENT_HARNESSES = ["codex", "claude-code"] as const

export type AgentHarness = (typeof AGENT_HARNESSES)[number]

export type FutureHarnessProvider = "local" | "openrouter" | "custom"
export type HarnessProvider = AgentHarness | FutureHarnessProvider
export type HarnessChipKind = HarnessProvider | "unknown"

export type RunPermissionMode =
  "read-only" | "ask-before-edits" | "auto-edit-project-only" | "full-access" | "custom"

export type HarnessPermissionControl =
  | "process-cwd"
  | "acp-session-cwd"
  | "codex-sandbox"
  | "codex-approval-policy"
  | "filesystem-write-scope"
  | "shell"
  | "network"
  | "git"
  | "browser"
  | "mcp"
  | "secrets"

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
