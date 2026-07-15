import type { UIMessage } from "ai"
import { handleAgentInputChunk } from "./agent-input-transport"

type UIMessageChunk = any
type Subscription = { unsubscribe(): void }

export function createAgentChatSubscriptionObserver(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  source: { chatId: string; subChatId: string },
  transform: (chunk: UIMessageChunk) => UIMessageChunk | null = (chunk) => chunk,
) {
  return {
    onData(chunk: UIMessageChunk) {
      handleAgentInputChunk(chunk, source)
      const output = transform(chunk)
      if (output === null) return
      try {
        controller.enqueue(output)
      } catch {
        // Stream already closed.
      }
      if (chunk.type === "finish") closeStream(controller)
    },
    onError(error: unknown) {
      controller.error(error)
    },
    onComplete() {
      closeStream(controller)
    },
  }
}

export function bindAgentChatAbort(
  signal: AbortSignal | undefined,
  subscription: Subscription,
  cancel: () => unknown,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
): void {
  signal?.addEventListener(
    "abort",
    () => {
      subscription.unsubscribe()
      void cancel()
      closeStream(controller)
    },
    { once: true },
  )
}

export function extractChatMessageText(message: UIMessage | undefined): string {
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

function closeStream(controller: ReadableStreamDefaultController<UIMessageChunk>): void {
  try {
    controller.close()
  } catch {
    // Stream already closed.
  }
}
