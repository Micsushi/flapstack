// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ScopedSearchPanel } from "../src/renderer/features/search/scoped-search-panel"

const rpc = vi.hoisted(() => ({
  query: {
    data: [] as Array<{ type: "chat"; title: string; snippet: string; chatId: string }>,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  useQuery: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: { search: { query: { useQuery: rpc.useQuery } } },
}))
let root: Root
let container: HTMLDivElement
const navigate = vi.fn()
async function render() {
  await act(async () => root.render(<ScopedSearchPanel onNavigateChat={navigate} />))
}
async function search(value: string) {
  const input = container.querySelector("input")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  rpc.query.data = []
  rpc.query.error = null
  rpc.query.isFetching = false
  rpc.useQuery.mockImplementation(() => rpc.query)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it("distinguishes failure, retry, successful empty results and an empty query", async () => {
  rpc.query.error = new Error("private database path must not appear")
  await search("needle")
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Search is unavailable")
  expect(container.textContent).not.toContain("private database")
  expect(container.textContent).not.toContain("No results")
  const retry = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Retry search",
  )!
  await act(async () => retry.click())
  expect(rpc.query.refetch).toHaveBeenCalledOnce()
  rpc.query.isFetching = true
  await render()
  expect(retry.disabled).toBe(true)
  rpc.query.error = null
  await render()
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Searching")
  expect(container.textContent).not.toContain("No results")
  rpc.query.isFetching = false
  await render()
  expect(container.textContent).toContain("No results")
  await search("   ")
  expect(container.textContent).not.toContain("No results")
  expect(rpc.useQuery).toHaveBeenLastCalledWith(expect.objectContaining({ query: "" }), {
    enabled: false,
  })
})

it("labels stale results and preserves their navigation after a failed refresh", async () => {
  rpc.query.data = [{ type: "chat", title: "Recovered chat", snippet: "needle", chatId: "chat-1" }]
  rpc.query.error = new Error("offline")
  await search(" needle ")
  expect(container.textContent).toContain("Showing previously loaded results")
  const result = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Recovered chat"),
  )!
  await act(async () => result.click())
  expect(navigate).toHaveBeenCalledWith("chat-1", undefined, undefined, "needle")
  rpc.query.error = null
  await render()
  expect(container.textContent).not.toContain("Showing previously loaded results")
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
