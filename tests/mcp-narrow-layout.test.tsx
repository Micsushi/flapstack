// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { AgentsMcpTab } from "../src/renderer/components/dialogs/settings-tabs/agents-mcp-tab"
const state = vi.hoisted(() => ({ mobile: true, mutation: vi.fn() }))
vi.mock("../src/renderer/lib/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }))
vi.mock("../src/renderer/features/agents/atoms", async () => {
  const { atom } = await import("jotai")
  return {
    lastSelectedAgentIdAtom: atom("codex"),
    selectedProjectAtom: atom(null),
    settingsMcpSidebarWidthAtom: atom(240),
  }
})
vi.mock("../src/renderer/components/ui/resizable-sidebar", () => ({
  ResizableSidebar: ({ isOpen, children }: any) =>
    isOpen ? <aside aria-label="Server list">{children}</aside> : null,
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get: (_, provider) =>
        new Proxy(
          {},
          {
            get: () => ({
              useMutation: () => ({ mutateAsync: state.mutation, isPending: false }),
              useQuery: () => ({
                data: {
                  groups:
                    provider === "codex"
                      ? [
                          {
                            groupName: "Global",
                            projectPath: null,
                            mcpServers: [
                              {
                                name: "synthetic_tools",
                                status: "connected",
                                tools: [
                                  { name: "fixture_cwd_ok", description: "Cwd proof" },
                                  {
                                    name: "fixture_environment_ok",
                                    description: "Environment proof",
                                  },
                                ],
                                config: { command: "node", args: [] },
                              },
                            ],
                          },
                        ]
                      : [],
                },
                refetch: vi.fn(),
                isLoading: false,
                isFetching: false,
              }),
            }),
          },
        ),
    },
  ),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("uses list/detail/back on narrow screens while keeping desktop split view and avoiding configuration mutations", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const render = () => act(async () => root.render(<AgentsMcpTab />))
  const click = (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes(label))!
        .click(),
    )
  try {
    await render()
    expect(container.querySelector('[aria-label="Server list"]')).not.toBeNull()
    expect(container.textContent).not.toContain("fixture_cwd_ok")
    await click("synthetic_tools")
    expect(container.querySelector('[aria-label="Server list"]')).toBeNull()
    expect(container.textContent).toContain("Tools (2)")
    expect(container.textContent).toContain("fixture_environment_ok")
    await click("Back to servers")
    expect(container.querySelector('[aria-label="Server list"]')).not.toBeNull()
    expect(container.textContent).not.toContain("fixture_cwd_ok")
    await click("synthetic_tools")
    state.mobile = false
    await render()
    expect(container.querySelector('[aria-label="Server list"]')).not.toBeNull()
    expect(container.textContent).toContain("fixture_cwd_ok")
    expect(container.textContent).not.toContain("Back to servers")
    expect(state.mutation).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    state.mobile = true
  }
})
