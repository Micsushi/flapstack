import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  migrateLegacyCredentials,
  readLegacyCredentialCandidates,
} from "../src/renderer/lib/credential-migration"

describe("legacy renderer credential migration", () => {
  let storage: Storage

  beforeEach(() => {
    const values = new Map<string, string>()
    storage = {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => void values.delete(key),
      setItem: (key, value) => void values.set(key, value),
    }
  })

  it("inventories the exact legacy keys without exposing unrelated provider secrets", () => {
    storage.setItem("onboarding:codex-api-key", JSON.stringify("sk-codex-legacy"))
    storage.setItem("agents:openai-api-key", JSON.stringify("sk-openai-legacy"))
    storage.setItem(
      "agents:claude-custom-config",
      JSON.stringify({
        model: "claude-sonnet-5",
        token: "sk-ant-legacy",
        baseUrl: "https://api.anthropic.com",
      }),
    )
    storage.setItem("usage:openrouter-api-key", JSON.stringify("not-owned"))

    expect(readLegacyCredentialCandidates(storage).map((item) => item.legacyKey)).toEqual([
      "onboarding:codex-api-key",
      "agents:openai-api-key",
      "agents:claude-custom-config",
    ])
  })

  it("clears only an acknowledged matching migration", async () => {
    storage.setItem("onboarding:codex-api-key", JSON.stringify("sk-codex-legacy"))
    storage.setItem("agents:openai-api-key", JSON.stringify("sk-openai-legacy"))
    const mutate = vi
      .fn()
      .mockImplementationOnce(async (input) => ({
        acknowledged: true,
        fingerprint: input.expectedFingerprint,
      }))
      .mockResolvedValueOnce({
        acknowledged: false,
        fingerprint: "000000000000",
        warning: "Keychain denied; source retained",
      })

    const report = await migrateLegacyCredentials(storage, {
      credentials: { migrateLegacy: { mutate } },
    })

    expect(storage.getItem("onboarding:codex-api-key")).toBeNull()
    expect(storage.getItem("agents:openai-api-key")).not.toBeNull()
    expect(report.migrated).toEqual(["onboarding:codex-api-key"])
    expect(report.retained).toEqual([
      {
        key: "agents:openai-api-key",
        reason: "Keychain denied; source retained",
      },
    ])
  })

  it("is idempotent after acknowledged keys are removed", async () => {
    const mutate = vi.fn()
    await migrateLegacyCredentials(storage, {
      credentials: { migrateLegacy: { mutate } },
    })
    expect(mutate).not.toHaveBeenCalled()
  })
})
