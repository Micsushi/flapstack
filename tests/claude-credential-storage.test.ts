import { describe, expect, it } from "vitest"
import { decodePlaintextClaudeToken } from "../src/main/lib/claude-credential-storage"

describe("decodePlaintextClaudeToken", () => {
  it("decodes a plaintext token stored as base64", () => {
    expect(decodePlaintextClaudeToken(Buffer.from("sk-ant-oat01-example").toString("base64"))).toBe(
      "sk-ant-oat01-example",
    )
  })

  it("rejects Chromium encrypted blobs when secure storage is unavailable", () => {
    const encrypted = Buffer.concat([Buffer.from("v10"), Buffer.from([0, 4, 24, 31])])
    expect(() => decodePlaintextClaudeToken(encrypted.toString("base64"))).toThrow(
      "encrypted but secure storage is unavailable",
    )
  })

  it("rejects other binary credential data", () => {
    expect(() => decodePlaintextClaudeToken(Buffer.from([65, 0, 66]).toString("base64"))).toThrow(
      "invalid control characters",
    )
  })
})
