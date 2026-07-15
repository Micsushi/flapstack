import type { ChatTransport, UIMessage } from "ai"
import { trpcClient } from "../../../lib/trpc"
import {
  bindAgentChatAbort,
  createAgentChatSubscriptionObserver,
  extractChatMessageText,
} from "./subscription-chat-transport"

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
    const prompt = extractChatMessageText(lastUser)

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
          createAgentChatSubscriptionObserver(controller, {
            chatId: this.config.chatId,
            subChatId: this.config.subChatId,
          }),
        )
        bindAgentChatAbort(
          options.abortSignal,
          subscription,
          () => trpcClient.localModels.cancel.mutate({ runId }),
          controller,
        )
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
