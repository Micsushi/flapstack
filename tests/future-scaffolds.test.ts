import { describe, expect, it } from "vitest"
import { listFutureStageCapabilities } from "../src/main/lib/future-stage/capabilities"
import { evaluateMcpGate } from "../src/main/lib/mcp-control/gate"
import { mcpControlTools } from "../src/main/lib/mcp-control/registry"
import { resolveSttAdapter, ttsAdapters } from "../src/main/lib/speech/registry"
import { extractSpokenSection, filterSpeakableText } from "../src/main/lib/speech/speakable-filter"
import { createFallbackSpokenSummary } from "../src/main/lib/speech/spoken-summary"

describe("future stage scaffolds", () => {
  it("publishes truthful capability records for delivered feature families", () => {
    const capabilities = listFutureStageCapabilities()

    expect(capabilities.map((capability) => capability.id)).toContain("stage2-voice")
    expect(capabilities.map((capability) => capability.id)).toContain("stage3-mcp-control")
    expect(capabilities.map((capability) => capability.id)).toContain("automation")
    expect(capabilities.every((capability) => capability.gate.length > 0)).toBe(true)
    expect(
      capabilities
        .filter((capability) => capability.id !== "stage2-voice")
        .every((capability) => !["planned", "scaffolded"].includes(capability.status)),
    ).toBe(true)
    expect(capabilities.find((capability) => capability.id === "automation")).toMatchObject({
      stage: "Stage 4",
      status: "experimental",
    })
  })

  it("auto-approves MCP Tier 3 for full access", () => {
    expect(evaluateMcpGate({ tier: 3, permissionMode: "full-access" })).toMatchObject({
      decision: "allowed",
      requiresApproval: false,
    })
  })

  it("blocks mutating MCP tools for read-only callers", () => {
    expect(evaluateMcpGate({ tier: 1, permissionMode: "read-only" })).toMatchObject({
      decision: "denied",
    })

    expect(evaluateMcpGate({ tier: 0, permissionMode: "read-only" })).toMatchObject({
      decision: "allowed",
    })
  })

  it("registers scaffolded MCP tools with risk tiers", () => {
    expect(mcpControlTools.some((tool) => tool.name === "describe" && tool.tier === 0)).toBe(true)
    expect(mcpControlTools.some((tool) => tool.name === "launch_run" && tool.tier === 3)).toBe(true)
    expect(mcpControlTools.some((tool) => tool.name === "wait_for_chats" && tool.tier === 3)).toBe(
      true,
    )
  })

  it("resolves offline STT when configured", () => {
    expect(resolveSttAdapter({ sttAdapterId: "missing", preferOffline: true })).toMatchObject({
      id: "local-parakeet",
    })
  })

  it("registers native and Kokoro TTS adapters", () => {
    expect(ttsAdapters.map((adapter) => adapter.id)).toEqual(["kokoro", "native-os"])
  })

  it("extracts spoken sections before display details", () => {
    const markdown = "Spoken:\nShip is ready.\n\nDisplayed:\n```ts\nconst hidden = true\n```"
    expect(extractSpokenSection(markdown)).toBe("Ship is ready.")
    expect(filterSpeakableText(markdown)).toMatchObject({
      shouldSpeak: true,
      text: "Ship is ready.",
      source: "spoken",
    })
  })

  it("creates a spoken fallback without code blocks", () => {
    const spoken = createFallbackSpokenSummary(
      "Done.\n\n```ts\nconst value = '/tmp/example'\n```\n\nRead the detailed output on screen.",
    )

    expect(spoken).toContain("Done")
    expect(spoken).not.toContain("const value")
  })
})
