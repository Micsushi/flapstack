import { describe, expect, it } from "vitest"

import { isInternalDetachedChatCheckoutPath } from "../src/shared/checkout-path"

describe("checkout path display", () => {
  it("identifies internal detached fallback paths on macOS and Windows", () => {
    expect(
      isInternalDetachedChatCheckoutPath(
        "/Users/test/.flapstack/detached-chat-checkouts/mrmnzrag07mke480",
      ),
    ).toBe(true)
    expect(
      isInternalDetachedChatCheckoutPath(
        String.raw`C:\Users\test\.flapstack\detached-chat-checkouts\mrmnzrag07mke480`,
      ),
    ).toBe(true)
  })

  it("keeps real custom worktrees visible", () => {
    expect(isInternalDetachedChatCheckoutPath("/repos/flapstack-feature-auth")).toBe(false)
    expect(isInternalDetachedChatCheckoutPath("/repos/detached-chat-checkouts-demo")).toBe(false)
    expect(isInternalDetachedChatCheckoutPath(null)).toBe(false)
  })
})
