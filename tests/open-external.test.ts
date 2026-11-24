import { describe, expect, it } from "vitest"
import { isSafeExternalUrl } from "../src/main/lib/open-external"

describe("external navigation safety", () => {
  it("allows only explicit external protocols", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true)
    expect(isSafeExternalUrl("mailto:test@example.com")).toBe(true)
    expect(isSafeExternalUrl("file:///C:/Windows/System32/cmd.exe")).toBe(false)
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false)
  })
})
