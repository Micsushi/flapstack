import { describe, expect, it } from "vitest"
import {
  PORTABLE_SECRET_PLACEHOLDER,
  redactText,
  sanitizeStructuredValue,
  secretCandidateHash,
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

  it("redacts structured AWS credential aliases", () => {
    const result = sanitizeStructuredValue(
      {
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      { scopeId: "settings", path: "scopes/settings/aws.json" },
    )
    expect(result.secretFound).toBe(true)
    expect(result.value).toEqual({
      AWS_ACCESS_KEY_ID: PORTABLE_SECRET_PLACEHOLDER,
      AWS_SECRET_ACCESS_KEY: PORTABLE_SECRET_PLACEHOLDER,
    })
  })

  it.each([
    ["plain", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
    ["export quoted", 'export AWS_SECRET_ACCESS_KEY="plain-value-without-provider-prefix"'],
    ["quoted key JSON", '{"AWS_SECRET_ACCESS_KEY":"plain-json-secret-value"}'],
    ["access id assignment", "AWS_ACCESS_KEY_ID='AKIAIOSFODNN7EXAMPLE'"],
  ])("redacts %s AWS text assignments", (_label, value) => {
    const result = redactText(value, { scopeId: "settings", path: "aws.env" })
    expect(result.secretFound).toBe(true)
    expect(result.value).toContain(PORTABLE_SECRET_PLACEHOLDER)
    expect(result.value).not.toContain("wJalrXUtnFEMI")
    expect(result.value).not.toContain("plain-value")
    expect(result.value).not.toContain("plain-json")
  })

  it.each([
    ["provider key", "OPENAI_API_KEY=sk-live-secretsecretsecret", "token"],
    ["webhook", "https://hooks.slack.com/services/T000/B000/secret", "webhook"],
    ["session", "Bearer abcdefghijklmnopqrstuvwxyz123456", "token"],
    ["pem", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", "private-key"],
    ["bare AWS key", "AKIAIOSFODNN7EXAMPLE", "credential"],
    ["bare Google key", `AIza${"A".repeat(35)}`, "credential"],
  ])("redacts %s text", (_label, value, category) => {
    const result = redactText(value, {
      scopeId: "project-vaults",
      path: "scopes/project-vaults/file.md",
    })
    expect(result.secretFound).toBe(true)
    expect(result.value).toContain(PORTABLE_SECRET_PLACEHOLDER)
    expect(result.exclusions[0]?.category).toBe(category)
    expect(JSON.stringify(result.exclusions)).not.toContain(value)
  })

  it("allows a hash-only false-positive override without disclosing the candidate", () => {
    const candidate = "Bearer abcdefghijklmnopqrstuvwxyz123456"
    const result = redactText(candidate, {
      scopeId: "settings",
      path: "scopes/settings/example.txt",
      approvedFalsePositiveHashes: new Set([secretCandidateHash(candidate)]),
    })
    expect(result).toEqual({ value: candidate, exclusions: [], secretFound: false })
  })
})
