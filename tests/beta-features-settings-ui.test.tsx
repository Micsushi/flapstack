// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { AgentsBetaTab } from "../src/renderer/components/dialogs/settings-tabs/agents-beta-tab"
import { DEFAULT_BETA_FEATURE_SETTINGS } from "../src/shared/beta-features"

const state = vi.hoisted(() => ({
  data: undefined as Record<string, boolean> | undefined,
  isLoading: true,
  isError: false,
  error: null as Error | null,
  mutationError: null as Error | null,
  retry: vi.fn(),
  mutate: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ betaFeatures: { get: { setData: vi.fn() } } }),
    betaFeatures: {
      get: { useQuery: () => ({ ...state, refetch: state.retry }) },
      set: {
        useMutation: () => ({ mutate: state.mutate, error: state.mutationError, isPending: false }),
      },
    },
  },
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("keeps unknown or failed settings disabled, retries loading, and exposes failed writes", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const switches = () => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
  try {
    await act(async () => root.render(<AgentsBetaTab />))
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading features")
    expect(switches()).toHaveLength(10)
    expect(switches().every((item) => item.disabled)).toBe(true)
    await act(async () => switches()[0].click())
    expect(state.mutate).not.toHaveBeenCalled()

    state.isLoading = false
    state.isError = true
    state.error = new Error("Settings unavailable")
    state.data = { ...DEFAULT_BETA_FEATURE_SETTINGS }
    await act(async () => root.render(<AgentsBetaTab />))
    expect(switches().every((item) => item.disabled)).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Settings unavailable")
    const retry = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Retry",
    )!
    await act(async () => retry.click())
    expect(state.retry).toHaveBeenCalledOnce()

    state.isError = false
    state.error = null
    state.data.workspaceEditing = true
    await act(async () => root.render(<AgentsBetaTab />))
    expect(switches().every((item) => !item.disabled)).toBe(true)
    const editing = switches().find(
      (item) => item.getAttribute("aria-label") === "Enable Workspace Editing",
    )!
    expect(editing.getAttribute("aria-checked")).toBe("true")
    await act(async () => editing.click())
    expect(state.mutate).toHaveBeenCalledWith({ feature: "workspaceEditing", enabled: false })
    state.mutationError = new Error("Could not save feature setting")
    await act(async () => root.render(<AgentsBetaTab />))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save feature setting",
    )
    expect(editing.getAttribute("aria-checked")).toBe("true")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
