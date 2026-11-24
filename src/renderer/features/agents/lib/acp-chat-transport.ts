import type { ChatTransport, UIMessage } from "ai"
import { createElement } from "react"
import { toast } from "sonner"
import { normalizeCodexStreamChunk } from "../../../../shared/codex-tool-normalizer"
import { CODEX_PERMISSION_TIMEOUT_MS } from "../../../../shared/harness-types"
import {
  codexLoginModalOpenAtom,
  codexOnboardingAuthMethodAtom,
  codexOnboardingCompletedAtom,
  sessionInfoAtom,
} from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpc, trpcClient } from "../../../lib/trpc"
import { getQueryKey } from "@trpc/react-query"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import {
  antigravityEffortSelectionsAtom,
  antigravityModelSelectionsAtom,
  pendingAuthRetryMessageAtom,
  subChatCodexModelIdAtomFamily,
  subChatCodexReasoningAtomFamily,
  subChatReasoningEnabledAtomFamily,
} from "../atoms"
import { codexSelectionIssue } from "./models"
import { getAgentSubChatStore } from "../stores/sub-chat-store"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import { handleAgentInputChunk } from "./agent-input-transport"
import type { ChatMode } from "../../../../shared/chat-mode"
import { createDirectRuntimeStream, splitCodexRuntimeModel } from "./direct-runtime-chat-transport"
import { resolveAgentHotlineEnabled } from "../../../../shared/agent-hotline"
import { serializePromptParts } from "../../../../shared/prompt-serialization"
import {
  clearProjectVaultGraphSelection,
  readProjectVaultGraphSelection,
} from "../../project-vault/pending-graph-context"

type UIMessageChunk = any

type ACPChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
  projectId?: string
  mode: ChatMode
  provider: "codex" | "antigravity"
  model?: string | null
}

type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

// When a sub-chat hits auth-error, force one fresh Codex ACP session on next send.
const forceFreshSessionSubChats = new Set<string>()
function getStoredCodexCredentials(hasApiKey: boolean): {
  hasApiKey: boolean
  hasSubscription: boolean
  hasAny: boolean
} {
  const hasSubscription =
    appStore.get(codexOnboardingCompletedAtom) &&
    appStore.get(codexOnboardingAuthMethodAtom) === "chatgpt"

  return {
    hasApiKey,
    hasSubscription,
    hasAny: hasApiKey || hasSubscription,
  }
}

async function resolveCodexCredentialsForAuthError(): Promise<{
  hasApiKey: boolean
  hasSubscription: boolean
  hasAny: boolean
}> {
  let hasApiKey = false
  try {
    hasApiKey = (await trpcClient.credentials.status.query({ id: "codex.api-key" })).configured
  } catch {
    hasApiKey = false
  }
  const snapshot = getStoredCodexCredentials(hasApiKey)

  let hasSubscription = false
  try {
    const integration = await trpcClient.codex.getIntegration.query()
    hasSubscription = integration.state === "connected_chatgpt"
  } catch {
    hasSubscription = false
  }

  return {
    hasApiKey: snapshot.hasApiKey,
    hasSubscription,
    hasAny: snapshot.hasApiKey || hasSubscription,
  }
}

async function getSelectedCodexModel(subChatId: string): Promise<string> {
  const modelId = appStore.get(subChatCodexModelIdAtomFamily(subChatId))
  const effort = appStore.get(subChatCodexReasoningAtomFamily(subChatId))
  const query = () => trpcClient.codex.listModels.query()
  const client = getQueryClient()
  const live = await (
    client
      ? client.fetchQuery({
          queryKey: getQueryKey(trpc.codex.listModels, undefined, "query"),
          queryFn: query,
          staleTime: 60_000,
        })
      : query()
  ).catch(() => undefined)
  // The runtime checks the exact selection after resolving account authentication.
  if (!live) return `${modelId}/${effort}`
  const issue = codexSelectionIssue(live, modelId, effort)
  if (issue) throw new Error(issue)
  const model = live.find((entry) => entry.id === modelId)
  return model?.reasoningLevels.length ? `${modelId}/${effort}` : modelId
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: ACPChatTransportConfig) {}

  get provider() {
    return this.config.provider
  }

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const submittedAtMs = Date.now()
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")

    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)

    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    const currentMode =
      getAgentSubChatStore(this.config.chatId)
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode ||
      this.config.mode
    const reasoningEnabled = appStore.get(subChatReasoningEnabledAtomFamily(this.config.subChatId))
    const vaultContextGraphSelection = readProjectVaultGraphSelection(this.config.projectId)
    const directInput = {
      submittedAtMs,
      chatId: this.config.chatId,
      subChatId: this.config.subChatId,
      prompt,
      ...(typeof lastUser?.id === "string" ? { promptMessageId: lastUser.id } : {}),
      mode: currentMode,
      reasoningEnabled,
      images,
      hotlineEnabled: resolveAgentHotlineEnabled(options.messages),
      ...(vaultContextGraphSelection ? { vaultContextGraphSelection } : {}),
      abortSignal: options.abortSignal,
    }
    if (this.provider === "antigravity") {
      const model =
        appStore.get(antigravityModelSelectionsAtom)[this.config.subChatId] ?? this.config.model
      if (!model) throw new Error("Choose an Antigravity model before sending.")
      const stream = await createDirectRuntimeStream({
        ...directInput,
        harness: this.provider,
        model,
        reasoningEffort:
          appStore.get(antigravityEffortSelectionsAtom)[this.config.subChatId + ":" + model] ??
          null,
      })
      if (!stream) throw new Error("The Antigravity runtime is unavailable for this chat.")
      clearProjectVaultGraphSelection(this.config.projectId)
      return stream
    }
    const forceNewSession = forceFreshSessionSubChats.has(this.config.subChatId)
    if (forceNewSession) {
      forceFreshSessionSubChats.delete(this.config.subChatId)
    }
    const selectedModel = await getSelectedCodexModel(this.config.subChatId)
    const directModel = splitCodexRuntimeModel(selectedModel)
    const directStream = await createDirectRuntimeStream({
      ...directInput,
      harness: "codex",
      model: directModel.model,
      reasoningEffort: directModel.effort,
    })
    if (directStream) {
      clearProjectVaultGraphSelection(this.config.projectId)
      return directStream
    }

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false
        let forcedUnsubscribeTimer: ReturnType<typeof setTimeout> | null = null

        const clearForcedUnsubscribeTimer = () => {
          if (!forcedUnsubscribeTimer) return
          clearTimeout(forcedUnsubscribeTimer)
          forcedUnsubscribeTimer = null
        }

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          clearForcedUnsubscribeTimer()
          sub?.unsubscribe()
        }

        sub = trpcClient.codex.chat.subscribe(
          {
            submittedAtMs,
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
            model: selectedModel,
            mode: currentMode,
            reasoningEnabled,
            ...(sessionId ? { sessionId } : {}),
            ...(forceNewSession ? { forceNewSession: true } : {}),
            ...(images.length > 0 ? { images } : {}),
            ...(vaultContextGraphSelection ? { vaultContextGraphSelection } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              handleAgentInputChunk(chunk, {
                chatId: this.config.chatId,
                subChatId: this.config.subChatId,
              })
              if (chunk.type === "codex-permission-request") {
                const options: Array<{ optionId: string; name: string; kind: string }> =
                  Array.isArray(chunk.options)
                    ? chunk.options.filter(
                        (
                          option: unknown,
                        ): option is {
                          optionId: string
                          name: string
                          kind: string
                        } =>
                          Boolean(option) &&
                          typeof (option as any).optionId === "string" &&
                          typeof (option as any).name === "string",
                      )
                    : []
                const rejectOption = options.find((option) => option.kind.startsWith("reject"))
                let answered = false
                const sendDecision = (optionId: string) => {
                  if (answered) return
                  answered = true
                  void trpcClient.codex.replyPermission
                    .mutate({ requestId: chunk.requestId, optionId })
                    .then(({ resolved }) => {
                      if (!resolved) toast.error("Approval request expired")
                    })
                    .catch((error: unknown) => {
                      toast.error("Could not send approval", {
                        description: error instanceof Error ? error.message : String(error),
                      })
                    })
                }

                toast.custom(
                  (toastId) =>
                    createElement(
                      "div",
                      { className: "rounded-lg border bg-background p-4 shadow-lg" },
                      createElement(
                        "div",
                        { className: "font-medium" },
                        chunk.title || "Codex needs approval",
                      ),
                      createElement(
                        "div",
                        { className: "mt-1 text-sm text-muted-foreground" },
                        `Codex ${chunk.kind || "tool"} request. Choose an explicit permission response.`,
                      ),
                      createElement(
                        "div",
                        { className: "mt-3 flex flex-wrap gap-2" },
                        ...options.map((option) =>
                          createElement(
                            "button",
                            {
                              key: option.optionId,
                              className: option.kind.startsWith("reject")
                                ? "rounded-md border px-3 py-1.5 text-sm hover:bg-destructive/10"
                                : "rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
                              onClick: () => {
                                sendDecision(option.optionId)
                                toast.dismiss(toastId)
                              },
                            },
                            option.name,
                          ),
                        ),
                      ),
                    ),
                  {
                    duration: CODEX_PERMISSION_TIMEOUT_MS - 1_000,
                    onDismiss: () => sendDecision(rejectOption?.optionId ?? ""),
                  },
                )
                return
              }

              if (chunk.type === "session-init") {
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools || [],
                  mcpServers: chunk.mcpServers || [],
                  plugins: chunk.plugins || [],
                  skills: chunk.skills || [],
                })
              }

              if (chunk.type === "auth-error") {
                forceFreshSessionSubChats.add(this.config.subChatId)

                void (async () => {
                  const credentials = await resolveCodexCredentialsForAuthError()
                  const shouldAutoRetryOnce = credentials.hasAny && !forceNewSession

                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    provider: "codex",
                    prompt,
                    ...(images.length > 0 && { images }),
                    readyToRetry: shouldAutoRetryOnce,
                  })

                  if (!credentials.hasAny) {
                    appStore.set(codexLoginModalOpenAtom, true)
                  } else if (!shouldAutoRetryOnce) {
                    toast.error("Codex authentication failed", {
                      description: credentials.hasApiKey
                        ? "Saved Codex API key was rejected. Update it in Settings."
                        : "Saved Codex subscription auth failed. Reconnect subscription in Settings.",
                    })
                  }
                })()

                void trpcClient.codex.cleanup
                  .mutate({ subChatId: this.config.subChatId })
                  .catch(() => {
                    // No-op
                  })

                // Force stream status reset so retry can start once auth succeeds.
                controller.error(new Error("Codex authentication required"))
                return
              }

              if (chunk.type === "error") {
                toast.error("Codex error", {
                  description: chunk.errorText || "An unexpected Codex error occurred.",
                })
              }

              try {
                const normalizedChunk = normalizeCodexStreamChunk(chunk) as UIMessageChunk
                controller.enqueue(normalizedChunk)
              } catch {
                // Stream already closed
              }

              if (chunk.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // Stream already closed
                }
              }
            },
            onError: (error: Error) => {
              toast.error("Codex request failed", {
                description: error.message,
              })
              controller.error(error)
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Stream already closed
              }
              safeUnsubscribe()
            },
          },
        )
        clearProjectVaultGraphSelection(this.config.projectId)

        options.abortSignal?.addEventListener("abort", () => {
          // Start server-side cancellation first so the router still has
          // active run ownership when processing cancel(runId).
          const cancelPromise = trpcClient.codex.cancel
            .mutate({ subChatId: this.config.subChatId, runId })
            .catch(() => {
              // No-op
            })

          // Keep stop UX immediate in the client.
          try {
            controller.close()
          } catch {
            // Stream already closed
          }

          // Keep subscription alive briefly so server-side onFinish can persist
          // interrupted response state before cleanup unsubscribe runs.
          void (async () => {
            try {
              await cancelPromise
            } finally {
              clearForcedUnsubscribeTimer()
              forcedUnsubscribeTimer = setTimeout(() => {
                safeUnsubscribe()
              }, 10000)
            }
          })()
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.codex.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {
      // No-op
    })
  }

  private extractText(message: UIMessage | undefined): string {
    return serializePromptParts(message?.parts)
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message?.parts) return []

    const images: ImageAttachment[] = []

    for (const part of message.parts) {
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
