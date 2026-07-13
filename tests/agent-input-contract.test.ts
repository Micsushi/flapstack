import { describe, expect, it } from "vitest"
import { agentInputRequestSchema } from "../src/shared/agent-input"
import {
  getAgentInputCapability,
  listAgentInputCapabilities,
  registerAgentInputCapability,
} from "../src/main/lib/harness/input-capabilities"

const validRequest = {
  requestId: "request-1",
  chatId: "chat-1",
  runId: "run-1",
  origin: { harness: "claude-code" },
  capability: { mode: "native", sameRun: true },
  questions: [
    {
      id: "question-1",
      question: "Choose a branch",
      options: [{ id: "main", label: "main" }],
      multiSelect: false,
      allowCustom: true,
    },
  ],
  status: "pending",
  createdAt: 1,
} as const

describe("agent input contract", () => {
  it("accepts one bounded provider-neutral request", () => {
    expect(agentInputRequestSchema.parse(validRequest)).toMatchObject({
      requestId: "request-1",
      origin: { harness: "claude-code" },
    })
  })

  it("rejects duplicate question IDs and oversized payloads", () => {
    expect(() =>
      agentInputRequestSchema.parse({
        ...validRequest,
        questions: [validRequest.questions[0], validRequest.questions[0]],
      }),
    ).toThrow(/unique/i)
    expect(() =>
      agentInputRequestSchema.parse({
        ...validRequest,
        questions: [{ ...validRequest.questions[0], question: "x".repeat(2_001) }],
      }),
    ).toThrow()
  })

  it("declares one honest capability per current harness family", () => {
    expect(listAgentInputCapabilities().map(({ harness }) => harness)).toEqual([
      "claude-code",
      "codex",
      "cursor-agent",
      "custom",
      "local",
      "nanogpt",
      "openrouter",
    ])
    expect(getAgentInputCapability("claude-code")).toEqual({ mode: "native", sameRun: true })
    expect(getAgentInputCapability("codex")).toMatchObject({ mode: "continuation", sameRun: false })
    expect(getAgentInputCapability("unknown")).toMatchObject({
      mode: "unsupported",
      sameRun: false,
    })
  })

  it("lets a future harness register without renderer changes", () => {
    const restore = registerAgentInputCapability("fixture-harness", {
      mode: "injected-tool",
      sameRun: true,
    })
    expect(getAgentInputCapability("fixture-harness")).toEqual({
      mode: "injected-tool",
      sameRun: true,
    })
    restore()
    expect(getAgentInputCapability("fixture-harness").mode).toBe("unsupported")
  })
})
