// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useStreamedFileSearch } from "../src/renderer/features/file-viewer/components/use-streamed-file-search"
import type { WorkspaceFileSearchEvent } from "../src/shared/workspace-search"

const streams = vi.hoisted(
  () =>
    [] as Array<{
      input: { requestId: string; query: string }
      handlers: {
        onData: (event: WorkspaceFileSearchEvent) => void
        onComplete: () => void
        onError: (error: { message: string }) => void
      }
      unsubscribe: ReturnType<typeof vi.fn>
    }>,
)
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: {
    files: {
      searchStream: {
        subscribe: (input, handlers) => {
          const unsubscribe = vi.fn()
          streams.push({ input, handlers, unsubscribe })
          return { unsubscribe }
        },
      },
    },
  },
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Probe({ query, enabled = true }: { query: string; enabled?: boolean }) {
  const state = useStreamedFileSearch("/repo", query, enabled)
  return (
    <>
      <output>
        {JSON.stringify({ data: state.data, error: state.error, busy: state.isFetching })}
      </output>
      <button onClick={state.refetch}>Retry</button>
    </>
  )
}

it("keeps partial results, isolates superseded events, retries errors and disposes streams", async () => {
  streams.length = 0
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const read = () => JSON.parse(container.querySelector("output")!.textContent!)
  const result = {
    id: "one",
    label: "one.ts",
    path: "one.ts",
    repository: "local",
    type: "file" as const,
  }
  const emit = (index: number, event: Omit<WorkspaceFileSearchEvent, "requestId" | "provider">) =>
    streams[index].handlers.onData({
      requestId: streams[index].input.requestId,
      provider: "filesystem",
      ...event,
    } as WorkspaceFileSearchEvent)
  try {
    await act(async () => root.render(<Probe query="one" />))
    expect(read().busy).toBe(true)
    await act(async () => emit(0, { status: "partial", results: [result] }))
    expect(read()).toMatchObject({ data: [result], busy: true })
    await act(async () => root.render(<Probe query="two" />))
    expect(streams[0].unsubscribe).toHaveBeenCalledOnce()
    expect(read().data).toEqual([])
    await act(async () => emit(0, { status: "complete", results: [result] }))
    expect(read().data).toEqual([])
    await act(async () => {
      emit(1, { status: "partial", results: [result] })
      emit(1, { status: "error", code: "failed", message: "Retry this scan" })
      streams[1].handlers.onComplete()
    })
    expect(read()).toMatchObject({
      data: [result],
      error: { message: "Retry this scan" },
      busy: false,
    })
    await act(async () => container.querySelector("button")!.click())
    expect(streams[1].unsubscribe).toHaveBeenCalledOnce()
    expect(read()).toMatchObject({ data: [], busy: true })
    await act(async () => streams[2].handlers.onComplete())
    expect(read().error.message).toContain("before completion")
    await act(async () => container.querySelector("button")!.click())
    await act(async () => {
      emit(3, { status: "complete", results: [result] })
      streams[3].handlers.onError({ message: "Late transport error" })
    })
    expect(read()).toEqual({ data: [result], busy: false })
    await act(async () => root.render(<Probe query="two" enabled={false} />))
    expect(streams[3].unsubscribe).toHaveBeenCalledOnce()
    expect(read()).toEqual({ busy: false })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
