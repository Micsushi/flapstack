import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }))

import { escapeOAuthHtml, generateOAuthPage } from "../src/main/lib/oauth"

describe("OAuth callback rendering", () => {
  it("escapes provider-controlled error text before returning callback HTML", () => {
    const attack = `</span><script>globalThis.pwned = "yes"</script><span data-x='&'>`
    const page = generateOAuthPage({
      title: attack,
      message: "ignored",
      isSuccess: false,
      errorDetail: attack,
    })

    expect(page).not.toContain(attack)
    expect(page).not.toContain("<script>globalThis.pwned")
    expect(page).toContain(escapeOAuthHtml(attack))
  })
})
