import { describe, expect, it } from "vitest"
import { exposurePresentation } from "../src/renderer/features/mcp-safety/exposure-model"

describe("MCP exposure UI model", () => {
  it("keeps unconfigured chats off and untoggleable", () => {
    expect(exposurePresentation(undefined)).toMatchObject({
      label: "Checking MCP",
      canToggle: false,
    })
    expect(
      exposurePresentation({
        enabled: false,
        supported: false,
        connection: "unsupported",
        callerLabel: null,
        error: null,
      }),
    ).toMatchObject({ label: "Unsupported", canToggle: false })
  })

  it("shows enabled exposure as next-run instead of a live connection", () => {
    expect(
      exposurePresentation({
        enabled: true,
        supported: true,
        connection: "next-run",
        callerLabel: "Codex / chat-1",
        error: null,
      }),
    ).toMatchObject({ label: "Enabled for next run", canToggle: true })
  })

  it("shows the live product child as connected and stoppable", () => {
    expect(
      exposurePresentation({
        enabled: true,
        supported: true,
        connection: "connected",
        callerLabel: "Codex / chat-1 / run-1",
        activeRunIds: ["run-1"],
        error: null,
      }),
    ).toMatchObject({
      label: "Connected",
      detail: "1 active run has the local Flapstack MCP server. Disable to stop it.",
      canToggle: true,
    })
  })

  it("surfaces registration failures without claiming a connection", () => {
    expect(
      exposurePresentation({
        enabled: false,
        supported: true,
        connection: "disabled",
        callerLabel: "Claude / chat-1",
        error: "Flapstack MCP registration failed",
      }),
    ).toMatchObject({ label: "Registration error", canToggle: true })
  })
})
