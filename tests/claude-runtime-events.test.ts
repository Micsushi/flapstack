import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  ClaudeRuntimeEventMapper,
  ClaudeRuntimeProtocolError,
  sanitizeClaudeDiagnostic,
} from "../src/main/lib/agent-runtime/claude-code"

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/agent-runtime/claude-code-sdk-0.3.207.json"),
    "utf8",
  ),
) as { events: SDKMessage[] }

describe("Claude Runtime SDK event mapping", () => {
  it("never persists thinking text when reasoning display is disabled", () => {
    const mapper = new ClaudeRuntimeEventMapper({ ...controls(), reasoningDisplay: false })
    const events = fixture.events.flatMap((event) => mapper.map(event))
    expect(events.some((event) => event.kind === "provider-visible-reasoning")).toBe(false)
    expect(JSON.stringify(events)).not.toContain("VISIBLE_THINKING_A")
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "private-metadata", displayClass: "private" }),
    )
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
