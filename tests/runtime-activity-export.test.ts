import { describe, expect, it } from "vitest"
import {
  DEFAULT_RUNTIME_ACTIVITY_FILTERS,
  filterRuntimeActivityRows,
  projectRuntimeActivityRows,
  serializeRuntimeActivity,
  updateRuntimeLaunchControl,
  visibleRuntimeControlKeys,
} from "../src/renderer/features/agents/runtime-activity"
import type { RuntimeCapabilitySnapshot, RuntimeLaunchControls } from "../src/shared/agent-runtime"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity filter, copy, export, and controls", () => {
  const rows = projectRuntimeActivityRows([
    activity("agent-text", { text: "Visible answer" }, { storageId: 1 }),
    activity(
      "hook",
      { name: "PostToolUse", state: "completed", summary: "hook detail" },
      { storageId: 2 },
    ),
    activity(
      "subagent",
      { agentId: "child", state: "completed", message: "child detail" },
      { storageId: 3 },
    ),
    activity(
      "private-metadata",
      { eventType: "private", metadata: { secret: "DO_NOT_LEAK" } },
      { storageId: 4, displayClass: "private", privacyClass: "private" },
    ),
    activity(
      "opaque-metadata",
      { eventType: "safe-unknown", metadata: { arbitrary: "DO_NOT_EXPORT" } },
      { storageId: 5, displayClass: "metadata" },
    ),
  ])

  it("filters search, hooks, and subagents independently", () => {
    expect(
      filterRuntimeActivityRows(rows, {
        ...DEFAULT_RUNTIME_ACTIVITY_FILTERS,
        search: "visible answer",
      }).map((row) => row.kind),
    ).toEqual(["agent-text"])
    expect(
      filterRuntimeActivityRows(rows, {
        ...DEFAULT_RUNTIME_ACTIVITY_FILTERS,
        hookDiagnostics: false,
        subagentActivity: false,
      }).map((row) => row.kind),
    ).toEqual(["agent-text", "private-metadata", "opaque-metadata"])
  })

  it("copies and exports only allowed visible content", () => {
    for (const format of ["text", "markdown", "json"] as const) {
      const output = serializeRuntimeActivity(rows, format)
      expect(output).toContain("Visible answer")
      expect(output).toContain("child detail")
      expect(output).not.toContain("DO_NOT_LEAK")
      expect(output).not.toContain("DO_NOT_EXPORT")
      expect(output).not.toContain("safe-unknown")
    }
  })

  it("updates exactly one persisted launch control and hides unsupported controls", () => {
    const controls: RuntimeLaunchControls = {
      schemaVersion: 1,
      modelEffort: "medium",
      modelThinking: true,
      reasoningDisplay: true,
      subagentActivity: true,
      hookDiagnostics: false,
    }
    const next = updateRuntimeLaunchControl(controls, "hookDiagnostics", true)
    expect(next).toEqual({ ...controls, hookDiagnostics: true })
    expect(controls.hookDiagnostics).toBe(false)
    const capability = (supported: boolean) => ({
      supported,
      reason: supported ? null : "unsupported",
    })
    const capabilities: RuntimeCapabilitySnapshot = {
      schemaVersion: 1,
      status: "available",
      capturedAt: null,
      controls: {
        modelThinking: capability(true),
        reasoningDisplay: capability(true),
        subagentActivity: capability(false),
        hookDiagnostics: capability(true),
      },
      limitations: [],
      unavailableReason: null,
    }
    expect(visibleRuntimeControlKeys(capabilities)).toEqual([
      "modelEffort",
      "modelThinking",
      "reasoningDisplay",
      "hookDiagnostics",
    ])
  })
})
