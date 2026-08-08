import { incrementPerformanceCounter } from "./performance-counters"

type DeltaChunk = {
  type: "text-delta" | "reasoning-delta"
  id: string
  delta: string
}

type StreamChunkBatcherOptions<T> = {
  deliver: (chunks: T[]) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

function isDeltaChunk(chunk: unknown): chunk is DeltaChunk {
  if (!chunk || typeof chunk !== "object") return false
  const candidate = chunk as Partial<DeltaChunk>
  return (
    (candidate.type === "text-delta" || candidate.type === "reasoning-delta") &&
    typeof candidate.id === "string" &&
    typeof candidate.delta === "string"
  )
}

export function createStreamChunkBatcher<T>({
  deliver,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: StreamChunkBatcherOptions<T>) {
  let frame: number | null = null
  let pending: T[] = []

  const flush = () => {
    if (frame !== null) cancelFrame(frame)
    frame = null
    if (pending.length === 0) return
    const chunks = pending
    pending = []
    incrementPerformanceCounter("stream-render-commit")
    deliver(chunks)
  }

  const schedule = () => {
    if (frame !== null) return
    frame = requestFrame(() => {
      frame = null
      if (pending.length === 0) return
      const chunks = pending
      pending = []
      incrementPerformanceCounter("stream-render-commit")
      deliver(chunks)
    })
  }

  return {
    push(chunk: T) {
      if (!isDeltaChunk(chunk)) {
        flush()
        incrementPerformanceCounter("stream-render-commit")
        deliver([chunk])
        return
      }
      incrementPerformanceCounter("stream-delta")
      const previous = pending.at(-1)
      if (isDeltaChunk(previous) && previous.type === chunk.type && previous.id === chunk.id) {
        pending[pending.length - 1] = { ...previous, delta: previous.delta + chunk.delta } as T
      } else {
        pending.push(chunk)
      }
      schedule()
    },
    flush,
    cancel() {
      if (frame !== null) cancelFrame(frame)
      frame = null
      pending = []
    },
  }
}
