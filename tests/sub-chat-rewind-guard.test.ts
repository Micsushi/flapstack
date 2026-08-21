import { describe, expect, it } from "vitest"
import {
  assertSubChatNotRewinding,
  isSubChatRewinding,
  withSubChatRewindGuard,
} from "../src/main/lib/sub-chat-rewind-guard"

describe("sub-chat rewind guard", () => {
  it("blocks a new run for the full asynchronous rewind window", async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const rewind = withSubChatRewindGuard("sub-chat", () => blocked)

    expect(() => assertSubChatNotRewinding("sub-chat")).toThrow(/being rewound/i)
    expect(isSubChatRewinding("sub-chat")).toBe(true)
    expect(() => assertSubChatNotRewinding("other-sub-chat")).not.toThrow()
    release()
    await rewind
    expect(isSubChatRewinding("sub-chat")).toBe(false)
    expect(() => assertSubChatNotRewinding("sub-chat")).not.toThrow()
  })

  it("always releases after a failed rewind", async () => {
    await expect(
      withSubChatRewindGuard("sub-chat", async () => {
        throw new Error("restore failed")
      }),
    ).rejects.toThrow("restore failed")
    expect(() => assertSubChatNotRewinding("sub-chat")).not.toThrow()
  })

  it("releases the guard when an operation throws before returning a promise", async () => {
    await expect(
      withSubChatRewindGuard("sub-chat-sync-failure", () => {
        throw new Error("sync failure")
      }),
    ).rejects.toThrow("sync failure")

    expect(() => assertSubChatNotRewinding("sub-chat-sync-failure")).not.toThrow()
  })
})
