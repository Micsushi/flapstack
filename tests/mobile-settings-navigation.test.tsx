// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Provider, createStore } from "jotai"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { SettingsContent } from "../src/renderer/features/settings/settings-content"
import {
  agentsSettingsDialogActiveTabAtom,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
} from "../src/renderer/lib/atoms"
import { desktopViewAtom } from "../src/renderer/features/agents/atoms"
import { DEFAULT_BETA_FEATURE_SETTINGS } from "../src/shared/beta-features"
const flags = vi.hoisted(() => ({ values: {} as any }))
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => flags.values,
}))
vi.mock("../src/renderer/features/settings/settings-target", () => ({
  revealSettingsTarget: vi.fn(),
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-appearance-tab", () => ({
  AgentsAppearanceTab: () => <input aria-label="AgentsAppearanceTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-debug-tab", () => ({
  AgentsDebugTab: () => <input aria-label="AgentsDebugTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-plugins-hub-tab", () => ({
  AgentsPluginsHubTab: () => <input aria-label="AgentsPluginsHubTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-models-tab", () => ({
  AgentsModelsTab: () => <input aria-label="AgentsModelsTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-runtimes-tab", () => ({
  AgentsRuntimesTab: () => <input aria-label="AgentsRuntimesTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-local-models-tab", () => ({
  AgentsLocalModelsTab: () => <input aria-label="AgentsLocalModelsTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-mobile-companion-tab", () => ({
  AgentsMobileCompanionTab: () => (
    <input aria-label="AgentsMobileCompanionTab draft" defaultValue="" />
  ),
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-coordination-engines-tab", () => ({
  AgentsCoordinationEnginesTab: () => (
    <input aria-label="AgentsCoordinationEnginesTab draft" defaultValue="" />
  ),
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-profiles-studio-tab", () => ({
  AgentsProfilesStudioTab: () => (
    <input aria-label="AgentsProfilesStudioTab draft" defaultValue="" />
  ),
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-preferences-tab", () => ({
  AgentsPreferencesTab: () => <input aria-label="AgentsPreferencesTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-permissions-tab", () => ({
  AgentsPermissionsTab: () => <input aria-label="AgentsPermissionsTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab", () => ({
  AgentsProjectsTab: () => <input aria-label="AgentsProjectsTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-provider-extensions-tab", () => ({
  AgentsProviderExtensionsTab: () => (
    <input aria-label="AgentsProviderExtensionsTab draft" defaultValue="" />
  ),
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-api-providers-tab", () => ({
  AgentsApiProvidersTab: () => <input aria-label="AgentsApiProvidersTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-usage-tab", () => ({
  AgentsUsageTab: () => <input aria-label="AgentsUsageTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-voice-tab", () => ({
  AgentsVoiceTab: () => <input aria-label="AgentsVoiceTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-keyboard-tab", () => ({
  AgentsKeyboardTab: () => <input aria-label="AgentsKeyboardTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-portability-tab", () => ({
  AgentsPortabilityTab: () => <input aria-label="AgentsPortabilityTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-beta-tab", () => ({
  AgentsBetaTab: () => <input aria-label="AgentsBetaTab draft" defaultValue="" />,
}))
vi.mock("../src/renderer/components/dialogs/settings-tabs/agents-feature-visibility-tab", () => ({
  AgentsFeatureVisibilityTab: () => (
    <input aria-label="AgentsFeatureVisibilityTab draft" defaultValue="" />
  ),
}))

let root: Root, container: HTMLDivElement, store: ReturnType<typeof createStore>
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  flags.values = { ...DEFAULT_BETA_FEATURE_SETTINGS }
  store = createStore()
  store.set(desktopViewAtom, "settings")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <SettingsContent />
      </Provider>,
    ),
  )
}
it("selects a visible section and returns through existing chat navigation", async () => {
  store.set(agentsSettingsDialogActiveTabAtom, "preferences")
  await render()
  const select = container.querySelector('[aria-label="Settings section"]') as HTMLSelectElement
  expect([...select.options].some((o) => o.value === "mobile-companion")).toBe(true)
  await act(async () => {
    select.value = "mobile-companion"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  expect(store.get(agentsSettingsDialogActiveTabAtom)).toBe("mobile-companion")
  expect(container.querySelector('[aria-label="AgentsMobileCompanionTab draft"]')).not.toBeNull()
  await act(async () => {
    ;[...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Back to chat")!
      .click()
  })
  expect(store.get(desktopViewAtom)).toBeNull()
})
it("uses visibility normalization and preserves the active child across viewport changes", async () => {
  flags.values.orchestration = false
  store.set(agentsSettingsDialogActiveTabAtom, "coordination")
  await render()
  const select = container.querySelector('[aria-label="Settings section"]') as HTMLSelectElement
  expect([...select.options].some((o) => o.value === "coordination")).toBe(false)
  expect(select.value).toBe("preferences")
  const draft = container.querySelector("input")!
  draft.value = "pending draft"
  await act(async () => {
    window.innerWidth = 480
    window.dispatchEvent(new Event("resize"))
  })
  await render()
  expect(container.querySelector("input")).toBe(draft)
  expect(draft.value).toBe("pending draft")
  await act(async () => {
    window.innerWidth = 1280
    window.dispatchEvent(new Event("resize"))
  })
  await render()
  expect(container.querySelector("input")).toBe(draft)
  expect(container.querySelector("nav")?.classList.contains("min-[600px]:hidden")).toBe(true)
})
