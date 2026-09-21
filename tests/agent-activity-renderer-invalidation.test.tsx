// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { QueryObserver } from "@tanstack/react-query"
import { getQueryKey } from "@trpc/react-query"
import { expect, it, vi } from "vitest"

const ipc = vi.hoisted(() => ({ listeners: new Map<string, Set<(...args: unknown[]) => void>>() }))
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => Object.assign(window, { [key]: value }),
  },
  webUtils: {},
  ipcRenderer: {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const listeners = ipc.listeners.get(channel) ?? new Set()
      listeners.add(listener)
      ipc.listeners.set(channel, listeners)
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
      ipc.listeners.get(channel)?.delete(listener),
  },
}))
vi.mock("trpc-electron/main", () => ({ exposeElectronTRPC: () => {} }))
vi.mock("trpc-electron/renderer", () => ({ ipcLink: () => () => () => {} }))
import "../src/preload/index"
import { TRPCProvider, getQueryClient } from "../src/renderer/contexts/TRPCProvider"
import { trpc } from "../src/renderer/lib/trpc"

it("refreshes idle activity observers through the actual preload bridge without touching other chats", async () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => root.render(createElement(TRPCProvider, { children: null })))
  const client = getQueryClient()!
  let stored = 0
  const matching = vi.fn(async () => stored)
  const unrelated = vi.fn(async () => 0)
  const disabledRead = vi.fn(async () => stored)
  const observer = new QueryObserver(client, {
    queryKey: getQueryKey(trpc.agentActivity.list, { chatId: "owned-chat" }, "query"),
    queryFn: matching,
    refetchInterval: false,
  })
  const other = new QueryObserver(client, {
    queryKey: getQueryKey(trpc.agentActivity.list, { chatId: "other-chat" }, "query"),
    queryFn: unrelated,
  })
  const disabledKey = getQueryKey(trpc.agentActivity.replayRun, { runId: "owned-run" }, "query")
  const disabled = new QueryObserver(client, {
    queryKey: disabledKey,
    queryFn: disabledRead,
    enabled: false,
    initialData: 0,
  })
  const unsubscribeDisabled = disabled.subscribe(() => {})
  const unsubscribe = observer.subscribe(() => {})
  const unsubscribeOther = other.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(0))
    stored = 1
    for (const listener of ipc.listeners.get("agent-activity:invalidated") ?? [])
      listener(
        {},
        {
          chatId: "owned-chat",
          runId: "owned-run",
          reason: "append",
          firstSequence: 1,
          lastSequence: 1,
          lastStorageId: 1,
          insertedCount: 1,
        },
      )
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(1))
    expect(unrelated).toHaveBeenCalledTimes(1)
    expect(disabledRead).not.toHaveBeenCalled()
    expect(client.getQueryState(disabledKey)?.isInvalidated).toBe(true)
  } finally {
    unsubscribe()
    unsubscribeOther()
    unsubscribeDisabled()
    await act(async () => root.unmount())
    client.clear()
  }
  expect(ipc.listeners.get("agent-activity:invalidated")?.size ?? 0).toBe(0)
})
