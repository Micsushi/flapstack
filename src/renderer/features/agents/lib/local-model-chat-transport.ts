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
  model: string | null
}

export class LocalModelChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: LocalModelChatTransportConfig) {}

  getConfig(): Readonly<LocalModelChatTransportConfig> {
    return this.config
  }

  updateConfig(config: Partial<LocalModelChatTransportConfig>): void {
    this.config = { ...this.config, ...config }
  }

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const config = this.config
    const model = config.model
    if (!model?.trim()) {
      throw new Error("Choose a local model before sending.")
    }
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = extractChatMessageText(lastUser)
    const mode = normalizeChatMode(
      getAgentSubChatStore(config.chatId)
        .getState()
        .allSubChats.find((subChat) => subChat.id === config.subChatId)?.mode,
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
            chatId: config.chatId,
            subChatId: config.subChatId,
            runId,
            prompt,
            mode,
            model,
            endpoint: config.endpoint,
            cwd: config.cwd,
            ...(config.projectPath ? { projectPath: config.projectPath } : {}),
          },
          createAgentChatSubscriptionObserver(
            controller,
            {
              chatId: config.chatId,
              subChatId: config.subChatId,
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
