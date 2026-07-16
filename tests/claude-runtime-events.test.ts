import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  ClaudeRuntimeEventMapper,
  ClaudeRuntimeProtocolError,
  sanitizeClaudeDiagnostic,
} from "../src/main/lib/agent-runtime/claude-code"
import {
  MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
  parseAgentActivityAppend,
} from "../src/shared/agent-activity"

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/agent-runtime/claude-code-sdk-0.3.207.json"),
    "utf8",
  ),
) as { events: SDKMessage[] }

describe("Claude Runtime SDK event mapping", () => {
  it("preserves block order, UUIDs, tool lineage, hooks, usage, and result identity", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const events = fixture.events.flatMap((event) => mapper.map(event))

    const thinking = events.filter((event) => event.kind === "provider-visible-reasoning")
    expect(thinking.map((event) => [event.phase, event.contentIndex])).toEqual([
      ["started", 0],
      ["delta", 0],
      ["completed", 0],
      ["completed", 0],
    ])
    expect(thinking[1]).toMatchObject({
      providerEventId: "stream-thinking-delta",
      providerSessionId: "session-1",
      payload: { text: "VISIBLE_THINKING_A", label: "Claude thinking" },
    })

    const childTool = events.find(
      (event) => event.kind === "tool" && event.providerToolId === "child-tool-1",
    )
    expect(childTool).toMatchObject({
      providerParentItemId: "tool-1",
      providerMessageId: "provider-child-message-1",
      contentIndex: 1,
    })
    expect(events.filter((event) => event.kind === "hook")).toHaveLength(2)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "permission",
        providerToolId: "tool-denied-1",
        phase: "failed",
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "usage",
        privacyClass: "sensitive",
        providerMessageId: "result-uuid-1",
        payload: expect.objectContaining({ inputTokens: 11, outputTokens: 9, costUsd: 0.001 }),
      }),
    )
  })

  it("never persists thinking text when reasoning display is disabled", () => {
    const mapper = new ClaudeRuntimeEventMapper({ ...controls(), reasoningDisplay: false })
    const events = fixture.events.flatMap((event) => mapper.map(event))
    expect(events.some((event) => event.kind === "provider-visible-reasoning")).toBe(false)
    expect(JSON.stringify(events)).not.toContain("VISIBLE_THINKING_A")
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "private-metadata", displayClass: "private" }),
    )
  })

  it("suppresses child and hook activity independently", () => {
    const mapper = new ClaudeRuntimeEventMapper({
      ...controls(),
      subagentActivity: false,
      hookDiagnostics: false,
    })
    const events = fixture.events.flatMap((event) => mapper.map(event))
    expect(events.some((event) => event.kind === "subagent")).toBe(false)
    expect(events.some((event) => event.kind === "hook")).toBe(false)
    expect(events.some((event) => event.kind === "provider-visible-reasoning")).toBe(true)
  })

  it("fails closed for critical unknown variants and bounds sanitized diagnostics", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    expect(() =>
      mapper.map({
        type: "system",
        subtype: "session_execution_v2",
        uuid: "unknown-uuid",
        session_id: "session-1",
      } as unknown as SDKMessage),
    ).toThrow(ClaudeRuntimeProtocolError)

    const safe = sanitizeClaudeDiagnostic(
      "ANTHROPIC_API_KEY=sk-secret /Users/person/private/file token-secret",
    )
    expect(safe).not.toContain("sk-secret")
    expect(safe).not.toContain("/Users/person")
    expect(safe).toContain("[secret]")
    expect(safe).toContain("[path]")
  })

  it("produces stable dedup keys for duplicate provider delivery", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const event = fixture.events.find(
      (candidate) => (candidate as { uuid?: string }).uuid === "assistant-uuid-1",
    )!
    const first = mapper.map(event)
    const second = mapper.map(event)
    expect(second.map((activity) => activity.dedupKey)).toEqual(
      first.map((activity) => activity.dedupKey),
    )
  })

  it("assigns distinct dedup identities to blocks and usage from one SDK message", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const event = fixture.events.find(
      (candidate) => (candidate as { uuid?: string }).uuid === "assistant-uuid-1",
    )!
    const mapped = mapper.map(event)
    const keys = mapped.map((activity) => activity.dedupKey)

    expect(new Set(keys).size).toBe(keys.length)
    expect(mapped.map((activity) => activity.kind)).toEqual(
      expect.arrayContaining(["provider-visible-reasoning", "agent-text", "tool", "usage"]),
    )
  })

  it("preserves streamed tool input and waits for the user tool result to complete it", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const messages = [
      {
        type: "stream_event",
        uuid: "wrapper-start",
        session_id: "session-1",
        event: { type: "message_start", message: { id: "message-1" } },
      },
      {
        type: "stream_event",
        uuid: "wrapper-tool-start",
        session_id: "session-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "Bash" },
        },
      },
      {
        type: "stream_event",
        uuid: "wrapper-tool-input",
        session_id: "session-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"command":"npm test"}' },
        },
      },
      {
        type: "stream_event",
        uuid: "wrapper-tool-stop",
        session_id: "session-1",
        event: { type: "content_block_stop", index: 0 },
      },
      {
        type: "user",
        uuid: "tool-result-message",
        session_id: "session-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "passed",
              is_error: false,
            },
          ],
        },
        tool_use_result: { stdout: "passed", exitCode: 0 },
      },
    ] as unknown as SDKMessage[]

    const events = messages.flatMap((message) => mapper.map(message))
    const inputComplete = events.find(
      (event) => event.kind === "tool" && event.payload.state === "input-complete",
    )
    expect(inputComplete).toMatchObject({
      phase: "updated",
      providerMessageId: "message-1",
      providerToolId: "tool-1",
      payload: { input: { command: "npm test" } },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        phase: "completed",
        providerToolId: "tool-1",
        payload: expect.objectContaining({
          output: { stdout: "passed", exitCode: 0 },
          outputSummary: '{"stdout":"passed","exitCode":0}',
        }),
      }),
    )
  })

  it("bounds oversized provider text, init lists, identities, and tool names before append", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const huge = "🧠".repeat(40_000)
    const init = mapper.map({
      type: "system",
      subtype: "init",
      model: huge,
      claude_code_version: "2.1.207",
      permissionMode: "default",
      tools: Array.from({ length: 500 }, (_, index) => `${index}-${huge}`),
      capabilities: Array.from({ length: 500 }, (_, index) => `cap-${index}-${huge}`),
      uuid: huge,
      session_id: huge,
    } as unknown as SDKMessage)
    const assistant = mapper.map({
      type: "assistant",
      message: {
        id: huge,
        content: [
          { type: "thinking", thinking: huge },
          { type: "text", text: huge },
          { type: "tool_use", id: huge, name: huge, input: {} },
        ],
      },
      parent_tool_use_id: null,
      uuid: huge,
      session_id: huge,
    } as unknown as SDKMessage)

    for (const activity of [...init, ...assistant]) {
      expect(() => parseAgentActivityAppend(activity)).not.toThrow()
      expect(Buffer.byteLength(JSON.stringify(activity.payload), "utf8")).toBeLessThanOrEqual(
        MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
      )
      expect(Buffer.byteLength(activity.providerSessionId || "", "utf8")).toBeLessThanOrEqual(2048)
    }
    expect(JSON.stringify([...init, ...assistant])).toContain("[truncated]")
    const tool = assistant.find((activity) => activity.kind === "tool")
    expect(Buffer.byteLength(tool?.payload.name || "", "utf8")).toBeLessThanOrEqual(512)
    expect((init[0].payload as { detail?: string }).detail).toContain('"toolsTruncated":true')
  })

  it("bounds the total serialized size of structured tool input and output", () => {
    const mapper = new ClaudeRuntimeEventMapper(controls())
    const hugeObject = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`field-${index}`, "x".repeat(8_192)]),
    )
    const messages = [
      {
        type: "assistant",
        uuid: "assistant-large-tool",
        session_id: "session-1",
        message: {
          id: "message-large-tool",
          content: [{ type: "tool_use", id: "tool-large", name: "Read", input: hugeObject }],
        },
      },
      {
        type: "user",
        uuid: "user-large-result",
        session_id: "session-1",
        message: {
          id: "message-large-result",
          content: [{ type: "tool_result", tool_use_id: "tool-large", content: hugeObject }],
        },
      },
    ] as unknown as SDKMessage[]

    for (const event of messages.flatMap((message) => mapper.map(message))) {
      expect(Buffer.byteLength(JSON.stringify(event.payload), "utf8")).toBeLessThanOrEqual(
        MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
      )
      expect(() => parseAgentActivityAppend(event)).not.toThrow()
    }
  })
})

function controls() {
  return {
    schemaVersion: 1 as const,
    modelEffort: "high",
    modelThinking: true,
    reasoningDisplay: true,
    subagentActivity: true,
    hookDiagnostics: true,
  }
}
