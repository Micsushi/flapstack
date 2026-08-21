// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentChatWaitBadge,
  type AgentChatWaitView,
} from "../src/renderer/features/sidebar/agent-chat-badge"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

const baseWait: AgentChatWaitView = {
  id: "wait-1",
  chatId: "waiter",
  targetChatIds: ["target"],
  targetNames: ["Worker"],
  status: "waiting",
  error: null,
  createdAt: 10,
}

function render(props: Parameters<typeof AgentChatWaitBadge>[0]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(React.createElement(AgentChatWaitBadge, props))
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("agent chat wait badge", () => {
  it("reads as pending while the wait can still resume the chat", () => {
    const container = render({ wait: baseWait })
    const badge = container.querySelector("span[aria-label]") as HTMLElement

    expect(badge.textContent).toContain("Waiting")
    expect(badge.getAttribute("aria-label")).toBe("Agent waiting for Worker")
    expect(container.querySelector('button[aria-label="Dismiss failed wait"]')).toBeNull()
  })

  it("reads as failed and explains why once the wait can never resume", () => {
    const container = render({
      wait: {
        ...baseWait,
        status: "failed",
        error: "A waiting chat or target was archived or removed.",
      },
    })
    const badge = container.querySelector("span[aria-label]") as HTMLElement

    expect(badge.textContent).toContain("Wait failed")
    expect(badge.getAttribute("aria-label")).toBe(
      "Agent wait for Worker failed: A waiting chat or target was archived or removed.",
    )
  })

  it("offers dismissal only for failed waits and does not select the row", () => {
    const onDismiss = vi.fn()
    const rowClick = vi.fn()

    // The badge lives inside a clickable chat row; dismissing must not select it.
    const row = document.createElement("div")
    row.addEventListener("click", rowClick)
    const container = document.createElement("div")
    row.appendChild(container)
    document.body.appendChild(row)
    root = createRoot(container)
    act(() => {
      root!.render(
        React.createElement(AgentChatWaitBadge, {
          wait: { ...baseWait, status: "failed", error: "queue rejected the resume" },
          onDismiss,
        }),
      )
    })

    const dismiss = container.querySelector(
      'button[aria-label="Dismiss failed wait"]',
    ) as HTMLButtonElement
    expect(dismiss).not.toBeNull()
    act(() => dismiss.click())

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(rowClick).not.toHaveBeenCalled()
  })

  it("keeps a pending wait undismissable even when a handler is supplied", () => {
    const container = render({ wait: baseWait, onDismiss: vi.fn() })
    expect(container.querySelector('button[aria-label="Dismiss failed wait"]')).toBeNull()
  })

  it("keeps failed-wait dismissal accessible in compact headers", () => {
    const container = render({
      wait: { ...baseWait, status: "failed", error: "resume failed" },
      compact: true,
      header: true,
      onDismiss: vi.fn(),
    })
    expect(container.querySelector('button[aria-label="Dismiss failed wait"]')).not.toBeNull()
  })
})
