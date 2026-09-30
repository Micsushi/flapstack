// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import superjson from "superjson"

it("keeps React and imperative IPC requests distinct across provider remounts", async () => {
  vi.resetModules()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const listeners: Array<(response: unknown) => void> = []
  const requests: Array<{ id: number; path: string }> = []
  vi.stubGlobal("electronTRPC", {
    onMessage: (listener: (response: unknown) => void) => listeners.push(listener),
    sendMessage: (message: { method: string; operation?: { id: number; path: string } }) => {
      if (message.method === "request" && message.operation) requests.push(message.operation)
    },
  })
  const { trpc, trpcClient } = await import("../src/renderer/lib/trpc")
  const { TRPCProvider } = await import("../src/renderer/contexts/TRPCProvider")
  const board = { status: 200, body: "{}", contentType: "application/json" }
  let approvals: unknown
  function Probe() {
    approvals = trpc.appControl.listPendingApprovals.useQuery().data
    return null
  }
  const reply = (id: number, value: unknown) => {
    for (const listener of listeners)
      listener({ id, result: { type: "data", data: superjson.serialize(value) } })
  }
  let root = createRoot(document.createElement("div"))
  try {
    for (let round = 0; round < 2; round++) {
      const start = requests.length
      await act(async () =>
        root.render(
          <TRPCProvider>
            <Probe />
          </TRPCProvider>,
        ),
      )
      const result = trpcClient.projectRecords.boardRequest.mutate({
        path: "/v1/storage",
        method: "GET",
      })
      await vi.waitFor(() => expect(requests.length).toBe(start + 2))
      const batch = requests.slice(start)
      const direct = batch.find((request) => request.path === "projectRecords.boardRequest")!
      const hooked = batch.find((request) => request.path === "appControl.listPendingApprovals")!
      await act(async () => {
        // Reply out of order on the real broadcast IPC link. Independent clients
        // previously reused IDs, delivering this object to the approvals hook.
        reply(direct.id, board)
        reply(hooked.id, [])
        expect(await result).toEqual(board)
      })
      expect(direct.id).not.toBe(hooked.id)
      await vi.waitFor(async () => {
        // React Query notifies asynchronously; flush until the exact result renders.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(approvals).toEqual([])
      })
      await act(async () => root.unmount())
      if (round === 0) root = createRoot(document.createElement("div"))
    }
    expect(new Set(requests.map((request) => request.id)).size).toBe(requests.length)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
