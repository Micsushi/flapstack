import { describe, expect, it } from "vitest"
import { CLAUDE_MODEL_ID_MAP, CLAUDE_MODELS, CODEX_MODELS } from "../src/shared/model-catalog"

describe("Claude model catalog", () => {
  it("exposes only concrete model versions in the picker", () => {
    expect(CLAUDE_MODELS.map((model) => model.id)).toEqual([
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ])
    for (const model of CLAUDE_MODELS) {
      expect(model.version).not.toBe("auto")
    }
  })

  it("passes explicit Claude model ids through to the SDK", () => {
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-4-8"]).toBe("claude-opus-4-8")
    expect(CLAUDE_MODEL_ID_MAP["claude-sonnet-5"]).toBe("claude-sonnet-5")
  })

  it("keeps legacy alias ids resolvable for previously stored selections", () => {
    expect(CLAUDE_MODEL_ID_MAP["opus"]).toBe("opus")
    expect(CLAUDE_MODEL_ID_MAP["sonnet"]).toBe("sonnet")
    expect(CLAUDE_MODEL_ID_MAP["claude-haiku-4-5"]).toBe("claude-haiku-4-5-20251001")
  })

  it("keeps Claude effort options model-aware", () => {
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-4-8")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-sonnet-5")?.efforts).toContain(
      "xhigh",
    )
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-haiku-4-5")?.efforts).toBeUndefined()
  })

  it("exposes only current Codex model choices", () => {
    expect(CODEX_MODELS.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ])
  })

  it("marks Codex fast mode only on supported full models", () => {
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.5")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.4")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.4-mini")?.supportsFastMode).toBe(false)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.3-codex-spark")?.supportsFastMode).toBe(
      false,
    )
  })
})
