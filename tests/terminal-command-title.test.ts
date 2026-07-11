import { describe, expect, it } from "vitest"
import { sanitizeForTitle } from "../src/renderer/features/terminal/commandBuffer"

describe("terminal command titles", () => {
  it("redacts assignments, flags, authorization headers, and common token forms", () => {
    expect(sanitizeForTitle("OPENAI_API_KEY=super-secret npm test")).toBe(
      "OPENAI_API_KEY=[redacted] npm test",
    )
    expect(sanitizeForTitle("tool --password hunter2")).toBe("tool --password [redacted]")
    expect(sanitizeForTitle("curl -H 'Authorization: Bearer abcdefghijk'")).not.toContain(
      "abcdefghijk",
    )
    expect(sanitizeForTitle("echo sk-abcdefghijklmnop")).toBe("echo [redacted]")
  })

  it("still removes control sequences and bounds ordinary titles", () => {
    expect(sanitizeForTitle("\u001b[31mnpm test\u001b[0m")).toBe("npm test")
    expect(sanitizeForTitle("x".repeat(100))).toHaveLength(50)
  })
})
