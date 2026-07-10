import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import { DEFAULT_CURSOR_MODEL_ID } from "../../../../shared/model-catalog"
import { subChatCursorModelIdAtomFamily } from "../atoms"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"

/**
 * Client transport for the Cursor (`cursor-agent`) harness — Stage 2 Track D.
 *
 * Mirrors {@link ACPChatTransport}: it subscribes to the server-side
 * `cursor.chat` observable (which spawns cursor-agent and streams stream-json
 * translated into UIMessageChunks) and pipes chunks into a ReadableStream that
 * the AI SDK `useChat` loop consumes. Persistence happens server-side, so this
 * transport only forwards chunks, surfaces auth/errors, and handles cancel.
 *
 * NOTE (D5 wiring): to make Cursor selectable end-to-end, `active-chat.tsx`
 * must branch to this transport when the chat provider is `cursor-agent`
 * (alongside the existing `codex` / `claude-code` branches) and the harness
 * selector must offer Cursor. Those selector/default decisions are the deferred
 * integration step documented in STAGE2-TRACK.md.
 */

type UIMessageChunk = any

type CursorChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
}

type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

// After an auth-error, force a fresh cursor-agent session on the next send.
const forceFreshSessionSubChats = new Set<string>()

function getSelectedCursorModel(subChatId: string): string {
  return appStore.get(subChatCursorModelIdAtomFamily(subChatId)) || DEFAULT_CURSOR_MODEL_ID
}

export class CursorChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: CursorChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)

    // cursor-agent's verified headless CLI has no image-input surface. Reject
    // before persisting/sending a prompt so an attachment is never shown as if
    // Cursor had received it.
    if (images.length > 0) {
      toast.error("Cursor does not support image attachments yet")
      throw new Error("Cursor does not support image attachments yet")
    }

    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    const forceNewSession = forceFreshSessionSubChats.has(this.config.subChatId)
    if (forceNewSession) forceFreshSessionSubChats.delete(this.config.subChatId)

    const model = getSelectedCursorModel(this.config.subChatId)

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          sub?.unsubscribe()
        }

        sub = trpcClient.cursor.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
            model,
            ...(sessionId ? { sessionId } : {}),
            ...(forceNewSession ? { forceNewSession: true } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              if (chunk.type === "auth-error") {
                forceFreshSessionSubChats.add(this.config.subChatId)
                toast.error("Cursor authentication required", {
                  description: chunk.errorText || "Run `cursor-agent login`, then retry.",
                })
                void trpcClient.cursor.cleanup
                  .mutate({ subChatId: this.config.subChatId })
                  .catch(() => {})
                controller.error(new Error("Cursor authentication required"))
                return
              }

              if (chunk.type === "error") {
                toast.error("Cursor error", {
                  description: chunk.errorText || "An unexpected cursor-agent error occurred.",
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
                  // Already closed.
                }
              }
            },
            onError: (error: Error) => {
              toast.error("Cursor request failed", { description: error.message })
              controller.error(error)
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Already closed.
              }
              safeUnsubscribe()
            },
          },
        )

        options.abortSignal?.addEventListener("abort", () => {
          void trpcClient.cursor.cancel
            .mutate({ subChatId: this.config.subChatId, runId })
            .catch(() => {})
          try {
            controller.close()
          } catch {
            // Already closed.
          }
          safeUnsubscribe()
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.cursor.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {})
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message?.parts) return ""
    const textParts: string[] = []
    const fileContents: string[] = []
    for (const part of message.parts) {
      if (part.type === "text" && (part as any).text) {
        textParts.push((part as any).text)
      } else if ((part as any).type === "file-content") {
        const filePart = part as any
        const fileName = filePart.filePath?.split("/").pop() || filePart.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${filePart.content}`)
      }
    }
    return textParts.join("\n") + fileContents.join("")
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
