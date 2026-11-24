import { afterEach, describe, expect, it, vi } from "vitest"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"

const caller = { chatId: "chat-1", runId: "run-1", permissionMode: "ask-before-edits" as const }
const tool = getMcpControlTool("create_chat")!
const originalStatus = tool.status
const durableAudit = { append: () => undefined }

afterEach(() => {
  tool.status = originalStatus
  vi.useRealTimers()
})

function makeImplemented(): void {
  // Mutation handlers land in S3-F2-T5. This exercises the shared invoker
  // without introducing any mutation business logic early.
  tool.status = "implemented"
}

describe("MCP approval execution gate", () => {
  it("does not reach target resolution when the user denies approval", async () => {
    makeImplemented()
    const approvals = new McpApprovalLifecycle()
    const resolveTarget = vi.fn(() => ({}))
    const result = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      approvals,
      approvalId: () => "denied",
      resolveTarget,
    })

    expect(approvals.listPending()).toHaveLength(1)
    approvals.deny("denied")
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-denied" },
    })
    expect(resolveTarget).not.toHaveBeenCalled()
    approvals.shutdown()
  })

  it("revalidates caller and target after approval, failing closed when either changed", async () => {
    makeImplemented()
    const approvals = new McpApprovalLifecycle()
    const resolveCaller = vi
      .fn<() => typeof caller>()
      .mockReturnValueOnce(caller)
      .mockImplementationOnce(() => {
        throw new Error("run ended")
      })
    const staleCaller = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      approvals,
      approvalId: () => "stale-caller",
      resolveCaller,
      audit: durableAudit,
    })
    approvals.approve("stale-caller")
    await expect(staleCaller).resolves.toMatchObject({
      ok: false,
      error: { code: "stale-caller" },
    })
    expect(resolveCaller).toHaveBeenCalledTimes(2)

    const staleTarget = invokeMcpControlTool("create_chat", caller, {}, undefined, {
      approvals,
      approvalId: () => "stale-target",
      resolveTarget: vi.fn(() => null),
      audit: durableAudit,
    })
    approvals.approve("stale-target")
    await expect(staleTarget).resolves.toMatchObject({
      ok: false,
      error: { code: "stale-target" },
    })
    approvals.shutdown()
  })
})
