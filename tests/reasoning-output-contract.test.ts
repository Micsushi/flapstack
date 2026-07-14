import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ReasoningOutputAccumulator,
  REASONING_OUTPUT_PROVIDERS,
  classifyReasoningVisibility,
  classifyReasoningOutputPersistence,
  isDisplayableReasoningOutput,
  normalizeReasoningOutput,
  reasoningOutputLabel,
  resolveReasoningControls,
  type ReasoningOutputEvent,
  type ReasoningOutputProvider,
} from "../src/shared/reasoning-output"

const FIXTURE_DIR = join(__dirname, "fixtures", "reasoning-output")

interface FixtureCase {
  name: string
  description: string
  raw: unknown
  expected: Array<{
    kind: ReasoningOutputEvent["kind"]
    phase: ReasoningOutputEvent["phase"]
    text?: string
    tokens?: number
    opaque?: boolean
  }>
}

interface FixtureFile {
  provider: ReasoningOutputProvider
  source: string
  cases: FixtureCase[]
}

function loadFixtures(): FixtureFile[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as FixtureFile)
}

describe("reasoning-output fixtures normalize to the shared contract", () => {
  const fixtures = loadFixtures()

  it("covers every provider in the contract", () => {
    const covered = new Set(fixtures.map((f) => f.provider))
    for (const provider of REASONING_OUTPUT_PROVIDERS) {
      expect(covered.has(provider), `missing fixtures for ${provider}`).toBe(true)
    }
  })

  for (const fixture of fixtures) {
    describe(fixture.provider, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, () => {
          const events = normalizeReasoningOutput(fixture.provider, testCase.raw)
          expect(events).toHaveLength(testCase.expected.length)

          events.forEach((event, i) => {
            const want = testCase.expected[i]
            expect(event.provider).toBe(fixture.provider)
            expect(event.kind).toBe(want.kind)
            expect(event.phase).toBe(want.phase)
            expect(typeof event.id).toBe("string")
            expect(event.id.length).toBeGreaterThan(0)

            if (want.text !== undefined) expect(event.text).toBe(want.text)
            if (want.tokens !== undefined) expect(event.tokens).toBe(want.tokens)
            if (want.opaque) expect(event.opaque).toBeDefined()
          })
        })
      }
    })
  }
})

describe("ReasoningOutputAccumulator (Track T2 incremental behavior)", () => {
  it("grows one part in order across three deltas", () => {
    const acc = new ReasoningOutputAccumulator()
    const deltas = ["Let me ", "check the ", "config."]
    for (const text of deltas) {
      acc.apply({
        provider: "claude-code",
        kind: "reasoning-output",
        phase: "delta",
        id: "b1",
        text,
      })
    }
    const parts = acc.toParts()
    expect(parts).toHaveLength(1)
    expect(parts[0].input.text).toBe("Let me check the config.")
    expect(parts[0].state).toBe("input-streaming")
  })

  it("marks a block done and completed on final", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "cursor",
      kind: "reasoning-output",
      phase: "delta",
      id: "b1",
      text: "Hmm.",
    })
    acc.apply({ provider: "cursor", kind: "reasoning-output", phase: "final", id: "b1" })
    const [part] = acc.toParts()
    expect(part.state).toBe("output-available")
    expect(part.output).toEqual({ completed: true })
    expect(part.input.text).toBe("Hmm.")
  })

  it("renders a final-only block correctly", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "nanogpt",
      kind: "reasoning-output",
      phase: "final",
      id: "b1",
      text: "Chose approach B.",
    })
    const [part] = acc.toParts()
    expect(part.input.text).toBe("Chose approach B.")
    expect(part.state).toBe("output-available")
  })

  it("does not duplicate text when deltas are followed by a final block", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "claude-code",
      kind: "reasoning-output",
      phase: "delta",
      id: "b1",
      text: "Streamed thought.",
    })
    acc.apply({
      provider: "claude-code",
      kind: "reasoning-output",
      phase: "final",
      id: "b1",
      text: "Streamed thought.",
    })
    const [part] = acc.toParts()
    expect(part.input.text).toBe("Streamed thought.")
  })

  it("adopts a cumulative final extension without duplicating the streamed prefix", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "openrouter",
      kind: "reasoning-output",
      phase: "delta",
      id: "b1",
      text: "Checked files.",
    })
    acc.apply({
      provider: "openrouter",
      kind: "reasoning-output",
      phase: "final",
      id: "b1",
      text: "Checked files. Ran tests.",
    })
    expect(acc.toParts()[0].input.text).toBe("Checked files. Ran tests.")
  })

  it("preserves an independent later reasoning part", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "codex",
      kind: "thought",
      phase: "final",
      id: "part-1",
      text: "First part.",
    })
    acc.apply({
      provider: "codex",
      kind: "thought",
      phase: "final",
      id: "part-2",
      text: "First part.",
    })
    expect(acc.toParts().map((part) => part.input.text)).toEqual(["First part.", "First part."])
  })

  it("keeps separate blocks ordered by first appearance", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({ provider: "codex", kind: "thought", phase: "delta", id: "b2", text: "second" })
    acc.apply({ provider: "codex", kind: "thought", phase: "delta", id: "b1", text: "first" })
    acc.apply({ provider: "codex", kind: "thought", phase: "delta", id: "b2", text: " again" })
    const parts = acc.toParts()
    expect(parts.map((p) => p.input.text)).toEqual(["second again", "first"])
  })

  it("renders reasoning tokens as metadata, never as thought text", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "codex",
      kind: "reasoning-tokens",
      phase: "final",
      id: "b1",
      tokens: 128,
    })
    expect(acc.toParts()).toEqual([
      expect.objectContaining({
        label: "Reasoning tokens",
        input: { text: "" },
        tokens: 128,
      }),
    ])
  })

  it("keeps opaque payloads out of the reasoning-output renderer", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "openrouter",
      kind: "opaque",
      phase: "final",
      id: "b1",
      opaque: "encrypted",
    })
    expect(acc.toParts()).toEqual([])
  })

  it("keeps a reasoning summary separate from streamed visible reasoning", () => {
    const acc = new ReasoningOutputAccumulator()
    acc.apply({
      provider: "openrouter",
      kind: "reasoning-output",
      phase: "delta",
      id: "reasoning",
      text: "Checked files.",
    })
    acc.apply({
      provider: "openrouter",
      kind: "reasoning-summary",
      phase: "final",
      id: "reasoning:summary:0",
      text: "Checked files and tests.",
    })
    expect(acc.toParts().map((part) => [part.label, part.input.text])).toEqual([
      ["Reasoning output", "Checked files."],
      ["Reasoning summary", "Checked files and tests."],
    ])
  })
})

describe("persistence + display classification (Track T1)", () => {
  it("routes visible text to the message", () => {
    const event: ReasoningOutputEvent = {
      provider: "claude-code",
      kind: "reasoning-output",
      phase: "final",
      id: "x",
      text: "hi",
    }
    expect(classifyReasoningOutputPersistence(event)).toBe("message")
    expect(isDisplayableReasoningOutput(event)).toBe(true)
    expect(reasoningOutputLabel(event)).toBe("Reasoning output")
  })

  it("routes opaque payloads to opaque metadata and never displays them", () => {
    const event: ReasoningOutputEvent = {
      provider: "codex",
      kind: "opaque",
      phase: "final",
      id: "x",
      opaque: "blob",
    }
    expect(classifyReasoningOutputPersistence(event)).toBe("opaque-metadata")
    expect(isDisplayableReasoningOutput(event)).toBe(false)
    expect(reasoningOutputLabel(event)).toBeNull()
  })

  it("routes token counts to usage metadata", () => {
    const event: ReasoningOutputEvent = {
      provider: "openrouter",
      kind: "reasoning-tokens",
      phase: "final",
      id: "x",
      tokens: 64,
    }
    expect(classifyReasoningOutputPersistence(event)).toBe("usage-metadata")
    expect(isDisplayableReasoningOutput(event)).toBe(false)
    expect(reasoningOutputLabel(event)).toBe("Reasoning tokens")
  })

  it("classifies every visible, private, absent, and unsupported state honestly", () => {
    expect(
      classifyReasoningVisibility({
        provider: "cursor",
        kind: "reasoning-output",
        phase: "delta",
        id: "visible",
        text: "Inspecting files.",
      }),
    ).toBe("visible-text")
    expect(
      classifyReasoningVisibility({
        provider: "codex",
        kind: "reasoning-summary",
        phase: "final",
        id: "summary",
        text: "Inspected files.",
      }),
    ).toBe("visible-summary")
    expect(
      classifyReasoningVisibility({
        provider: "openrouter",
        kind: "reasoning-tokens",
        phase: "final",
        id: "tokens",
        tokens: 12,
      }),
    ).toBe("token-only")
    expect(
      classifyReasoningVisibility({
        provider: "openrouter",
        kind: "opaque",
        phase: "final",
        id: "private",
        opaque: "encrypted",
      }),
    ).toBe("opaque-private")
    expect(classifyReasoningVisibility()).toBe("absent")
    expect(classifyReasoningVisibility(undefined, false)).toBe("unsupported")
  })
})

describe("provider-aware reasoning controls", () => {
  it("passes supported native controls exactly", () => {
    expect(
      resolveReasoningControls(
        { toggle: true, efforts: ["low", "medium", "high"] },
        { enabled: true, effort: "medium" },
      ),
    ).toEqual({
      requested: { enabled: true, effort: "medium" },
      sent: { enabled: true, effort: "medium" },
      exact: true,
      limitations: [],
    })
  })

  it("omits unsupported fields and records the limitation", () => {
    const result = resolveReasoningControls({ toggle: false }, { enabled: true, effort: "xhigh" })
    expect(result.sent).toEqual({})
    expect(result.exact).toBe(false)
    expect(result.limitations).toEqual([
      "Reasoning on is not a verified native control and was omitted.",
      "Reasoning effort xhigh is unsupported and was omitted.",
    ])
  })

  it("maps unsupported depth to the closest declared effort", () => {
    const result = resolveReasoningControls(
      { toggle: true, efforts: ["low", "high"] },
      { enabled: true, effort: "xhigh" },
    )
    expect(result.sent).toEqual({ enabled: true, effort: "high" })
    expect(result.limitations).toEqual(["Reasoning effort xhigh mapped to high."])
  })
})

describe("normalizeReasoningOutput is defensive", () => {
  it("returns [] for junk input", () => {
    for (const provider of REASONING_OUTPUT_PROVIDERS) {
      expect(normalizeReasoningOutput(provider, null)).toEqual([])
      expect(normalizeReasoningOutput(provider, undefined)).toEqual([])
      expect(normalizeReasoningOutput(provider, 42)).toEqual([])
      expect(normalizeReasoningOutput(provider, {})).toEqual([])
    }
  })
})
