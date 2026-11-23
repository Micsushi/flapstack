import { describe, expect, it, vi } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import {
  CodexFileChangeApprovals,
  codexFileChangeQuestion,
} from "../src/main/lib/agent-runtime/codex/file-change-approval"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

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
  it("joins the approval to the subsequent patch and returns the original decision", async () => {
    const client = new FakeCodexProtocolClient()
    const requestPermission = vi.fn(async () => ({ decision: "decline" }))
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      requestPermission,
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "test")
    const request = { id: 4, method: "item/fileChange/requestApproval", params: ids }
    const permission = client.serverRequest(request)
    client.queue.emit(patch("C:/test/approval-codex.txt"))
    client.queue.emit({
      method: "turn/completed",
      params: { threadId: ids.threadId, turn: { id: ids.turnId, status: "completed" } },
    })
    for await (const _event of adapter.streamActivity(context, session, turn)) {
      // Drain native notifications in their original order.
    }
    expect(await permission).toEqual({ decision: "decline" })
    expect(requestPermission).toHaveBeenCalledWith(context, {
      ...request,
      fileChangeScope: "C:/test/approval-codex.txt",
    })
    await adapter.cleanup(context)
  })

  it("does not borrow a path from another thread, turn or item", async () => {
    const approvals = new CodexFileChangeApprovals()
    const waiting = approvals.matching(ids, new AbortController().signal)
    approvals.observe(patch("wrong thread", { threadId: "other" }))
    approvals.observe(patch("wrong turn", { turnId: "other" }))
    approvals.observe(patch("wrong item", { itemId: "other" }))
    approvals.observe(patch("ours"))
    expect(await waiting).toBe("ours")
  })

  it("bounds native changes, labels renames and distinguishes grant root from an identified file", async () => {
    const approvals = new CodexFileChangeApprovals()
    const signal = new AbortController().signal
    approvals.observe({
      method: "item/fileChange/patchUpdated",
      params: {
        ...ids,
        changes: [
          { path: "old", kind: { type: "update", move_path: "new" } },
          { path: "a\nb" },
          { path: "x".repeat(210) + "/end" },
          { path: "hidden" },
        ],
      },
    })
    const scope = await approvals.matching(ids, signal)
    expect(scope).toContain("old → new")
    expect(scope).toContain("a\\u{a}b")
    expect(scope).toContain("/end")
    expect(scope).toContain("1 more change")
    expect(scope!.length).toBeLessThan(225)
    const grant = codexFileChangeQuestion({ grantRoot: "/owned" }, undefined)
    expect(grant).toContain("Codex did not identify the individual files.")
    expect(grant).toContain("Requested write root: /owned")
    expect(grant).not.toContain("Proposed files:")
    expect(codexFileChangeQuestion({}, await approvals.matching({}, signal))).toContain(
      "did not identify",
    )
    approvals.observe({ ...patch("old"), method: "item/completed" })
    expect(await approvals.matching(ids, AbortSignal.timeout(20))).toBeUndefined()
  })
})
