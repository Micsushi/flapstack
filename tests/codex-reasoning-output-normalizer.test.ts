import { describe, expect, it } from "vitest"
import {
  normalizeCodexStreamChunk,
  normalizeCodexToolPart,
} from "../src/shared/codex-tool-normalizer"

describe("Codex visible thought normalization", () => {
  it("maps an ACP Thought content field into reasoning-output text", () => {
    expect(
      normalizeCodexToolPart({
        type: "tool-acp.acp_provider_agent_dynamic_tool",
        state: "input-available",
        input: {
          toolName: "Thought Checking the failing test",
          args: { content: "Checking the failing test." },
        },
      }),
    ).toMatchObject({
      type: "tool-ReasoningOutput",
      input: { text: "Checking the failing test." },
    })
  })

  it("maps streamed ACP Thought chunks into canonical reasoning-output input", () => {
    expect(
      normalizeCodexStreamChunk({
        type: "tool-input-available",
        toolCallId: "thought-1",
        toolName: "Thought Checking the failing test",
        input: { args: { thought: "Checking the failing test." } },
      }),
    ).toMatchObject({
      toolName: "ReasoningOutput",
      input: { text: "Checking the failing test." },
    })
  })
})
