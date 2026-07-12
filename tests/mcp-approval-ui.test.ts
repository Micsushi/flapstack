// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  McpApprovalSurface,
  type McpApprovalAction,
} from "../src/renderer/features/mcp-safety/approval-ui"
import type { McpPendingApprovalView } from "../src/renderer/features/mcp-safety/model"

const approval: McpPendingApprovalView = {
  id: "approval-1",
  chatId: "chat-1",
  chatName: "Fix parser",
  callerLabel: "Claude / run-1",
  toolName: "archive_item",
  risk: 2,
  targetLabel: "Chat: Fix parser",
  inputSummary: "Archive the selected chat",
  requestedAt: "2026-07-12T10:00:00.000Z",
  expiresAt: "2026-07-12T10:05:00.000Z",
  state: "pending",
  sessionGrantOptions: ["This chat session"],
}

describe("MCP approval UI", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.querySelectorAll("[data-radix-portal]").forEach((element) => element.remove())
    vi.restoreAllMocks()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("shows the active request with its bounded decision context and session grant", async () => {
    const onDecision = vi.fn(async () => ({ resolved: true }))

    await act(async () => {
      root.render(
        createElement(McpApprovalSurface, {
          approvals: [approval],
          activeChatId: "chat-1",
          onDecision,
        }),
      )
    })

    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain("Claude / run-1")
    expect(dialog?.textContent).toContain("archive_item")
    expect(dialog?.textContent).toContain("Tier 2")
    expect(dialog?.textContent).toContain("Chat: Fix parser")
    expect(dialog?.textContent).toContain("Archive the selected chat")
    expect(
      dialog?.querySelector('[aria-label="Approve this tool for the current chat session"]'),
    ).not.toBeNull()

    const sessionGrant = dialog?.querySelector('[role="checkbox"]') as HTMLElement
    const approve = dialog?.querySelector(
      '[aria-label="Approve archive_item"]',
    ) as HTMLButtonElement
    await act(async () => sessionGrant.click())
    await act(async () => approve.click())
    expect(onDecision).toHaveBeenCalledWith({
      id: "approval-1",
      decision: "approve",
      grantSession: true,
    } satisfies McpApprovalAction)
  })

  it("shows a background notice without moving focus or opening a dialog", async () => {
    const focusTarget = document.createElement("button")
    document.body.append(focusTarget)
    focusTarget.focus()
    const onDecision = vi.fn(async () => ({ resolved: true }))

    await act(async () => {
      root.render(
        createElement(McpApprovalSurface, {
          approvals: [approval],
          activeChatId: "chat-2",
          onDecision,
        }),
      )
    })

    expect(document.activeElement).toBe(focusTarget)
    expect(
      container.querySelector('[data-mcp-approval-notice="background"]')?.textContent,
    ).toContain("1 approval pending in 1 background chat")
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    focusTarget.remove()
  })

  it("does not offer a reusable session grant for Tier 3 and closes stale decisions", async () => {
    const onDecision = vi.fn(async () => ({ resolved: false }))
    const tierThree = { ...approval, id: "approval-3", risk: 3 as const }

    await act(async () => {
      root.render(
        createElement(McpApprovalSurface, {
          approvals: [tierThree],
          activeChatId: "chat-1",
          onDecision,
        }),
      )
    })
    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.querySelector('[role="checkbox"]')).toBeNull()

    await act(async () => {
      ;(dialog?.querySelector('[aria-label="Deny archive_item"]') as HTMLButtonElement).click()
    })
    expect(onDecision).toHaveBeenCalledWith({
      id: "approval-3",
      decision: "deny",
      grantSession: false,
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})
