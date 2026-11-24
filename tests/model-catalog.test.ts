import { describe, expect, it } from "vitest"
import { resolveNewCodexModel } from "../src/renderer/features/agents/lib/models"
import { CLAUDE_MODELS, resolveCodexAcpModel } from "../src/shared/model-catalog"

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
  it("keeps Claude effort options model-aware", () => {
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-5-5")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-5")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-opus-4-8")?.efforts).toContain("max")
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-sonnet-5")?.efforts).toContain(
      "xhigh",
    )
    expect(CLAUDE_MODELS.find((model) => model.id === "claude-haiku-4-5")?.efforts).toBeUndefined()
  })
})
