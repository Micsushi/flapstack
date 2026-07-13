import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  discardRetainedLegacyCredential,
  CREDENTIAL_MIGRATION_STATUS_KEY,
  migrateLegacyCredentials,
  readCredentialMigrationStatus,
  readLegacyCredentialCandidates,
  recordCredentialMigrationStatus,
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
    expect(report.retired).toEqual([])
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

  it.each([
    ["onboarding:codex-api-key", "sk-codex-stale"],
    ["agents:openai-api-key", "sk-openai-stale"],
    [
      "agents:claude-custom-config",
      JSON.stringify({ token: "sk-ant-stale", model: "claude-sonnet-5" }),
    ],
  ] as const)("retires a stale %s source instead of retrying it", async (key, value) => {
    storage.setItem(key, key === "agents:claude-custom-config" ? value : JSON.stringify(value))
    const mutate = vi.fn().mockResolvedValue({
      acknowledged: false,
      fingerprint: "111111111111",
      retireSource: true,
      warning: "newer replacement wins",
    })

    const report = await migrateLegacyCredentials(storage, {
      credentials: { migrateLegacy: { mutate } },
    })

    expect(storage.getItem(key)).toBeNull()
    expect(report).toEqual({ migrated: [], retired: [key], retained: [] })
  })

  it("records only a non-secret migration acknowledgement for Settings", () => {
    const status = recordCredentialMigrationStatus(
      storage,
      {
        migrated: ["agents:openai-api-key"],
        retired: [],
        retained: [{ key: "onboarding:codex-api-key", reason: "Secure storage unavailable" }],
      },
      () => 1234,
    )

    expect(status.checkedAt).toBe(1234)
    expect(readCredentialMigrationStatus(storage)).toEqual(status)
    expect(storage.getItem(CREDENTIAL_MIGRATION_STATUS_KEY)).not.toContain("sk-")
  })

  it("discards only an explicitly retained legacy credential", () => {
    storage.setItem("agents:openai-api-key", JSON.stringify("sk-disposable"))
    recordCredentialMigrationStatus(
      storage,
      {
        migrated: [],
        retired: [],
        retained: [{ key: "agents:openai-api-key", reason: "Keychain unavailable" }],
      },
      () => 10,
    )

    const next = discardRetainedLegacyCredential(
      storage,
      storage,
      "agents:openai-api-key",
      () => 11,
    )

    expect(storage.getItem("agents:openai-api-key")).toBeNull()
    expect(next).toEqual({ migrated: [], retired: [], retained: [], checkedAt: 11 })
  })

  it("refuses to discard an unknown or unretained storage key", () => {
    storage.setItem("unrelated-secret", "keep-me")
    recordCredentialMigrationStatus(
      storage,
      { migrated: [], retired: [], retained: [{ key: "unrelated-secret", reason: "unrelated" }] },
      () => 10,
    )

    expect(discardRetainedLegacyCredential(storage, storage, "unrelated-secret")).toBeNull()
    expect(storage.getItem("unrelated-secret")).toBe("keep-me")
  })

  it("does not expose exception text in a retained migration reason", async () => {
    storage.setItem("agents:openai-api-key", JSON.stringify("sk-disposable"))
    const mutate = vi.fn().mockRejectedValue(new Error("backend echoed sk-disposable"))

    const report = await migrateLegacyCredentials(storage, {
      credentials: { migrateLegacy: { mutate } },
    })

    expect(report.retained).toEqual([
      {
        key: "agents:openai-api-key",
        reason: "Credential migration failed. The legacy value was retained for retry.",
      },
    ])
    expect(JSON.stringify(report)).not.toContain("sk-disposable")
  })
})
