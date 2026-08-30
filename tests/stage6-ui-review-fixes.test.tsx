// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getMobileCompanionAsset } from "../src/main/lib/mobile-bridge/pwa"
import { FeatureVisibilityOnboardingPage } from "../src/renderer/features/onboarding/feature-visibility-onboarding-page"
import { handleListboxKeyDown } from "../src/renderer/lib/listbox-keyboard"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("Stage 6 UI review regressions", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("reflows Profile Studio, Personality Library, graph, and custom notes at narrow widths", () => {
    const profiles = source(
      "src/renderer/components/dialogs/settings-tabs/agents-profiles-studio-tab.tsx",
    )
    const personalities = source(
      "src/renderer/features/agent-profiles/agent-personality-library.tsx",
    )
    const graph = source("src/renderer/features/project-vault/project-vault-graph-panel.tsx")
    const notes = source("src/renderer/features/project-vault/project-vault-custom-notes-panel.tsx")

    for (const studio of [profiles, personalities]) {
      expect(studio).toContain("grid-cols-1")
      expect(studio).toContain("lg:grid-cols-[minmax(240px,0.75fr)_minmax(460px,1.5fr)]")
      expect(studio).toContain("lg:grid-rows-1")
    }
    expect(graph).toContain("flex-col lg:flex-row")
    expect(graph).toContain("w-full")
    expect(graph).toContain("lg:w-72")
    expect(notes).toContain("grid-cols-1")
    expect(notes).toContain("lg:grid-cols-[260px_minmax(0,1fr)]")
  })

  it("keeps graph nodes exposed, touchable, and bounded through preindexed browser virtualization", () => {
    const graph = source("src/renderer/features/project-vault/project-vault-graph-panel.tsx")

    expect(graph).toContain('role="group"')
    expect(graph).not.toContain('role="img"')
    expect(graph).toContain("graph-node-touch-target")
    expect(graph).toContain("buildGraphLinkCounts")
    expect(graph).toContain('contentVisibility: "auto"')
    expect(graph).not.toContain("edges.filter((edge) => edge.targetNodeId === node.nodeId).length")
    expect(graph).not.toContain("edges.filter((edge) => edge.sourceNodeId === node.nodeId).length")
  })

  it("keeps the visual-capture confirmation footer reachable at zoom and short heights", () => {
    const capture = source("src/renderer/features/agents/ui/visual-capture-dialog.tsx")
    expect(capture).toContain("overflow-y-auto")
    expect(capture).toContain("overscroll-contain")
    expect(capture).toContain("max-h-[calc(100vh-1rem)]")
  })

  it("uses an announced, high-contrast mobile connection state without mojibake", () => {
    const document = getMobileCompanionAsset("/")?.body ?? ""
    const app = getMobileCompanionAsset("/mobile-app.js")?.body ?? ""

    expect(document).toContain('role="status"')
    expect(document).toContain('aria-live="polite"')
    expect(document).toContain('@media(prefers-color-scheme:dark){#connection[data-mode="offline"]')
    expect(`${document}${app}`).not.toContain("Â")
  })

  it("renders the Chat loading fallback without mojibake", () => {
    const agentsContent = source("src/renderer/features/agents/ui/agents-content.tsx")

    expect(agentsContent).toContain("Loading…")
    expect(agentsContent).not.toContain("LoadingÃ")
  })

  it("renders terminal labels and loading states without mojibake", () => {
    const paths = [
      "src/renderer/features/agents/workbench/chat-workbench.tsx",
      "src/renderer/features/agents/ui/agents-content.tsx",
      "src/renderer/features/terminal/workbench-terminal-pane.tsx",
    ]
    const content = paths.map(source).join("\n")

    expect(content).toContain("Terminal ·")
    expect(content).toContain("Starting Terminal…")
    expect(content).not.toMatch(/â€”|â€¦/)
  })

  it("reports every mobile Settings mutation and clipboard failure truthfully", () => {
    const mobile = source(
      "src/renderer/components/dialogs/settings-tabs/agents-mobile-companion-tab.tsx",
    )

    expect(mobile).toContain("copyGrantId")
    expect(mobile).toContain("revokeAuthorityGrant")
    expect(mobile.match(/catch \(error\)/g)?.length ?? 0).toBeGreaterThanOrEqual(7)
    expect(mobile).toContain("await navigator.clipboard.writeText")
  })

  it("implements vertical listbox navigation with a single tab stop", () => {
    for (const path of [
      "src/renderer/components/dialogs/settings-tabs/agents-profiles-studio-tab.tsx",
      "src/renderer/features/agent-profiles/agent-personality-library.tsx",
      "src/renderer/features/agent-profiles/chat-agent-profile-control.tsx",
      "src/renderer/features/agent-profiles/new-chat-agent-profile-selector.tsx",
    ]) {
      const content = source(path)
      expect(content).toContain("handleListboxKeyDown")
      expect(content).toContain("tabIndex=")
    }
  })

  it("moves listbox focus with arrows and skips disabled options", () => {
    const listbox = document.createElement("div")
    listbox.setAttribute("role", "listbox")
    const first = document.createElement("button")
    const disabled = document.createElement("button")
    const last = document.createElement("button")
    for (const option of [first, disabled, last]) option.setAttribute("role", "option")
    disabled.disabled = true
    first.setAttribute("aria-selected", "true")
    listbox.append(first, disabled, last)
    container.append(listbox)
    first.focus()
    const preventDefault = vi.fn()

    handleListboxKeyDown({
      key: "ArrowDown",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      currentTarget: listbox,
      preventDefault,
    } as never)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(last)
  })

  it("moves focus to the live onboarding heading after a step transition", async () => {
    await act(async () =>
      root.render(
        createElement(FeatureVisibilityOnboardingPage, {
          revision: 1,
          visibility: {},
          onApply: vi.fn(),
        }),
      ),
    )

    const start = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start guide",
    )
    expect(start).toBeDefined()
    await act(async () => start!.click())

    const heading = container.querySelector<HTMLHeadingElement>("#visibility-guide-title")
    expect(heading?.textContent).toBe("Projects contain tasks; tasks use chats")
    expect(heading?.getAttribute("aria-live")).toBe("polite")
    expect(document.activeElement).toBe(heading)
  })
})
