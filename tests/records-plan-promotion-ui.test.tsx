// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RecordsPlanPromotionDialog } from "../src/renderer/features/plan/records-plan-promotion-dialog"
import { YAP_REVIEW_REQUEST_EVENT } from "../src/shared/task-proposals"

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  success: undefined as undefined | ((result: { proposalId: string }) => void),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ planSources: { sourceLinks: { invalidate: state.invalidate } } }),
    planSources: {
      recordsDestinations: {
        useQuery: () => ({
          isSuccess: true,
          data: [
            { path: "lanes/flapstack/tasks.md", projectId: "flapstack", projectName: "Flapstack" },
          ],
        }),
      },
      proposeCandidate: {
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

describe("Plan to Yap review", () => {
  it("requires explicit canonical selection and navigates only after a saved proposal", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    unmount = () => {
      act(() => root.unmount())
      host.remove()
    }
    const close = vi.fn()
    const review = vi.fn()
    window.addEventListener(YAP_REVIEW_REQUEST_EVENT, review)
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
        (item) => item.textContent === "Review in Yap",
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
      expect(review).not.toHaveBeenCalled()
      await act(async () => state.success?.({ proposalId: "saved-proposal" }))
      expect(review.mock.calls[0]![0].detail).toMatchObject({
        proposalId: "saved-proposal",
        source: "plan",
      })
      expect(close).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener(YAP_REVIEW_REQUEST_EVENT, review)
    }
  })
})
