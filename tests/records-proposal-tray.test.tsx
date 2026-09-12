// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { TaskProposalTray } from "../src/renderer/features/kanban/components/task-proposal-tray"
import { YAP_REVIEW_REQUEST_EVENT } from "../src/shared/task-proposals"

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    projectRecords: {
      yapProposals: {
        useQuery: () => ({
          data: {
            proposals: [
              {
                proposalId: "canonical-yap-7",
                status: "partially-applied",
                rows: [{ interpretedRequest: "Finish the remaining task" }],
              },
              { proposalId: "already-applied", status: "applied", rows: [] },
            ],
          },
          isError: false,
        }),
      },
    },
  },
}))

it("opens the canonical proposal and keeps partial work visible without legacy IDs", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const received = vi.fn()
  window.addEventListener(YAP_REVIEW_REQUEST_EVENT, received)
  try {
    await act(async () => root.render(<TaskProposalTray />))
    const reviews = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent === "Review in Yap",
    )
    expect(reviews).toHaveLength(1)
    await act(async () => reviews[0]!.click())
    expect((received.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      proposalId: "canonical-yap-7",
    })
  } finally {
    window.removeEventListener(YAP_REVIEW_REQUEST_EVENT, received)
    await act(async () => root.unmount())
    host.remove()
  }
})
