import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import { trpcClient } from "../../../lib/trpc"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"

type Provider = "openrouter" | "nanogpt"
type UIMessageChunk = any

export type OpencodeChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  provider: Provider
  model: string
}

/** Transport for Flapstack-owned OpenCode sidecar runs. */
export class OpencodeChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: OpencodeChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = this.extractText(lastUser)
    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const sessionId = (lastAssistant?.metadata as AgentMessageMetadata | undefined)?.sessionId

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        const subscription = trpcClient.opencode.chat.subscribe(
          {
            chatId: this.config.chatId,
            subChatId: this.config.subChatId,
            runId,
            provider: this.config.provider,
            model: this.config.model,
            prompt,
            cwd: this.config.cwd,
            ...(sessionId ? { sessionId } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              if (chunk.type === "opencode-permission-request") {
                toast.info(`${chunk.permission} needs approval`, {
                  description: "Open the pending approvals panel to allow or deny this action.",
                })
                return
              }
              if (chunk.type === "error") {
                toast.error("API provider error", {
                  description: chunk.errorText || "The provider run failed.",
                })
              }
              try {
                controller.enqueue(chunk)
              } catch {
                // Stream already closed.
              }
              if (chunk.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // Stream already closed.
                }
              }
            },
            onError: (error) => controller.error(error),
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Stream already closed.
              }
            },
          },
        )

        options.abortSignal?.addEventListener(
          "abort",
          () => {
            subscription.unsubscribe()
            void trpcClient.opencode.cancel.mutate({ subChatId: this.config.subChatId, runId })
            try {
              controller.close()
            } catch {
              // Stream already closed.
            }
          },
          { once: true },
        )
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // OpenCode subscriptions are tied to the renderer connection. A fresh
    // follow-up message resumes the persisted sidecar session instead.
    return null
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message) return ""
    return message.parts
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join("\n")
  }
}
