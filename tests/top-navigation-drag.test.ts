import { describe, expect, it } from "vitest"
import {
  resolveTopNavigationDropIntent,
  resolveTopNavigationReorderIntent,
} from "../src/renderer/features/agents/lib/top-navigation-drag"

describe("top navigation drag zones", () => {
  it("uses the middle half to enter an item and the outside quarters to reorder", () => {
    expect(resolveTopNavigationDropIntent(100, 0, 400)).toBe("before")
    expect(resolveTopNavigationDropIntent(101, 0, 400)).toBe("inside")
    expect(resolveTopNavigationDropIntent(299, 0, 400)).toBe("inside")
    expect(resolveTopNavigationDropIntent(300, 0, 400)).toBe("after")
  })

  it("uses only left and right insertion zones when a grouped Chat enters the main bar", () => {
    expect(resolveTopNavigationReorderIntent(0, 0, 400)).toBe("before")
    expect(resolveTopNavigationReorderIntent(199, 0, 400)).toBe("before")
    expect(resolveTopNavigationReorderIntent(200, 0, 400)).toBe("after")
    expect(resolveTopNavigationReorderIntent(400, 0, 400)).toBe("after")
  })
})
