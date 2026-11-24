import { describe, expect, it } from "vitest"
import { resolveNewCodexModel } from "../src/renderer/features/agents/lib/models"
import {
  CLAUDE_MODEL_ID_MAP,
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_CLAUDE_MODEL_ID,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DEFAULT_OPENCODE_MODELS,
  formatCodexModelForAcp,
  formatModelDisplayName,
  normalizeOpencodeModelId,
  resolveCodexAcpModel,
} from "../src/shared/model-catalog"

it("uses the selected ACP model's own effort levels when opening older chats", () => {
  const offered = ["older[minimal]", "older[xhigh]", "new[max]", "new[ultra]"]
  expect(resolveCodexAcpModel("older[none]", offered)).toBe("older[minimal]")
  expect(resolveCodexAcpModel("older[max]", offered)).toBe("older[xhigh]")
  expect(resolveCodexAcpModel("older[ultra]", offered)).toBe("older[xhigh]")
  expect(resolveCodexAcpModel("new[max]", offered)).toBe("new[max]")
  expect(resolveCodexAcpModel("new[ultra]", offered)).toBe("new[ultra]")
  expect(resolveCodexAcpModel("older[none]", [])).toBe("older[low]")
  expect(resolveCodexAcpModel("older[ultra]", [])).toBe("older[xhigh]")
  expect(() => resolveCodexAcpModel("older[high]", offered)).toThrow("does not offer high")
})

it("uses the live Codex default for a fresh composer and preserves an explicit model choice", () => {
  const fallback = { id: "previous", name: "Previous", reasoningLevels: [] }
  const current = { id: "current", name: "Current", isDefault: true, reasoningLevels: [] }
  expect(resolveNewCodexModel(undefined, undefined, fallback.id)).toBeUndefined()
  expect(resolveNewCodexModel([fallback, current], undefined, fallback.id)).toBe(current.id)
  expect(resolveNewCodexModel([fallback], undefined, fallback.id)).toBe(fallback.id)
  expect(resolveNewCodexModel([], undefined, fallback.id)).toBeUndefined()
  expect(resolveNewCodexModel([current], fallback.id, fallback.id)).toBe(fallback.id)
})

describe("Claude model catalog", () => {
  it("exposes concrete Claude models newest-release first across families", () => {
    expect(CLAUDE_MODELS.map((model) => model.id)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-haiku-4-5",
    ])
    for (const model of CLAUDE_MODELS) {
      expect(model.version).not.toBe("auto")
      expect(model.contextWindow).toBe(200_000)
    }
  })

  it("passes explicit Claude model ids through to the SDK", () => {
    for (const id of ["claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      expect(CLAUDE_MODEL_ID_MAP[id]).toBe(id)
      expect(CLAUDE_MODELS.find((model) => model.id === id)?.efforts).toContain("max")
    }
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-5-5"]).toBe("claude-opus-5-5")
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-5"]).toBe("claude-opus-5")
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-4-8"]).toBe("claude-opus-4-8")
    expect(CLAUDE_MODEL_ID_MAP["claude-sonnet-5"]).toBe("claude-sonnet-5")
  })

  it("keeps legacy alias ids resolvable for previously stored selections", () => {
    expect(CLAUDE_MODEL_ID_MAP["opus"]).toBe("opus")
    expect(CLAUDE_MODEL_ID_MAP["sonnet"]).toBe("sonnet")
    expect(CLAUDE_MODEL_ID_MAP["claude-haiku-4-5"]).toBe("claude-haiku-4-5-20251001")
  })

  it("keeps Claude effort options model-aware", () => {
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-5-5")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-5")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-4-8")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-sonnet-5")?.efforts).toContain(
      "xhigh",
    )
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-haiku-4-5")?.efforts).toBeUndefined()
  })

  it("uses current defaults without removing explicitly stored older models", () => {
    expect(DEFAULT_CLAUDE_MODEL_ID).toBe("claude-opus-5-5")
    expect(DEFAULT_CODEX_MODEL_ID).toBe("gpt-5.6-sol")
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-5"]).toBe("claude-opus-5")
    expect(CLAUDE_MODEL_ID_MAP["claude-opus-4-8"]).toBe("claude-opus-4-8")
    expect(CODEX_MODELS.map((model) => model.id)).not.toContain("gpt-5.5")
  })

  it("exposes Codex models newest-release first, not by capability or model number", () => {
    expect(CODEX_MODELS.map((model) => model.id)).toEqual([
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.3-codex-spark",
    ])
    for (const model of CODEX_MODELS) {
      expect(model.contextWindow).toBe(258_400)
    }
  })

  it("marks Codex fast mode only on supported full models", () => {
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
    expect(CODEX_MODELS.find((model) => model.id === "gpt-6-astra")?.reasoningLevels).toContain(
      "ultra",
    )
    expect(CODEX_MODELS.find((model) => model.id === "gpt-6.1-sol")?.reasoningLevels).toContain(
      "ultra",
    )
    expect(CODEX_MODELS.find((model) => model.id === "gpt-6-luna")?.reasoningLevels).not.toContain(
      "ultra",
    )
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
    expect(formatModelDisplayName("gpt-6-astra/ultra")).toBe("GPT-6 Astra")
    expect(formatModelDisplayName("gpt-6.1-sol[max]")).toBe("GPT-6.1 Sol")
    expect(formatModelDisplayName("claude-fable-5-1")).toBe("Fable 5.1")
    expect(formatModelDisplayName("claude-sonnet-5-5")).toBe("Sonnet 5.5")
    expect(formatModelDisplayName("claude-haiku-5-5")).toBe("Haiku 5.5")
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
