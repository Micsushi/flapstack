import type { ChatTransport, UIMessage } from "ai"
import { trpcClient } from "../../../lib/trpc"
import { handleAgentInputChunk } from "./agent-input-transport"

type UIMessageChunk = any

export type LocalModelChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
  endpoint: string
  model: string
}

export class LocalModelChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly config: LocalModelChatTransportConfig) {}

  getConfig(): Readonly<LocalModelChatTransportConfig> {
    return this.config
  }

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = this.extractText(lastUser)

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        const subscription = trpcClient.localModels.chat.subscribe(
          {
            chatId: this.config.chatId,
            subChatId: this.config.subChatId,
            runId,
            prompt,
            model: this.config.model,
            endpoint: this.config.endpoint,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              handleAgentInputChunk(chunk, {
                chatId: this.config.chatId,
                subChatId: this.config.subChatId,
              })
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
            void trpcClient.localModels.cancel.mutate({ runId })
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
}
