import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import {
  agentsLoginModalOpenAtom,
  autoOfflineModeAtom,
  claudeLoginModalConfigAtom,
  enableTasksAtom,
  historyEnabledAtom,
  selectedOllamaModelAtom,
  sessionInfoAtom,
  showOfflineModeFeaturesAtom,
} from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  compactingSubChatsAtom,
  MODEL_ID_MAP,
  pendingAuthRetryMessageAtom,
  subChatModelIdAtomFamily,
  subChatClaudeEffortAtomFamily,
  subChatReasoningEnabledAtomFamily,
} from "../atoms"
import { getAgentSubChatStore } from "../stores/sub-chat-store"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import { handleAgentInputChunk } from "./agent-input-transport"
import type { ChatMode } from "../../../../shared/chat-mode"
import { createDirectRuntimeStream } from "./direct-runtime-chat-transport"
import { resolveAgentHotlineEnabled } from "../../../../shared/agent-hotline"
import { serializePromptParts } from "../../../../shared/prompt-serialization"
import { createStreamChunkBatcher } from "../../../lib/stream-chunk-batcher"
import {
  clearProjectVaultGraphSelection,
  readProjectVaultGraphSelection,
} from "../../project-vault/pending-graph-context"

function openClaudeLoginModal() {
  appStore.set(claudeLoginModalConfigAtom, {
    hideCustomModelSettingsLink: true,
    autoStartAuth: true,
  })
  appStore.set(agentsLoginModalOpenAtom, true)
}

// Error categories and their user-friendly messages
const ERROR_TOAST_CONFIG: Record<
  string,
  {
    title: string
    description: string
    action?: { label: string; onClick: () => void }
  }
> = {
  AUTH_FAILED_SDK: {
    title: "Not logged in",
    description: "Start Claude Code authentication from Flapstack, then retry.",
    action: {
      label: "Connect",
      onClick: openClaudeLoginModal,
    },
  },
  INVALID_API_KEY_SDK: {
    title: "Invalid API key",
    description: "Your Claude API key is invalid. Check your CLI configuration.",
  },
  INVALID_API_KEY: {
    title: "Invalid API key",
    description: "Your Claude API key is invalid. Check your CLI configuration.",
  },
  RATE_LIMIT_SDK: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () => trpcClient.external.openExternal.mutate("https://claude.ai/settings/usage"),
    },
  },
  RATE_LIMIT: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () => trpcClient.external.openExternal.mutate("https://claude.ai/settings/usage"),
    },
  },
  OVERLOADED_SDK: {
    title: "Claude is busy",
    description: "The service is overloaded. Please try again in a few moments.",
  },
  PROCESS_CRASH: {
    title: "Claude crashed",
    description:
      "The Claude process exited unexpectedly. Try sending your message again or rollback.",
  },
  SESSION_EXPIRED: {
    title: "Session expired",
    description: "Your previous chat session expired. Send your message again to start fresh.",
  },
  EXECUTABLE_NOT_FOUND: {
    title: "Claude CLI not found",
    description: "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("npm install -g @anthropic-ai/claude-code"),
    },
  },
  NETWORK_ERROR: {
    title: "Network error",
    description: "Check your internet connection and try again.",
  },
  AUTH_FAILURE: {
    title: "Authentication failed",
    description: "Your session may have expired. Try logging in again.",
  },
  USAGE_POLICY_VIOLATION: {
    title: "Anthropic API hiccup",
    description: "The request was rejected by Anthropic's servers. Please try again shortly.",
  },
  // SDK_ERROR and other unknown errors use chunk.errorText for description
}

type UIMessageChunk = any // Inferred from subscription

type IPCChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string // Original project path for MCP config lookup (when using worktrees)
  projectId?: string
  mode: ChatMode
  model?: string
}

// Image attachment type matching the tRPC schema
type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

export class IPCChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: IPCChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    // Extract prompt and images from last user message
    const lastUser = [...options.messages].reverse().find((m) => m.role === "user")
    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)

    // Get sessionId for resume (server preserves sessionId on abort so
    // the next message can resume with full conversation context)
    const lastAssistant = [...options.messages].reverse().find((m) => m.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    // Read reasoning-output setting dynamically (so toggle applies to existing chats)
    const reasoningOutputEnabled = appStore.get(
      subChatReasoningEnabledAtomFamily(this.config.subChatId),
    )
    const historyEnabled = appStore.get(historyEnabledAtom)
    const enableTasks = appStore.get(enableTasksAtom)

    // Read model selection dynamically per sub-chat (so split panes stay independent)
    const selectedModelId = appStore.get(subChatModelIdAtomFamily(this.config.subChatId))
    const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP["opus"]
    const claudeEffort = appStore.get(subChatClaudeEffortAtomFamily(this.config.subChatId))

    // Get selected Ollama model for offline mode
    const selectedOllamaModel = appStore.get(selectedOllamaModelAtom)
    // Check if offline mode is enabled in settings
    const showOfflineFeatures = appStore.get(showOfflineModeFeaturesAtom)
    const autoOfflineMode = appStore.get(autoOfflineModeAtom)
    const offlineModeEnabled = showOfflineFeatures && autoOfflineMode

    const currentMode =
      getAgentSubChatStore(this.config.chatId)
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode ||
      this.config.mode
    const vaultContextGraphSelection = readProjectVaultGraphSelection(this.config.projectId)

    const directStream = await createDirectRuntimeStream({
      chatId: this.config.chatId,
      subChatId: this.config.subChatId,
      harness: "claude-code",
      prompt,
      ...(typeof lastUser?.id === "string" ? { promptMessageId: lastUser.id } : {}),
      model: modelString,
      mode: currentMode,
      reasoningEffort: claudeEffort,
      reasoningEnabled: reasoningOutputEnabled,
      images,
      hotlineEnabled: resolveAgentHotlineEnabled(options.messages),
      ...(vaultContextGraphSelection ? { vaultContextGraphSelection } : {}),
      abortSignal: options.abortSignal,
    })
    if (directStream) {
      clearProjectVaultGraphSelection(this.config.projectId)
      return directStream
    }

    return new ReadableStream({
      start: (controller) => {
        const chunks = createStreamChunkBatcher<UIMessageChunk>({
          deliver: (batch) => {
            for (const chunk of batch) controller.enqueue(chunk)
          },
        })
        const sub = trpcClient.claude.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            prompt,
            ...(typeof lastUser?.id === "string" ? { promptMessageId: lastUser.id } : {}),
            cwd: this.config.cwd,
            projectPath: this.config.projectPath, // Original project path for MCP config lookup
            mode: currentMode,
            sessionId,
            reasoningEnabled: reasoningOutputEnabled,
            effort: claudeEffort,
            ...(modelString && { model: modelString }),
            ...(selectedOllamaModel && { selectedOllamaModel }),
            historyEnabled,
            offlineModeEnabled,
            enableTasks,
            ...(images.length > 0 && { images }),
            ...(vaultContextGraphSelection ? { vaultContextGraphSelection } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              handleAgentInputChunk(chunk, {
                chatId: this.config.chatId,
                subChatId: this.config.subChatId,
              })

              // Handle compacting status - track in atom for UI display
              if (
                (chunk.type === "tool-input-start" && chunk.toolName === "Compact") ||
                (chunk.type === "tool-input-available" && chunk.toolName === "Compact")
              ) {
                const compacting = appStore.get(compactingSubChatsAtom)
                const newCompacting = new Set(compacting)
                // Compacting started
                newCompacting.add(this.config.subChatId)
                appStore.set(compactingSubChatsAtom, newCompacting)
              }
              if (
                (chunk.type === "tool-output-available" &&
                  chunk.toolCallId?.startsWith("compact-")) ||
                (chunk.type === "tool-output-error" && chunk.toolCallId?.startsWith("compact-"))
              ) {
                const compacting = appStore.get(compactingSubChatsAtom)
                const newCompacting = new Set(compacting)
                // Compacting finished
                newCompacting.delete(this.config.subChatId)
                appStore.set(compactingSubChatsAtom, newCompacting)
              }

              // Handle session init - store MCP servers, plugins, tools info
              if (chunk.type === "session-init") {
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools,
                  mcpServers: chunk.mcpServers,
                  plugins: chunk.plugins,
                  skills: chunk.skills,
                })
              }

              // Handle authentication errors - show Claude login modal
              if (chunk.type === "auth-error") {
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  provider: "claude-code",
                  prompt,
                  ...(images.length > 0 ? { images } : {}),
                  readyToRetry: false,
                })
                toast.error("Claude Code authentication required", {
                  description:
                    "Flapstack uses your local Claude Code credentials. Start Claude login, then retry this message.",
                  duration: 12000,
                  action: {
                    label: "Connect",
                    onClick: openClaudeLoginModal,
                  },
                })
                // Use controller.error() instead of controller.close() so that
                // the SDK Chat properly resets status from "streaming" to "ready"
                // This allows user to retry sending messages after failed auth
                chunks.cancel()
                controller.error(new Error("Authentication required"))
                return
              }

              // Handle retry notification - show friendly toast instead of scary error
              if (chunk.type === "retry-notification") {
                toast.info("Retrying request", {
                  description: chunk.message || "Request was unsuccessful, trying again...",
                  duration: 4000,
                })
                return // don't enqueue retry-notification as a stream chunk
              }

              // Handle errors - show toast to user FIRST before anything else
              if (chunk.type === "error") {
                const category = chunk.debugInfo?.category || "UNKNOWN"

                // Detailed SDK error logging for debugging
                console.error(`[SDK ERROR] ========================================`)
                console.error(`[SDK ERROR] Category: ${category}`)
                console.error(`[SDK ERROR] Error text: ${chunk.errorText}`)
                console.error(`[SDK ERROR] Chat ID: ${this.config.chatId}`)
                console.error(`[SDK ERROR] SubChat ID: ${this.config.subChatId}`)
                console.error(`[SDK ERROR] CWD: ${this.config.cwd}`)
                console.error(`[SDK ERROR] Mode: ${currentMode}`)
                if (chunk.debugInfo) {
                  console.error(`[SDK ERROR] Debug info:`, JSON.stringify(chunk.debugInfo, null, 2))
                }
                console.error(`[SDK ERROR] Full chunk:`, JSON.stringify(chunk, null, 2))
                console.error(`[SDK ERROR] ========================================`)

                // Build detailed error string for copying (available for ALL errors)
                const errorDetails = [
                  `Error: ${chunk.errorText || "Unknown error"}`,
                  `Category: ${category}`,
                  `Chat ID: ${this.config.chatId}`,
                  `SubChat ID: ${this.config.subChatId}`,
                  `CWD: ${this.config.cwd}`,
                  `Mode: ${currentMode}`,
                  `Timestamp: ${new Date().toISOString()}`,
                  chunk.debugInfo
                    ? `Debug Info: ${JSON.stringify(chunk.debugInfo, null, 2)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n")

                // Show toast based on error category
                const config = ERROR_TOAST_CONFIG[category]
                const title = config?.title || "Claude error"
                // For auth/API key failures, prefer original backend error to aid debugging
                const preferOriginalError =
                  category === "AUTH_FAILURE" ||
                  category === "INVALID_API_KEY_SDK" ||
                  category === "INVALID_API_KEY"
                // Use config description if set, otherwise fall back to errorText
                const rawDescription = preferOriginalError
                  ? chunk.errorText || config?.description || "An unexpected error occurred"
                  : config?.description || chunk.errorText || "An unexpected error occurred"
                // Truncate long descriptions for toast (keep first 300 chars)
                const description =
                  rawDescription.length > 300
                    ? rawDescription.slice(0, 300) + "..."
                    : rawDescription

                toast.error(title, {
                  description,
                  duration: 12000,
                  action: {
                    label: "Copy Error",
                    onClick: () => {
                      navigator.clipboard.writeText(errorDetails)
                      toast.success("Error details copied to clipboard")
                    },
                  },
                })
              }

              try {
                chunks.push(chunk)
              } catch {
                // Stream already closed.
              }

              if (chunk.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // Already closed
                }
              }
            },
            onError: (err: Error) => {
              chunks.cancel()
              controller.error(err)
            },
            onComplete: () => {
              chunks.flush()
              // Note: Don't clear pending questions here - let active-chat.tsx handle it
              // via the stream stop detection effect. Clearing here causes race conditions
              // where sync effect immediately restores from messages.
              try {
                controller.close()
              } catch {
                // Already closed
              }
            },
          },
        )
        clearProjectVaultGraphSelection(this.config.projectId)

        // Handle abort
        options.abortSignal?.addEventListener("abort", () => {
          chunks.cancel()
          sub.unsubscribe()
          // trpcClient.claude.cancel.mutate({ subChatId: this.config.subChatId })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null // Not needed for local app
  }

  private extractText(msg: UIMessage | undefined): string {
    return serializePromptParts(msg?.parts)
  }

  /**
   * Extract images from message parts
   * Looks for parts with type "data-image" that have base64Data
   */
  private extractImages(msg: UIMessage | undefined): ImageAttachment[] {
    if (!msg || !msg.parts) return []

    const images: ImageAttachment[] = []

    for (const part of msg.parts) {
      // Check for data-image parts with base64 data
      if (part.type === "data-image" && (part as any).data) {
        const data = (part as any).data
        if (data.base64Data && data.mediaType) {
          images.push({
            base64Data: data.base64Data,
            mediaType: data.mediaType,
            filename: data.filename,
          })
        }
      }
    }

    return images
  }
}
