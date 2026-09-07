import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { classifyProviderLimitError } from "../src/shared/provider-limit-error"

describe("provider limit classification", () => {
  it.each([
    ["Failed to generate a response", null],
    ["Could not enumerate workspace", null],
    ["Connection to port 429 closed", null],
    ["Request 1429 failed", null],
    ["HTTP 529 overloaded_error", null],
    ["HTTP 429", "rate"],
    ["API Error: 429", "rate"],
    ["429 Too Many Requests", "rate"],
    ["RATE_LIMIT_ERROR", "rate"],
    ["rate limit exceeded", "rate"],
    ["Provider is temporarily rate-limited", "rate"],
    ["usage_limit_reached", "quota"],
    ["429 insufficient_quota", "quota"],
    ["Out of credits", "quota"],
    ["Quota exceeded", "quota"],
  ] as const)("classifies %s without incidental substring matches", (message, expected) => {
    expect(classifyProviderLimitError(message)).toBe(expected)
  })

  it("recognizes structured codes with opaque messages", () => {
    expect(classifyProviderLimitError("Request rejected", "rate_limit_exceeded")).toBe("rate")
    expect(classifyProviderLimitError("Request rejected", "rate_limit_error")).toBe("rate")
    expect(classifyProviderLimitError("Request rejected", "usage_limit_reached")).toBe("quota")
    expect(classifyProviderLimitError("Request rejected", {})).toBeNull()
  })

  it("routes both Claude error paths through the shared classifier", () => {
    const source = readFileSync("src/main/lib/trpc/routers/claude.ts", "utf8")
    expect(source).toContain("classifyProviderLimitError(String(sdkError), rawErrorCode)")
    expect(source).toContain('classifyProviderLimitError(err.message ?? "")')
    expect(source).not.toContain('sdkError.includes("rate")')
  })
})
