import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  RuntimeActivityControls,
  RuntimeActivityTimeline,
} from "../src/renderer/features/agents/runtime-activity"
import type { RuntimeCapabilitySnapshot, RuntimeLaunchControls } from "../src/shared/agent-runtime"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity component", () => {
  it("is collected as TSX and renders one virtualized provider-neutral surface", () => {
    const events = Array.from({ length: 500 }, (_, index) =>
      activity(
        index % 4 === 0 ? "reasoning-summary" : "agent-text",
        { text: `activity ${index}` },
        {
          storageId: index + 1,
          sequence: index + 1,
          eventId: `event-${index + 1}`,
          runtime: index % 3 === 0 ? "codex" : index % 3 === 1 ? "claude-code" : "flapstack-native",
          providerItemId: `item-${index + 1}`,
        },
      ),
    )
    const html = renderToStaticMarkup(
      <RuntimeActivityTimeline events={events} status="live" viewportHeight={320} />,
    )
    expect(html).toContain('aria-label="Runtime transcript and activity timeline"')
    expect(html).toContain('role="feed"')
    expect(html).toContain("Reasoning summary")
    expect(html).toContain('aria-label="Expand Reasoning summary"')
    expect(html).toContain("activity 1")
    expect(html).not.toContain("activity 499")
    expect((html.match(/data-runtime-activity-key=/g) ?? []).length).toBeLessThan(20)
    expect(html).toContain("Live")
  })

  it("renders only supported independent controls", () => {
    const supported = (value: boolean) => ({
      supported: value,
      reason: value ? null : "unsupported",
    })
    const capabilities: RuntimeCapabilitySnapshot = {
      schemaVersion: 1,
      status: "available",
      capturedAt: null,
      controls: {
        modelThinking: supported(true),
        reasoningDisplay: supported(true),
        subagentActivity: supported(false),
        hookDiagnostics: supported(true),
      },
      limitations: [],
      unavailableReason: null,
    }
    const controls: RuntimeLaunchControls = {
      schemaVersion: 1,
      modelEffort: "high",
      modelThinking: true,
      reasoningDisplay: true,
      subagentActivity: true,
      hookDiagnostics: false,
    }
    const html = renderToStaticMarkup(
      <RuntimeActivityControls
        controls={controls}
        capabilities={capabilities}
        onChange={() => {}}
      />,
    )
    expect(html).toContain("Model effort")
    expect(html).toContain("Model thinking")
    expect(html).toContain("Show provider-visible reasoning")
    expect(html).toContain("Show hook diagnostics")
    expect(html).not.toContain("Show child and subagent activity")
  })
})
