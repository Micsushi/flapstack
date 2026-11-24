import { describe, expect, it } from "vitest"
import {
  PORTABLE_SECRET_PLACEHOLDER,
  redactText,
  sanitizeStructuredValue,
} from "../src/main/lib/portability/secrets"

describe("portability-secrets", () => {
  it("redacts structured credentials without reporting values", () => {
    const secret = "sk-live-supersecretvalue12345"
    const result = sanitizeStructuredValue(
      {
        provider: "openai",
        apiKey: secret,
        nested: { webhookUrl: "https://discord.com/api/webhooks/123/secret-value" },
      },
      { scopeId: "settings", path: "scopes/settings/config.json" },
    )
    expect(result.value).toEqual({
      provider: "openai",
      apiKey: PORTABLE_SECRET_PLACEHOLDER,
      nested: { webhookUrl: PORTABLE_SECRET_PLACEHOLDER },
    })
    expect(JSON.stringify(result.exclusions)).not.toContain(secret)
    expect(result.exclusions.map((entry) => entry.category)).toEqual(["token", "webhook"])
  })

  it("redacts every secret from the same portable document", () => {
    const secrets = [
      "OPENAI_API_KEY=sk-live-secretsecretsecret",
      "https://hooks.slack.com/services/T000/B000/secret",
      "Bearer abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      "AKIAIOSFODNN7EXAMPLE",
      `AIza${"A".repeat(35)}`,
    ]
    const result = redactText(["Keep this title", ...secrets].join("\n"), {
      scopeId: "project-vaults",
      path: "scopes/project-vaults/file.md",
    })
    expect(result.secretFound).toBe(true)
    expect(result.value).toContain("Keep this title")
    expect(result.value.split(PORTABLE_SECRET_PLACEHOLDER)).toHaveLength(secrets.length + 1)
    expect(new Set(result.exclusions.map((entry) => entry.category))).toEqual(
      new Set(["token", "webhook", "private-key", "credential"]),
    )
    for (const secret of secrets) {
      expect(result.value).not.toContain(secret)
      expect(JSON.stringify(result.exclusions)).not.toContain(secret)
    }
  })
})
