import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("failed message retry", () => {
  it("retries the existing user turn without appending a duplicate message", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(activeChat).toContain('aria-label="Retry failed message"')
    const retry = activeChat.indexOf('aria-label="Retry failed message"')
    expect(activeChat.slice(retry - 600, retry + 600)).toContain("regenerate()")
  })
})
