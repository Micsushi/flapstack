// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RecordsPlanPromotionDialog } from "../src/renderer/features/plan/records-plan-promotion-dialog"
import { getDefaultStore } from "jotai"
import {
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
} from "../src/renderer/features/agents/atoms"

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  success: undefined as undefined | ((result: { chatId: string; subChatId: string }) => void),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      chats: { invalidate: state.invalidate },
      planSources: { sourceLinks: { invalidate: state.invalidate } },
    }),
    projects: {
      list: {
        useQuery: () => ({
          data: [{ id: "local-project", name: "Local fixture", path: "/fixture" }],
        }),
      },
    },
    planSources: {
      recordsDestinations: {
        useQuery: () => ({
          isSuccess: true,
          data: [
            { path: "lanes/flapstack/tasks.md", projectId: "flapstack", projectName: "Flapstack" },
          ],
        }),
      },
      previewPair: {
        useQuery: () => ({ data: { projectPath: "/fixture", expectedTarget: "a".repeat(64) } }),
      },
      confirmPair: {
        useMutation: (options: { onSuccess: typeof state.success }) => {
          state.success = options.onSuccess
          return { mutate: state.mutate, isPending: false }
        },
      },
    },
  },
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  vi.clearAllMocks()
})

describe("Plan task and idle Chat pair", () => {
  it("requires explicit canonical selection and navigates only after finalized pair", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    unmount = () => {
      act(() => root.unmount())
      host.remove()
    }
    const close = vi.fn()
    getDefaultStore().set(selectedChatIsRemoteAtom, true)
    try {
      const candidate = {
        id: "candidate",
        fingerprint: "candidate-hash",
        kind: "task" as const,
        title: "Retain answers",
        body: "Preserve user text",
        path: "plan.md",
        line: 2,
        depth: 1,
        parentId: null,
        completed: false,
      }
      await act(async () =>
        root.render(
          <RecordsPlanPromotionDialog
            sourceProjectId="local-project"
            source={{
              id: "source",
              fingerprint: "source-hash",
              type: "markdown",
              path: "plan.md",
              stale: false,
              status: "current",
              candidates: [candidate],
              limitations: [],
              errors: [],
            }}
            candidate={candidate}
            onClose={close}
          />,
        ),
      )
      const button = [...document.querySelectorAll("button")].find(
        (item) => item.textContent === "Create task and idle Chat",
      )!
      expect(button.disabled).toBe(true)
      const select = document.querySelector("select")!
      await act(async () => {
        select.value = "lanes/flapstack/tasks.md:flapstack"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(button.disabled).toBe(false)
      await act(async () => button.click())
      expect(state.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "flapstack",
          reference: expect.objectContaining({ sourceProjectId: "local-project" }),
        }),
      )
      expect(close).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain("Existing checkout: /fixture")
      expect(document.body.textContent).toContain("Permission: read-only")
      await act(async () => state.success?.({ chatId: "saved-chat", subChatId: "saved-subchat" }))
      expect(getDefaultStore().get(selectedAgentChatIdAtom)).toBe("saved-chat")
      expect(getDefaultStore().get(selectedChatIsRemoteAtom)).toBe(false)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      getDefaultStore().set(selectedAgentChatIdAtom, null)
    }
  })
})
