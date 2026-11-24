import type { CodexProtocolNotification } from "./protocol-client"

const FLUSH_MS = 24
const MAX_DELTA_LENGTH = 8_192
const MAX_PENDING_STREAMS = 16

function deltaKey({ method, params }: CodexProtocolNotification) {
  if (typeof params.delta !== "string" || !params.delta || params.eventId != null) return
  if (typeof params.turnId !== "string" || typeof params.itemId !== "string") return
  const stream =
    method === "item/reasoning/summaryTextDelta"
      ? "summary"
      : method === "item/reasoning/textDelta" &&
          (params.displayable === true ||
            params.visibility === "provider-visible" ||
            params.contentVisibility === "provider-visible")
        ? "content"
        : null
  if (!stream) return
  const index = stream === "summary" ? params.summaryIndex : params.contentIndex
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return
  return JSON.stringify([params.threadId, params.turnId, params.itemId, stream, index])
}

/** Only provider-approved text can enter a batch. Lifecycle, tool and private events stay ordered. */
export async function* coalesceReasoningDeltas(
  source: AsyncIterable<CodexProtocolNotification>,
): AsyncIterable<CodexProtocolNotification> {
  const notifications = source[Symbol.asyncIterator]()
  const pending = new Map<string, CodexProtocolNotification>()
  let next: Promise<IteratorResult<CodexProtocolNotification>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: Promise<null> | undefined

  function drain() {
    clearTimeout(timer)
    deadline = undefined
    const batch = [...pending.values()]
    pending.clear()
    return batch
  }

  try {
    for (;;) {
      next ??= notifications.next()
      const result = deadline ? await Promise.race([next, deadline]) : await next
      if (result === null) {
        yield* drain()
        continue
      }
      next = undefined
      if (result.done) break
      const notification = result.value
      const key = deltaKey(notification)
      if (key === undefined) {
        yield* drain()
        yield notification
        continue
      }

      const previous = pending.get(key)
      const incoming = notification.params.delta as string
      if (
        pending.size >= MAX_PENDING_STREAMS ||
        (previous && (previous.params.delta as string).length + incoming.length > MAX_DELTA_LENGTH)
      ) {
        yield* drain()
      }
      const base = pending.get(key)
      pending.set(
        key,
        base
          ? {
              ...base,
              params: { ...base.params, delta: String(base.params.delta) + incoming },
            }
          : notification,
      )
      deadline ??= new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), FLUSH_MS)
      })
    }
    yield* drain()
  } catch (error) {
    yield* drain()
    throw error
  } finally {
    clearTimeout(timer)
    // A pending next() may be waiting for provider output until the App Server closes.
    void notifications.return?.().catch(() => undefined)
  }
}
