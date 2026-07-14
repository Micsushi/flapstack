import { describe, expect, it } from "vitest"
import {
  CLAUDE_MODEL_ID_MAP,
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_CURSOR_MODEL_ID,
  DEFAULT_OPENCODE_MODELS,
  formatCodexModelForAcp,
  formatModelDisplayName,
  normalizeOpencodeModelId,
} from "../src/shared/model-catalog"

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
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ])
  })

  it("marks Codex fast mode only on supported full models", () => {
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.5")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-sol")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-terra")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-luna")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.4")?.supportsFastMode).toBe(true)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.4-mini")?.supportsFastMode).toBe(false)
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.3-codex-spark")?.supportsFastMode).toBe(
      false,
    )
  })

  it("tracks Codex reasoning levels per model", () => {
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-sol")?.reasoningLevels).toContain(
      "ultra",
    )
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-terra")?.reasoningLevels).toContain(
      "ultra",
    )
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.6-luna")?.reasoningLevels).toContain(
      "max",
    )
    expect(
      CODEX_MODELS.find((model) => model.id === "gpt-5.6-luna")?.reasoningLevels,
    ).not.toContain("ultra")
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.5")?.reasoningLevels).not.toContain(
      "none",
    )
    expect(CODEX_MODELS.find((model) => model.id === "gpt-5.5")?.reasoningLevels).not.toContain(
      "max",
    )
  })

  it("formats stored Codex model ids for ACP", () => {
    for (const model of CODEX_MODELS) {
      for (const reasoning of model.reasoningLevels) {
        expect(formatCodexModelForAcp(`${model.id}/${reasoning}`)).toBe(`${model.id}[${reasoning}]`)
      }
    }

    expect(formatCodexModelForAcp("gpt-5.5/high")).toBe("gpt-5.5[high]")
    expect(formatCodexModelForAcp("gpt-5.6-sol/ultra")).toBe("gpt-5.6-sol[ultra]")
    expect(formatCodexModelForAcp("gpt-5.6-terra/max")).toBe("gpt-5.6-terra[max]")
    expect(formatCodexModelForAcp("gpt-5.5[high]")).toBe("gpt-5.5[high]")
  })

  it("displays Codex model ids from stored and provider formats", () => {
    expect(formatModelDisplayName("gpt-5.6-sol/ultra")).toBe("GPT-5.6 Sol")
    expect(formatModelDisplayName("gpt-5.6-terra[max]")).toBe("GPT-5.6 Terra")
  })

  it("preserves the 1M context marker while stripping effort brackets", () => {
    expect(formatModelDisplayName("opus[1m]")).toBe("Opus 1M")
    expect(formatModelDisplayName("sonnet[1m]")).toBe("Sonnet 1M")
    expect(formatModelDisplayName("opus[1m]/high")).toBe("Opus 1M")
    expect(formatModelDisplayName("claude-opus-4-8[1m]")).toBe("Opus 4.8 1M")
    // Plain effort brackets are still stripped.
    expect(formatModelDisplayName("opus[high]")).toBe("Opus")
  })
})

describe("Cursor model catalog", () => {
  it("keeps the normal picker small and defaults to Composer", () => {
    expect(CURSOR_MODELS.map((model) => model.id)).toEqual(["auto", "composer-2.5"])
    expect(DEFAULT_CURSOR_MODEL_ID).toBe("auto")
  })
})

describe("OpenCode provider defaults", () => {
  it("formats provider model paths as exact friendly model names", () => {
    expect(formatModelDisplayName("openrouter/deepseek/deepseek-v4-pro")).toBe("DeepSeek V4 Pro")
    expect(formatModelDisplayName("nanogpt/vendor/custom-model-v3")).toBe("Custom Model V3")
  })

  it("exposes only DeepSeek and GLM by default for each provider", () => {
    expect(DEFAULT_OPENCODE_MODELS.openrouter).toHaveLength(2)
    expect(DEFAULT_OPENCODE_MODELS.nanogpt).toHaveLength(2)
    for (const models of Object.values(DEFAULT_OPENCODE_MODELS)) {
      expect(models.some((model) => model.id.toLowerCase().includes("deepseek"))).toBe(true)
      expect(models.some((model) => model.id.toLowerCase().includes("glm"))).toBe(true)
    }
  })

  it("migrates stale provider defaults to chat-capable DeepSeek models", () => {
    expect(normalizeOpencodeModelId("nanogpt", "nanogpt/deepseek-v3")).toBe(
      "nanogpt/deepseek/deepseek-latest",
    )
    expect(normalizeOpencodeModelId("openrouter", "openrouter/google/gemini-3-pro")).toBe(
      "openrouter/deepseek/deepseek-v4-pro",
    )
    expect(normalizeOpencodeModelId("nanogpt", "nanogpt/zai-org/glm-latest")).toBe(
      "nanogpt/zai-org/glm-latest",
    )
    expect(normalizeOpencodeModelId("openrouter", "openai/gpt-oss-20b:free")).toBe(
      "openrouter/openai/gpt-oss-20b:free",
    )
    expect(normalizeOpencodeModelId("nanogpt", "zai-org/glm-4.7-flash")).toBe(
      "nanogpt/zai-org/glm-4.7-flash",
    )
    expect(() => normalizeOpencodeModelId("openrouter", "nanogpt/zai-org/glm-latest")).toThrow(
      "does not belong to the openrouter provider",
    )
    expect(() => normalizeOpencodeModelId("nanogpt", "   ")).toThrow(
      "Model cannot be empty for the nanogpt provider",
    )
  })
})
