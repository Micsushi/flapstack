import { describe, expect, it } from "vitest"
import { CodexFileChangeApprovals } from "../src/main/lib/agent-runtime/codex/file-change-approval"

const ids = { threadId: "thread-1", turnId: "turn-1", itemId: "exec-5d6545f4" }

function patch(path: string, overrides: Partial<typeof ids> = {}) {
  const { threadId, turnId, itemId } = { ...ids, ...overrides }
  return {
    method: "item/started",
    params: {
      threadId,
      turnId,
      item: { type: "fileChange", id: itemId, changes: [{ path, kind: { type: "add" } }] },
    },
  }
}

describe("Codex native file-change approval", () => {
  it("does not borrow a path from another thread, turn or item", async () => {
    const approvals = new CodexFileChangeApprovals()
    const waiting = approvals.matching(ids, new AbortController().signal)
    approvals.observe(patch("wrong thread", { threadId: "other" }))
    approvals.observe(patch("wrong turn", { turnId: "other" }))
    approvals.observe(patch("wrong item", { itemId: "other" }))
    approvals.observe(patch("ours"))
    expect(await waiting).toBe("ours")
  })
})
