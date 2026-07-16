import type { ChatTransport, UIMessage } from "ai"
import { getDefaultStore } from "jotai"
import { createElement } from "react"
import { toast } from "sonner"
import { normalizeOpencodeModelId } from "../../../../shared/model-catalog"
import { agentsSettingsDialogActiveTabAtom, agentsSettingsDialogOpenAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import { pendingAuthRetryMessageAtom, subChatReasoningEnabledAtomFamily } from "../atoms"
import { showProviderErrorToast } from "./error-toast"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import { normalizeChatMode } from "../../../../shared/chat-mode"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import {
  bindAgentChatAbort,
  createAgentChatSubscriptionObserver,
  extractChatMessageText,
} from "./subscription-chat-transport"

type Provider = "openrouter" | "nanogpt"
type UIMessageChunk = any

function openProviderSettings(provider: Provider) {
  localStorage.setItem("flapstack:api-provider-focus", provider)
  const store = getDefaultStore()
  store.set(agentsSettingsDialogActiveTabAtom, "api-providers")
  store.set(agentsSettingsDialogOpenAtom, true)
}

function markProviderRetryReady(provider: Provider) {
  const pending = appStore.get(pendingAuthRetryMessageAtom)
  if (pending?.provider === provider) {
    appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
  }
}

function showMissingProviderKeyToast(provider: Provider) {
  const label = provider === "openrouter" ? "OpenRouter" : "NanoGPT"
  let apiKey = ""

  toast.custom(
    (toastId) =>
      createElement(
        "div",
        { className: "w-[380px] rounded-lg border bg-background p-4 shadow-lg" },
        createElement("div", { className: "font-medium" }, `${label} API key required`),
        createElement(
          "div",
          { className: "mt-1 text-sm text-muted-foreground" },
          `Add the ${label} key before retrying this message.`,
        ),
        createElement("input", {
          type: "password",
          autoComplete: "new-password",
          placeholder: `Paste ${label} API key`,
          className:
            "mt-3 h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            apiKey = event.target.value
          },
        }),
        createElement(
          "div",
          { className: "mt-3 flex gap-2" },
          createElement(
            "button",
            {
              className: "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground",
              onClick: async () => {
                if (!apiKey.trim()) {
                  toast.error("Enter an API key first")
                  return
                }
                try {
                  const status = await trpcClient.opencode.setKey.mutate({
                    provider,
                    apiKey: apiKey.trim(),
                  })
                  toast.dismiss(toastId)
                  toast.success(
                    status.sessionOnly
                      ? `${label} key added for this session`
                      : `${label} API key saved`,
                  )
                  markProviderRetryReady(provider)
                } catch (error) {
                  toast.error(`Could not save ${label} key`, {
                    description: error instanceof Error ? error.message : String(error),
                  })
                }
              },
            },
            "Save key",
          ),
          createElement(
            "button",
            {
              className: "rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
              onClick: () => {
                toast.dismiss(toastId)
                openProviderSettings(provider)
              },
            },
            "Open settings",
          ),
        ),
      ),
    { duration: Infinity },
  )
}

export type OpencodeChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
  provider: Provider
  model: string
}

/** Transport for Flapstack-owned OpenCode sidecar runs. */
export class OpencodeChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: OpencodeChatTransportConfig) {
    this.config.model = normalizeOpencodeModelId(config.provider, config.model)
  }

  updateConfig(
    config: Partial<
      Pick<OpencodeChatTransportConfig, "cwd" | "projectPath" | "provider" | "model">
    >,
  ) {
    this.config = { ...this.config, ...config }
    this.config.model = normalizeOpencodeModelId(this.config.provider, this.config.model)
  }

  getConfig(): Readonly<OpencodeChatTransportConfig> {
    return this.config
  }

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = extractChatMessageText(lastUser)
    const images = this.extractImages(lastUser)
    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const sessionId = (lastAssistant?.metadata as AgentMessageMetadata | undefined)?.sessionId
    const reasoningEnabled = appStore.get(subChatReasoningEnabledAtomFamily(this.config.subChatId))
    const mode = normalizeChatMode(
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode,
    )

    return new ReadableStream({
      start: (controller) => {
        if (options.abortSignal?.aborted) {
          controller.close()
          return
        }
        const runId = crypto.randomUUID()
        let unbindAbort: () => void = () => undefined
        let streamClosed = false
        const subscription = trpcClient.opencode.chat.subscribe(
          {
            chatId: this.config.chatId,
            subChatId: this.config.subChatId,
            runId,
            provider: this.config.provider,
            model: this.config.model,
            prompt,
            mode,
            reasoningEnabled,
            reasoningEffort: "high",
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
            ...(images.length ? { images } : {}),
            ...(sessionId ? { sessionId } : {}),
          },
          createAgentChatSubscriptionObserver(
            controller,
            { chatId: this.config.chatId, subChatId: this.config.subChatId },
            (chunk: UIMessageChunk) => {
              if (chunk.type === "opencode-permission-request") {
                const command = typeof chunk.command === "string" ? chunk.command : undefined
                const patterns = Array.isArray(chunk.patterns)
                  ? chunk.patterns.filter(
                      (pattern: unknown): pattern is string => typeof pattern === "string",
                    )
                  : []
                const resolveApproval = (reply: "once" | "always" | "reject") => {
                  void trpcClient.opencode.replyApproval
                    .mutate({
                      requestId: chunk.requestId,
                      reply,
                      ...(reply === "reject" ? { message: "Denied by Flapstack user." } : {}),
                    })
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
                        `${chunk.permission} needs approval`,
                      ),
                      createElement(
                        "div",
                        { className: "mt-1 text-sm text-muted-foreground" },
                        "Review the exact requested scope before choosing.",
                      ),
                      command
                        ? createElement(
                            "div",
                            { className: "mt-3 space-y-1" },
                            createElement(
                              "div",
                              { className: "text-xs font-medium text-muted-foreground" },
                              "Command",
                            ),
                            createElement(
                              "code",
                              {
                                className:
                                  "block max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 text-xs",
                              },
                              command,
                            ),
                          )
                        : null,
                      patterns.length > 0
                        ? createElement(
                            "div",
                            { className: "mt-3 space-y-1" },
                            createElement(
                              "div",
                              { className: "text-xs font-medium text-muted-foreground" },
                              "Requested patterns or paths",
                            ),
                            createElement(
                              "div",
                              { className: "max-h-32 space-y-1 overflow-auto" },
                              ...patterns.map((pattern: string, index: number) =>
                                createElement(
                                  "code",
                                  {
                                    key: `${index}-${pattern}`,
                                    className:
                                      "block whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs",
                                  },
                                  pattern,
                                ),
                              ),
                            ),
                          )
                        : null,
                      createElement(
                        "div",
                        { className: "mt-3 flex gap-2" },
                        ...(
                          [
                            ["Allow once", "once"],
                            ["Always allow", "always"],
                            ["Deny", "reject"],
                          ] as const
                        ).map(([label, reply]) =>
                          createElement(
                            "button",
                            {
                              key: reply,
                              className: "rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
                              onClick: () => {
                                toast.dismiss(toastId)
                                resolveApproval(reply)
                              },
                            },
                            label,
                          ),
                        ),
                      ),
                    ),
                  { duration: Infinity },
                )
                return null
              }
              const normalizedChunk = normalizeOpencodeTransportChunk(chunk)
              if (normalizedChunk.type === "error") {
                if (/add the .* api key/i.test(normalizedChunk.errorText || "")) {
                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    provider: this.config.provider,
                    prompt,
                    ...(images.length > 0 ? { images } : {}),
                    readyToRetry: false,
                  })
                  showMissingProviderKeyToast(this.config.provider)
                } else {
                  showProviderErrorToast(
                    "API provider error",
                    normalizedChunk.errorText || "The provider run failed.",
                    {
                      provider: this.config.provider,
                      model: this.config.model,
                      chatId: this.config.chatId,
                      subChatId: this.config.subChatId,
                    },
                  )
                }
              }
              return normalizedChunk
            },
            () => {
              streamClosed = true
              unbindAbort()
            },
          ),
        )
        unbindAbort = bindAgentChatAbort(
          options.abortSignal,
          subscription,
          () => trpcClient.opencode.cancel.mutate({ subChatId: this.config.subChatId, runId }),
          controller,
        )
        if (streamClosed) unbindAbort()
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // OpenCode subscriptions are tied to the renderer connection. A fresh
    // follow-up message resumes the persisted sidecar session instead.
    return null
  }

  private extractImages(message: UIMessage | undefined) {
    if (!message?.parts) return []
    return message.parts.flatMap((part: any) =>
      part.type === "data-image" && part.data?.base64Data && part.data?.mediaType
        ? [
            {
              base64Data: part.data.base64Data as string,
              mediaType: part.data.mediaType as string,
              ...(part.data.filename ? { filename: part.data.filename as string } : {}),
            },
          ]
        : [],
    )
  }
}

export function normalizeOpencodeTransportChunk(chunk: UIMessageChunk): UIMessageChunk {
  return chunk?.type === "auth-error" ? { ...chunk, type: "error" } : chunk
}
