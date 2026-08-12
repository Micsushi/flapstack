// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AgentBashTool } from "../src/renderer/features/agents/ui/agent-bash-tool"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const command = "printf COMMAND_DETAILS"

describe("AgentBashTool", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("collapses a completed command to one row and lets the user toggle its details", () => {
    act(() =>
      root.render(
        <AgentBashTool
          part={{
            type: "tool-Bash",
            state: "output-available",
            input: { command },
            output: { stdout: "COMMAND_OUTPUT", exitCode: 0 },
          }}
          chatStatus="ready"
        />,
      ),
    )

    expect(container.textContent).toContain("Ran command: printf")
    expect(container.querySelector("[data-command-details]")).toBeNull()

    const expand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand command details"]',
    )
    expect(expand).not.toBeNull()
    act(() => expand?.click())

    expect(container.querySelector("[data-command-details]")?.textContent).toContain(command)
    expect(container.querySelector("[data-command-details]")?.textContent).toContain(
      "COMMAND_OUTPUT",
    )

    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse command details"]',
    )
    act(() => collapse?.click())
    expect(container.querySelector("[data-command-details]")).toBeNull()
  })

  it("keeps a running command expanded", () => {
    act(() =>
      root.render(
        <AgentBashTool
          part={{ type: "tool-Bash", state: "input-available", input: { command } }}
          chatStatus="streaming"
        />,
      ),
    )

    expect(container.textContent).toContain("Running command: printf")
    expect(container.querySelector("[data-command-details]")?.textContent).toContain(command)

    act(() =>
      root.render(
        <AgentBashTool
          part={{
            type: "tool-Bash",
            state: "output-available",
            input: { command },
            output: { stdout: "COMMAND_OUTPUT", exitCode: 0 },
          }}
          chatStatus="ready"
        />,
      ),
    )

    expect(container.querySelector("[data-command-details]")).toBeNull()
  })
})
