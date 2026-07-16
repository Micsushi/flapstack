import { describe, expect, it } from "vitest"
import { RuntimeActivityChatChunkMapper } from "../src/renderer/features/agents/lib/runtime-activity-chat-chunks"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity normal chat projection", () => {
  it("projects provider-visible reasoning without duplicating the completed snapshot", () => {
    const mapper = new RuntimeActivityChatChunkMapper("run")
    const chunks = mapper.map([
      activity(
        "provider-visible-reasoning",
        { text: "", label: "Reasoning" },
        {
          phase: "started",
          providerItemId: "stream-wrapper-1",
          providerMessageId: "message-1",
          contentIndex: 0,
          sequence: 1,
        },
      ),
      activity(
        "provider-visible-reasoning",
        { text: "Inspect ", label: "Reasoning" },
        {
          phase: "delta",
          providerItemId: "stream-wrapper-2",
          providerMessageId: "message-1",
          contentIndex: 0,
          sequence: 2,
        },
      ),
      activity(
        "provider-visible-reasoning",
        { text: "Inspect files", label: "Reasoning" },
        {
          phase: "completed",
          providerItemId: "snapshot-message",
          providerMessageId: "message-1",
          contentIndex: 0,
          sequence: 3,
        },
      ),
    ])

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
    ])
    expect(chunks).toContainEqual(expect.objectContaining({ delta: "Inspect " }))
  })

  it("projects commands, tools, and patches into the existing tool-card protocol", () => {
    const mapper = new RuntimeActivityChatChunkMapper("run")
    const chunks = mapper.map([
      activity(
        "command",
        { command: "npm test", state: "running" },
        { phase: "started", providerItemId: "command-1", sequence: 1 },
      ),
      activity(
        "command",
        { state: "running", outputSummary: "passing" },
        { phase: "delta", providerItemId: "command-1", sequence: 2 },
      ),
      activity(
        "command",
        { command: "npm test", state: "completed", exitCode: 0 },
        { phase: "completed", providerItemId: "command-1", sequence: 3 },
      ),
      activity(
        "patch",
        {
          path: "src/app.ts",
          state: "completed",
          summary: "+1 line",
          changes: [{ path: "src/app.ts", kind: "update", diff: "+const ready = true" }],
        },
        { phase: "completed", providerItemId: "patch-1", sequence: 4 },
      ),
      activity(
        "tool",
        { name: "Read", state: "requested", inputSummary: "src/app.ts" },
        { phase: "started", providerToolId: "tool-1", sequence: 5 },
      ),
      activity(
        "tool",
        { name: "tool-result", state: "completed", outputSummary: "read complete" },
        { phase: "completed", providerToolId: "tool-1", sequence: 6 },
      ),
    ])

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "Bash",
        input: { command: "npm test" },
      }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { stdout: "passing", exitCode: 0 },
      }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "ApplyPatch",
        input: expect.objectContaining({
          changes: [{ path: "src/app.ts", kind: "update", diff: "+const ready = true" }],
        }),
      }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "tool-input-available", toolName: "Read" }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { summary: "read complete", state: "completed" },
      }),
    )
  })

  it("uses the terminal command snapshot without duplicating streamed output", () => {
    const mapper = new RuntimeActivityChatChunkMapper("run")
    const chunks = mapper.map([
      activity(
        "command",
        { command: "printf foobar", state: "running" },
        { phase: "started", providerItemId: "command-1", sequence: 1 },
      ),
      activity(
        "command",
        { state: "running", outputSummary: "foo" },
        { phase: "delta", providerItemId: "command-1", sequence: 2 },
      ),
      activity(
        "command",
        { state: "running", outputSummary: "bar" },
        { phase: "delta", providerItemId: "command-1", sequence: 3 },
      ),
      activity(
        "command",
        { command: "printf foobar", state: "completed", outputSummary: "foobar", exitCode: 0 },
        { phase: "completed", providerItemId: "command-1", sequence: 4 },
      ),
    ])

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { stdout: "foobar", exitCode: 0 },
      }),
    )
  })

  it("keeps Claude tool input-complete open until the real tool result arrives", () => {
    const mapper = new RuntimeActivityChatChunkMapper("run")
    const chunks = mapper.map([
      activity(
        "tool",
        { name: "Bash", state: "started" },
        { phase: "started", providerToolId: "tool-1", sequence: 1 },
      ),
      activity(
        "tool",
        { name: "Bash", state: "input-streaming" },
        { phase: "updated", providerToolId: "tool-1", sequence: 2 },
      ),
      activity(
        "tool",
        { name: "Bash", state: "input-complete", input: { command: "npm test" } },
        { phase: "updated", providerToolId: "tool-1", sequence: 3 },
      ),
      activity(
        "tool",
        {
          name: "tool-result",
          state: "completed",
          output: { stdout: "passed", exitCode: 0 },
          outputSummary: "passed",
        },
        { phase: "completed", providerToolId: "tool-1", sequence: 4 },
      ),
    ])

    expect(chunks.filter((chunk) => chunk.type === "tool-input-available")).toEqual([
      expect.objectContaining({ toolName: "Bash", input: { command: "npm test" } }),
    ])
    expect(chunks.filter((chunk) => chunk.type === "tool-output-available")).toEqual([
      expect.objectContaining({ output: { stdout: "passed", exitCode: 0 } }),
    ])
    expect(chunks.some((chunk) => chunk.type === "tool-output-error")).toBe(false)
  })

  it("closes provider-visible reasoning when Codex moves to assistant text", () => {
    const mapper = new RuntimeActivityChatChunkMapper("run")
    const chunks = mapper.map([
      activity(
        "provider-visible-reasoning",
        { text: "Inspecting", label: "Reasoning" },
        {
          phase: "delta",
          providerItemId: "reasoning-1",
          contentIndex: 1,
          sequence: 1,
        },
      ),
    ])
    chunks.push(...mapper.beforeText())

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
    ])
  })
})
