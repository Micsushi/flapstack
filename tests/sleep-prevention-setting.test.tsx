// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SleepPreventionSetting } from "../src/renderer/components/dialogs/settings-tabs/sleep-prevention-setting"
import {
  clearAppActionHistory,
  getAppActionHistorySnapshot,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"

const rpc = vi.hoisted(() => ({
  query: {
    data: { mode: "off", active: false, agentWork: false, terminals: 0, error: null },
    isError: false,
    refetch: vi.fn(),
  },
  mutate: vi.fn(),
  setData: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { error: rpc.error } }))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ sleepPrevention: { status: { setData: rpc.setData } } }),
    sleepPrevention: {
      status: { useQuery: () => rpc.query },
      setMode: { useMutation: () => ({ mutateAsync: rpc.mutate, isPending: false }) },
    },
  },
  trpcClient: { sleepPrevention: { setMode: { mutate: rpc.mutate } } },
}))

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  clearAppActionHistory()
  vi.clearAllMocks()
  rpc.query.isError = false
  rpc.mutate.mockImplementation(async ({ mode }) => ({ ...rpc.query.data, mode }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<SleepPreventionSetting />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearAppActionHistory()
})
async function change() {
  const select = container.querySelector("select")!
  await act(async () => {
    select.value = "automatic"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

it("uses authoritative expected modes for change, Undo and Redo", async () => {
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Not preventing sleep")
  await change()
  expect(rpc.mutate).toHaveBeenLastCalledWith({ mode: "automatic", expectedMode: "off" })
  expect(getAppActionHistorySnapshot().canUndo).toBe(true)
  await act(async () => {
    await undoAppAction()
  })
  expect(rpc.mutate).toHaveBeenLastCalledWith({ mode: "off", expectedMode: "automatic" })
  await act(async () => {
    await redoAppAction()
  })
  expect(rpc.mutate).toHaveBeenLastCalledWith({ mode: "automatic", expectedMode: "off" })
})

it("keeps failed changes out of history and offers recovery", async () => {
  rpc.mutate.mockRejectedValueOnce(new Error("write failed"))
  await change()
  expect(getAppActionHistorySnapshot().canUndo).toBe(false)
  expect(rpc.error).toHaveBeenCalledOnce()
  expect(rpc.query.refetch).toHaveBeenCalledOnce()
})

it("does not show a failed status read as a usable Off control", async () => {
  rpc.query.isError = true
  await act(async () => root.render(<SleepPreventionSetting />))
  expect(container.querySelector("select")!.disabled).toBe(true)
  expect(container.textContent).toContain("Cannot read sleep status")
  await act(async () => container.querySelector("button")!.click())
  expect(rpc.query.refetch).toHaveBeenCalledOnce()
})
