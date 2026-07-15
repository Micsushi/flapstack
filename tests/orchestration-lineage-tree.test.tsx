// @vitest-environment jsdom
import React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OrchestrationLineageTree } from "../src/renderer/features/agents/ui/orchestration-lineage-tree"

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

describe("rich orchestration lineage", () => {
  it("renders stale/orphan truth, roving focus, disabled capability controls, and ordered messages", async () => {
    container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <OrchestrationLineageTree
          onNavigate={vi.fn()}
          lineage={{
            taskId: "task-1",
            nodes: [
              {
                agentId: "parent",
                chatId: null,
                parentAgentId: null,
                replacedAgentId: null,
                role: "Missing",
                name: "Missing parent",
                status: "failed",
                depth: 0,
                harness: "unknown",
                stale: true,
                orphaned: true,
                chatState: "missing",
                controls: controls("Missing target"),
              },
              {
                agentId: "worker",
                chatId: "chat-1",
                parentAgentId: "parent",
                replacedAgentId: null,
                role: "Worker",
                name: "Worker",
                status: "active",
                depth: 1,
                harness: "codex",
                stale: false,
                orphaned: false,
                chatState: "live",
                controls: controls("Adapter not connected"),
              },
            ],
            edges: [{ fromAgentId: "parent", toAgentId: "worker", kind: "spawned" }],
            messages: [
              {
                id: "m1",
                agentId: "worker",
                direction: "outbound",
                kind: "follow-up",
                state: "queued",
                body: "Continue",
                providerMessageId: null,
                createdAt: 1,
              },
            ],
          }}
        />,
      ),
    )
    const items = [...container.querySelectorAll<HTMLElement>("[role=treeitem]")]
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1])
    items[0]!.focus()
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    await act(async () => {})
    expect(document.activeElement).toBe(items[1])
    expect(container.textContent).toContain("Missing parentfailedstaleorphan")
    expect(container.textContent).toContain("follow-up · outbound · queued · Continue")
    expect(container.querySelectorAll("button:disabled")).toHaveLength(6)
  })

  it("dispatches enabled send, follow-up, and interrupt controls", async () => {
    container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onAction = vi.fn()
    await act(async () =>
      root.render(
        <OrchestrationLineageTree
          onNavigate={vi.fn()}
          onAction={onAction}
          lineage={{
            taskId: "task-1",
            nodes: [
              {
                agentId: "worker",
                chatId: "chat-1",
                parentAgentId: null,
                replacedAgentId: null,
                role: "Worker",
                name: "Worker",
                status: "active",
                controls: {
                  send: { enabled: true, reason: "Queued mailbox delivery." },
                  followUp: { enabled: true, reason: "Starts a follow-up turn." },
                  interrupt: { enabled: true, reason: "Interrupts the active turn." },
                },
              },
            ],
            edges: [],
          }}
        />,
      ),
    )
    const button = (text: string) =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent === text,
      )!
    await act(async () => button("Send").click())
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Continue with tests",
      )
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () =>
      container!
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })),
    )
    expect(onAction).toHaveBeenCalledWith("worker", "send", "Continue with tests")
    await act(async () => button("Interrupt").click())
    expect(onAction).toHaveBeenCalledWith("worker", "interrupt", null)
  })
})
function controls(reason: string) {
  return {
    send: { enabled: false, reason },
    followUp: { enabled: false, reason },
    interrupt: { enabled: false, reason },
  }
}
