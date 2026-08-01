// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SwarmGroupControlPanel } from "../src/renderer/features/agents/ui/swarm-group-control-panel"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("SwarmGroupControlPanel", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("previews the exact selection, requires confirmation, and shows partial results", async () => {
    const preview = vi.fn().mockResolvedValue({
      action: "cancel",
      version: "selection-v1",
      selection: ["agent-a", "agent-b"],
      capabilityIntersection: ["cancel"],
      permissionIntersection: ["control"],
      approvalRequired: true,
      targets: [
        {
          agentId: "agent-a",
          runId: "run-a",
          version: 1,
          supported: true,
          reason: null,
        },
        {
          agentId: "agent-b",
          runId: "run-b",
          version: 1,
          supported: true,
          reason: null,
        },
      ],
    })
    const execute = vi.fn().mockResolvedValue({
      status: "partial",
      approvalAuditId: "approval-1",
      results: [
        { agentId: "agent-a", outcome: "succeeded" },
        { agentId: "agent-b", outcome: "failed", detail: "runtime unavailable" },
      ],
    })

    await act(async () =>
      root.render(
        createElement(SwarmGroupControlPanel, {
          agents: [
            { id: "agent-a", label: "Researcher", status: "active" },
            { id: "agent-b", label: "Reviewer", status: "active" },
          ],
          busy: false,
          onPreview: preview,
          onExecute: execute,
        }),
      ),
    )

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => {
      checkboxes[0].click()
      checkboxes[1].click()
    })
    const action = container.querySelector<HTMLSelectElement>('[aria-label="Group action"]')!
    await act(async () => {
      action.value = "cancel"
      action.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview action")!
        .click(),
    )

    expect(preview).toHaveBeenCalledWith("cancel", ["agent-a", "agent-b"])
    expect(container.textContent).toContain("Exact selection: Researcher, Reviewer")
    expect(execute).not.toHaveBeenCalled()

    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Confirm cancel")!
        .click(),
    )
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ version: "selection-v1" }), "")
    expect(container.textContent).toContain("Partial result")
    expect(container.textContent).toContain("Reviewer: runtime unavailable")
    expect(container.textContent).not.toContain("Confirm cancel")
  })
})
