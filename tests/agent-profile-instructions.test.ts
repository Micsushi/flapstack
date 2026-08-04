import { describe, expect, it } from "vitest"
import { resolvedAgentProfileInstructions } from "../src/main/lib/agent-profiles/resolver"
import { DEFAULT_AGENT_CAPABILITY } from "../src/shared/agent-profiles"

describe("resolved Agent Profile instructions", () => {
  it("includes the complete presentation contract once", () => {
    const instructions = resolvedAgentProfileInstructions({
      capability: { ...DEFAULT_AGENT_CAPABILITY, instructions: "Review the change." },
      personality: {
        ref: { personalityId: "personality-1", version: 2 },
        metadata: {
          schemaVersion: 1,
          id: "personality-1",
          version: 2,
          name: "Direct",
          scope: { type: "user", projectId: null },
          base: null,
          traits: {
            tone: "warm",
            verbosity: "terse",
            formatting: "markdown",
            responseStructure: "Outcome, evidence, blockers.",
            labels: ["review"],
            color: "#4f46e5",
          },
        },
        body: "Review directly and cite evidence.",
        digest: "a".repeat(64),
        chain: [],
      },
      presentation: {
        tone: "warm",
        verbosity: "terse",
        formatting: "markdown",
        responseStructure: "Outcome, evidence, blockers.",
        characterLabel: null,
        voiceLabel: null,
        color: "#4f46e5",
      },
    })

    expect(instructions).toContain(
      "tone=warm; verbosity=terse; formatting=markdown; Outcome, evidence, blockers.",
    )
    expect(instructions.match(/Presentation style only/g)).toHaveLength(1)
  })
})
