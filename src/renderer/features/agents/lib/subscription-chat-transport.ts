import type { UIMessage } from "ai"
import { serializePromptParts } from "../../../../shared/prompt-serialization"
import { handleAgentInputChunk } from "./agent-input-transport"

type UIMessageChunk = any
type Subscription = { unsubscribe(): void }

export function createAgentChatSubscriptionObserver(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  source: { chatId: string; subChatId: string },
  transform: (chunk: UIMessageChunk) => UIMessageChunk | null = (chunk) => chunk,
  onClose: () => void = () => undefined,
) {
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    onClose()
    closeStream(controller)
  }
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
      if (chunk.type === "finish") finish()
    },
    onError(error: unknown) {
      if (closed) return
      closed = true
      onClose()
      controller.error(error)
    },
    onComplete() {
      finish()
    },
  }
}

export function bindAgentChatAbort(
  signal: AbortSignal | undefined,
  subscription: Subscription,
  cancel: () => unknown,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
): () => void {
  if (!signal) return () => undefined
  const abort = () => {
    subscription.unsubscribe()
    void cancel()
    closeStream(controller)
  }
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  return () => signal.removeEventListener("abort", abort)
}

export function extractChatMessageText(message: UIMessage | undefined): string {
  return serializePromptParts(message?.parts)
}

function closeStream(controller: ReadableStreamDefaultController<UIMessageChunk>): void {
  try {
    controller.close()
  } catch {
    // Stream already closed.
  }
}
