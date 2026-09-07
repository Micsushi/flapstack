// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider, createStore } from "jotai"
import { expect, it, vi } from "vitest"
import { PlanWidget } from "../src/renderer/features/details-sidebar/sections/plan-widget"
import { PlanSection } from "../src/renderer/features/details-sidebar/sections/plan-section"
import { planContentCacheAtomFamily } from "../src/renderer/features/details-sidebar/atoms"
const query = vi.hoisted(() => ({
  data: "old plan" as string | undefined,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: { files: { readFile: { useQuery: () => query } } },
}))
vi.mock("../src/renderer/components/chat-markdown-renderer", () => ({
  ChatMarkdownRenderer: ({ content }) => <div>{content}</div>,
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it.each([PlanWidget, PlanSection])(
  "does not resurrect cached text after a successful empty plan read",
  async (View) => {
    query.data = "old plan"
    query.isLoading = false
    const store = createStore()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    let revision = 0
    const render = () =>
      root.render(
        <Provider store={store}>
          <View
            chatId="plan"
            worktreePath="C:/repo"
            planPath="plan.md"
            refetchTrigger={++revision}
          />
        </Provider>,
      )
    try {
      await act(async () => render())
      expect(container.textContent).toContain("old plan")
      query.data = ""
      await act(async () => render())
      expect(container.textContent).not.toContain("old plan")
      expect(store.get(planContentCacheAtomFamily("plan"))).toMatchObject({
        content: "",
        isReady: true,
      })
      query.data = undefined
      query.isLoading = true
      await act(async () => render())
      expect(container.textContent).not.toContain("old plan")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  },
)
