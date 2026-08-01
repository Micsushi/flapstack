import type { ChatTransport, UIMessage } from "ai"
import { trpcClient } from "../../../lib/trpc"
import {
  bindAgentChatAbort,
  createAgentChatSubscriptionObserver,
  extractChatMessageText,
} from "./subscription-chat-transport"
import { normalizeChatMode } from "../../../../shared/chat-mode"
import { getAgentSubChatStore } from "../stores/sub-chat-store"

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
    const mode = normalizeChatMode(
      getAgentSubChatStore(this.config.chatId)
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
        const subscription = trpcClient.localModels.chat.subscribe(
          {
            chatId: this.config.chatId,
            subChatId: this.config.subChatId,
            runId,
            prompt,
            mode,
            model: this.config.model,
            endpoint: this.config.endpoint,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
          },
          createAgentChatSubscriptionObserver(
            controller,
            {
              chatId: this.config.chatId,
              subChatId: this.config.subChatId,
            },
            undefined,
            () => {
              streamClosed = true
              unbindAbort()
            },
          ),
        )
        unbindAbort = bindAgentChatAbort(
          options.abortSignal,
          subscription,
          () => trpcClient.localModels.cancel.mutate({ runId }),
          controller,
        )
        if (streamClosed) unbindAbort()
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
