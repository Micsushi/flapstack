// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ calls: [] as Array<{ path: string; input: unknown }> }))
vi.mock("../src/renderer/lib/trpc", () => {
  const utils = new Proxy(
    {},
    {
      get: (_, domain: string) =>
        new Proxy(
          {},
          {
            get: (_, method: string) => ({
              invalidate: (input: unknown) => {
                state.calls.push({ path: `${domain}.${method}`, input })
              },
            }),
          },
        ),
    },
  )
  return { trpc: { useUtils: () => utils } }
})
import { McpExternalMutationRefreshBridge } from "../src/renderer/features/mcp-safety/external-mutation-refresh"
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("refreshes split metadata, transcript and review caches for the changed chat", async () => {
  vi.useFakeTimers()
  state.calls = []
  const previous = window.desktopApi
  let receive!: (event: any) => void
  const unsubscribe = vi.fn()
  window.desktopApi = {
    onProductMcpInvalidation: (callback: typeof receive) => {
      receive = callback
      return unsubscribe
    },
  } as any
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () => root.render(<McpExternalMutationRefreshBridge />))
    await act(async () => {
      receive({ version: 1, source: "product-mcp", domains: ["chats"], chatIds: ["changed"] })
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(state.calls).toContainEqual({ path: "chats.getMetadata", input: { id: "changed" } })
    expect(state.calls).toContainEqual({
      path: "chats.getTranscript",
      input: { chatId: "changed" },
    })
    expect(state.calls).toContainEqual({
      path: "diffAnnotations.list",
      input: { chatId: "changed" },
    })
  } finally {
    await act(async () => root.unmount())
    window.desktopApi = previous
    vi.useRealTimers()
  }
  expect(unsubscribe).toHaveBeenCalledOnce()
})
