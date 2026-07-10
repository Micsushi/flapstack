import type { ChatTransport, UIMessage } from "ai"
import { createElement } from "react"
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
    const images = this.extractImages(lastUser)
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
            ...(images.length ? { images } : {}),
            ...(sessionId ? { sessionId } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              if (chunk.type === "opencode-permission-request") {
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
                        "Choose how OpenCode may handle this tool call.",
                      ),
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
      .flatMap((part: any) => {
        if (part.type === "text") return [part.text || ""]
        if (part.type === "file-content") {
          const name = part.filePath?.split("/").pop() || part.filePath || "file"
          return [`\n--- ${name} ---\n${part.content || ""}`]
        }
        return []
      })
      .join("\n")
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
