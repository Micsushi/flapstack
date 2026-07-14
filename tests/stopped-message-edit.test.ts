import { describe, expect, it } from "vitest"
import { canEditStoppedUserMessage } from "../src/renderer/features/agents/stores/message-store"

const base = {
  userMessageId: "user-latest",
  editableStoppedUserMessageId: "user-latest",
  rollbackTargetSdkUuid: "assistant-before-latest",
  isLastGroup: true,
  isStreaming: false,
}

describe("stopped message editing", () => {
  it("allows editing only for the latest manually stopped prompt", () => {
    expect(canEditStoppedUserMessage(base)).toBe(true)
  })

  it("does not expose edit after a normal completed response", () => {
    expect(
      canEditStoppedUserMessage({
        ...base,
        editableStoppedUserMessageId: null,
      }),
    ).toBe(false)
  })

  it("does not expose edit while streaming or on an older prompt", () => {
    expect(canEditStoppedUserMessage({ ...base, isStreaming: true })).toBe(false)
    expect(canEditStoppedUserMessage({ ...base, isLastGroup: false })).toBe(false)
  })

  it("requires a provider rollback target so resending replaces the stopped turn", () => {
    expect(canEditStoppedUserMessage({ ...base, rollbackTargetSdkUuid: null })).toBe(false)
  })
})
