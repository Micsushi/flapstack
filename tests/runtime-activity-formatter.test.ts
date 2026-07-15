import { describe, expect, it } from "vitest"
import {
  CriticalActivityFormatError,
  formatRuntimeActivity,
  projectRuntimeActivityRows,
} from "../src/renderer/features/agents/runtime-activity"
import type { AgentActivityEvent } from "../src/shared/agent-activity"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity formatters", () => {
  it("formats every T3 event kind deterministically", () => {
    const events: AgentActivityEvent[] = [
      activity("lifecycle", { state: "completed", detail: "Turn complete" }),
      activity("status", { message: "Reading files" }, { storageId: 2 }),
      activity("agent-text", { text: "Done." }, { storageId: 3 }),
      activity("reasoning-summary", { text: "Checked the contract." }, { storageId: 4 }),
      activity(
        "provider-visible-reasoning",
        { text: "Visible provider thought." },
        { storageId: 5 },
      ),
      activity(
        "plan",
        { items: [{ id: "one", text: "Implement", status: "completed" }] },
        { storageId: 6 },
      ),
      activity(
        "tool",
        { name: "Read", state: "completed", outputSummary: "README" },
        { storageId: 7 },
      ),
      activity(
        "command",
        { command: "npm test", state: "completed", exitCode: 0 },
        { storageId: 8 },
      ),
      activity("patch", { path: "app.ts", state: "completed", summary: "+1" }, { storageId: 9 }),
      activity(
        "permission",
        { requestType: "shell", state: "completed", decision: "allow" },
        { storageId: 10 },
      ),
      activity(
        "hook",
        { name: "PreToolUse", state: "completed", summary: "ok" },
        { storageId: 11 },
      ),
      activity(
        "subagent",
        { agentId: "child-1", state: "completed", message: "done" },
        { storageId: 12 },
      ),
      activity("warning", { message: "Near limit" }, { storageId: 13 }),
      activity(
        "compaction",
        { state: "completed", summary: "Context compacted" },
        { storageId: 14 },
      ),
      activity("usage", { inputTokens: 12, outputTokens: 4, costUsd: 0.01 }, { storageId: 15 }),
      activity(
        "opaque-metadata",
        { eventType: "future-safe", metadata: { bounded: true } },
        { storageId: 16 },
      ),
      activity(
        "private-metadata",
        { eventType: "encrypted-reasoning", metadata: null },
        {
          storageId: 17,
          displayClass: "private",
          privacyClass: "encrypted",
        },
      ),
    ]
    const rows = events.map(formatRuntimeActivity)
    expect(rows).toHaveLength(events.length)
    expect(rows.map((row) => row.label)).toEqual([
      "Lifecycle",
      "Activity summary",
      "Codex message",
      "Reasoning summary",
      "Provider-visible reasoning",
      "Plan",
      "Read",
      "Command",
      "Patch",
      "Permission",
      "Hook",
      "Subagent",
      "Warning",
      "Compaction",
      "Usage",
      "Metadata: future-safe",
      "Private reasoning unavailable",
    ])
    expect(rows[15]).toMatchObject({ content: null, copyable: false })
    expect(rows[16]).toMatchObject({ content: null, copyable: false, privateUnavailable: true })
  })

  it("uses Claude and Native reasoning labels without synthetic tools", () => {
    const claude = formatRuntimeActivity(
      activity(
        "provider-visible-reasoning",
        { text: "thinking" },
        { runtime: "claude-code", harness: "claude-code", provider: "claude-agent-sdk" },
      ),
    )
    const native = formatRuntimeActivity(
      activity("reasoning-summary", { text: "legacy" }, { runtime: "flapstack-native" }),
    )
    expect(claude.label).toBe("Provider-visible thinking")
    expect(claude.kind).not.toBe("tool")
    expect(native.label).toBe("Reasoning summary")
  })

  it("collapses deltas into stable sections and records lifecycle duration", () => {
    const base = {
      providerItemId: "reasoning-1",
      summaryIndex: 0,
      kind: "reasoning-summary" as const,
    }
    const rows = projectRuntimeActivityRows([
      activity(
        "reasoning-summary",
        { text: "" },
        { ...base, storageId: 1, phase: "started", providerTimestamp: 100 },
      ),
      activity(
        "reasoning-summary",
        { text: "First" },
        { ...base, storageId: 2, phase: "delta", providerTimestamp: 120 },
      ),
      activity(
        "reasoning-summary",
        { text: " section" },
        { ...base, storageId: 3, phase: "delta", providerTimestamp: 130 },
      ),
      activity(
        "reasoning-summary",
        { text: "Second" },
        {
          ...base,
          storageId: 4,
          phase: "delta",
          sectionBoundary: "summary-part",
          providerTimestamp: 140,
        },
      ),
      activity(
        "reasoning-summary",
        { text: "" },
        { ...base, storageId: 5, phase: "completed", providerTimestamp: 180 },
      ),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sections: ["First section", "Second"],
      content: "First section\n\nSecond",
      phase: "completed",
      durationMs: 80,
      defaultExpanded: false,
      expandable: true,
    })
  })

  it("labels legacy user text without inventing provider identity", () => {
    const row = formatRuntimeActivity({
      persisted: false,
      projectionId: "legacy:0:0",
      sequence: 1,
      messageIndex: 0,
      partIndex: 0,
      role: "user",
      kind: "agent-text",
      phase: "completed",
      displayClass: "provider-visible",
      provenance: "legacy-message-projection",
      providerIdentity: null,
      payload: { text: "Question" },
    })
    expect(row).toMatchObject({ label: "User message", identity: [] })
  })

  it("fails closed when an unknown critical kind reaches the formatter", () => {
    const invalid = activity("status", { message: "bad" }) as AgentActivityEvent & { kind: string }
    invalid.kind = "permission-v2"
    expect(() => formatRuntimeActivity(invalid as AgentActivityEvent)).toThrow(
      CriticalActivityFormatError,
    )
  })
})
