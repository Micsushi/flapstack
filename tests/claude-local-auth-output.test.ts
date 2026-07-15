import { describe, expect, it } from "vitest"
import { parseClaudeAuthOutput } from "../src/main/lib/claude/local-auth-output"

describe("Claude local auth output", () => {
  it("extracts the browser URL and code prompt from Claude CLI output", () => {
    const result = parseClaudeAuthOutput(
      "Opening browser to sign in… https://claude.ai/cai/oauth/authorize?code=true&state=test\nPaste code here if prompted >",
    )

    expect(result.oauthUrl).toBe("https://claude.ai/cai/oauth/authorize?code=true&state=test")
    expect(result.waitingForCode).toBe(true)
  })

  it("ignores unrelated URLs and recognizes verification", () => {
    const result = parseClaudeAuthOutput(
      "See https://example.com/help while verifying your Claude connection",
    )

    expect(result.oauthUrl).toBeNull()
    expect(result.verifying).toBe(true)
  })

  it("extracts a URL embedded in a terminal hyperlink", () => {
    const result = parseClaudeAuthOutput(
      "\u001b]8;;https://claude.ai/cai/oauth/authorize?state=linked\u0007Open Claude\u001b]8;;\u0007",
    )

    expect(result.oauthUrl).toBe("https://claude.ai/cai/oauth/authorize?state=linked")
  })
})
