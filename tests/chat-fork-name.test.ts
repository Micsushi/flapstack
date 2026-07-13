import { describe, expect, it } from "vitest"
import { getChatForkBaseName, getNextChatForkName } from "../src/main/lib/chat-fork-name"

describe("chat fork naming", () => {
  it("adds (2) to the first fork", () => {
    expect(getNextChatForkName("Fix window drag and layout", ["Fix window drag and layout"])).toBe(
      "Fix window drag and layout (2)",
    )
  })

  it("increments existing sibling forks", () => {
    expect(
      getNextChatForkName("Fix window drag and layout (2)", [
        "Fix window drag and layout",
        "Fix window drag and layout (2)",
        "Fix window drag and layout (4)",
      ]),
    ).toBe("Fix window drag and layout (5)")
  })

  it("does not treat unrelated numbered titles as forks", () => {
    expect(getNextChatForkName("Release 2", ["Release 2", "Release 2 notes (8)"])).toBe(
      "Release 2 (2)",
    )
  })

  it("only strips a trailing fork suffix", () => {
    expect(getChatForkBaseName("Investigate (2) failures (3)")).toBe("Investigate (2) failures")
  })
})
