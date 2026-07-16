import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import type { ChatMode } from "../../../../shared/chat-mode"

type UIMessageChunk = any

type RemoteChatTransportConfig = {
  chatId: string
  subChatId: string
  subChatName: string
  sandboxUrl: string
  mode: ChatMode
  model?: string // Claude model ID (e.g., "claude-sonnet-4-6")
}

/**
 * Remote chat transport for sandbox chats
 */
export class RemoteChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: RemoteChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    void options
    toast.error("Hosted sandbox chats are disabled in Flapstack")
    throw new Error("Hosted sandbox chats are disabled in Flapstack")
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // TODO: Implement stream reconnection using stream_id from sub-chat
    return null
  }
}
