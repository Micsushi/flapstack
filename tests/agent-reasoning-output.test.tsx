// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { AgentReasoningOutput } from "../src/renderer/features/agents/ui/agent-reasoning-output"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

function renderReasoning(part: any, props: Record<string, unknown> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<AgentReasoningOutput part={part} {...props} />)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("AgentReasoningOutput", () => {
  it("renders an accessible completed disclosure with persisted duration", async () => {
    renderReasoning(
      {
        type: "tool-ReasoningOutput",
        state: "output-available",
        label: "Reasoning summary",
        input: { text: "Checked the persisted response." },
      },
      { chatStatus: "ready", durationMs: 5_500, startedAt: 1_000 },
    )

    const disclosure = document.body.querySelector('button[aria-expanded="false"]') as HTMLElement
    expect(disclosure).not.toBeNull()
    expect(disclosure.textContent).toContain("Worked for 5s")
    expect(disclosure.textContent).toContain("Reasoning summary")
    expect(document.body.textContent).not.toContain("Checked the persisted response.")

    await act(async () => disclosure.click())
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    expect(document.body.textContent).toContain("Checked the persisted response.")
  })

  it("does not fabricate a completed disclosure for token-only or absent text", () => {
    const container = renderReasoning(
      {
        type: "tool-ReasoningOutput",
        state: "output-available",
        label: "Reasoning tokens",
        tokens: 32,
        input: { text: "" },
      },
      { chatStatus: "ready", durationMs: 1_000 },
    )
    expect(container.textContent).toBe("")
    expect(document.body.querySelector("button")).toBeNull()
  })
})
