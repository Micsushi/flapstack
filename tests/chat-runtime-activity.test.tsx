// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getQueryKey } from "@trpc/react-query"
import { expect, it, vi } from "vitest"
import { activity } from "./runtime-activity-test-helpers"
import type { AgentActivityPage } from "../src/shared/agent-activity"

const read = vi.hoisted(() => vi.fn())
vi.mock("../src/renderer/lib/trpc", async () => {
  const { createTRPCReact } = await import("@trpc/react-query")
  return {
    trpc: createTRPCReact(),
    trpcClient: {
      agentActivity: {
        list: { query: read },
        localRunStatuses: { query: async () => ({ runs: [], hasMore: false }) },
      },
    },
  }
})
import { trpc } from "../src/renderer/lib/trpc"
import { ChatRuntimeActivity } from "../src/renderer/features/agents/runtime-activity/chat-runtime-activity"
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("opens persisted activity, pages earlier events and refreshes after scoped invalidation without exposing private DOM", async () => {
  const older = activity("agent-text", { text: "Earlier public message" }, { storageId: 1 })
  const hidden = activity(
    "agent-text",
    { text: "PRIVATE_TIMELINE_SENTINEL" },
    { storageId: 2, privacyClass: "private" },
  )
  const latest = activity("agent-text", { text: "Latest public message" }, { storageId: 3 })
  let updated = false
  read.mockImplementation(async ({ beforeStorageId }): Promise<AgentActivityPage> =>
    beforeStorageId
      ? { events: [older], hasMore: false, nextCursor: null }
      : {
          events: [
            hidden,
            {
              ...latest,
              payload: { text: updated ? "Updated public message" : "Latest public message" },
            },
          ],
          hasMore: true,
          nextCursor: 2,
        },
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ChatRuntimeActivity chatId="chat-1" live={false} />
        </QueryClientProvider>,
      ),
    )
    expect(read).not.toHaveBeenCalled()
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
    const transcript = document.querySelector<HTMLElement>('[role="dialog"]')!
    await vi.waitFor(() => expect(transcript.textContent).toContain("Latest public message"))
    expect(transcript.querySelector('[role="feed"]')!.outerHTML).not.toContain(
      "PRIVATE_TIMELINE_SENTINEL",
    )
    const load = [...transcript.querySelectorAll("button")].find(
      (button) => button.textContent === "Load earlier activity",
    )!
    await act(async () => load.click())
    await vi.waitFor(() => expect(transcript.textContent).toContain("Earlier public message"))
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-1", limit: 500, beforeStorageId: 2 }),
    )
    expect(
      [...transcript.querySelectorAll("[data-runtime-activity-key]")].map((row) =>
        row.getAttribute("data-runtime-activity-key"),
      ),
    ).toEqual(["event:event-1", "event:event-2", "event:event-3"])
    updated = true
    await act(async () => {
      await client.invalidateQueries({
        queryKey: getQueryKey(trpc.agentActivity.list, { chatId: "chat-1" }, "query"),
      })
    })
    await vi.waitFor(() => expect(transcript.textContent).toContain("Updated public message"))
    expect(transcript.textContent).toContain("Earlier public message")
    expect(transcript.querySelector('[role="feed"]')!.outerHTML).not.toContain(
      "PRIVATE_TIMELINE_SENTINEL",
    )
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
  }
})

it("shows recoverable loading failure and the empty state in the real timeline", async () => {
  read
    .mockReset()
    .mockRejectedValueOnce(new Error("Activity unavailable"))
    .mockResolvedValue({ events: [], hasMore: false, nextCursor: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ChatRuntimeActivity chatId="empty-chat" live={false} />
        </QueryClientProvider>,
      ),
    )
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
    const transcript = document.querySelector<HTMLElement>('[role="dialog"]')!
    await vi.waitFor(() =>
      expect(transcript.querySelector('[role="alert"]')?.textContent).toContain(
        "Activity unavailable",
      ),
    )
    const retry = [...transcript.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!
    await act(async () => retry.click())
    await vi.waitFor(() => expect(transcript.textContent).toContain("No Runtime activity matches"))
  } finally {
    await act(async () => root.unmount())
    client.clear()
  }
})
