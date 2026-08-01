import { describe, expect, it, vi } from "vitest"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"

const caller = {
  chatId: "chat-a",
  runId: "run-a",
  permissionMode: "ask-before-edits" as const,
}

function audit() {
  const records: Array<Record<string, unknown>> = []
  return {
    records,
    writer: {
      append(record: Record<string, unknown>) {
        records.push(record)
      },
    },
  }
}

describe("approval-gated visual capture agent tool contract", () => {
  it("is a separate Tier 3 product capability and waits for visible user source selection", async () => {
    expect(getMcpControlTool("request_visual_capture")).toMatchObject({
      tier: 3,
      status: "implemented",
      requiredCapabilities: ["productMcpTier3"],
    })
    const approvals = new McpApprovalLifecycle()
    const durable = audit()
    const execute = vi.fn(async () => ({
      ok: true as const,
      data: {
        state: "awaiting-visible-user-selection",
        captureRequestId: "capture-request-a",
      },
    }))
    const result = invokeMcpControlTool(
      "request_visual_capture",
      caller,
      { projectId: "project-a", chatId: "chat-a", runId: "run-a" },
      undefined,
      {
        approvals,
        audit: durable.writer,
        execute,
      },
    )
    const pending = approvals.listPending()[0]
    expect(pending).toMatchObject({
      caller: { chatId: "chat-a", runId: "run-a" },
      toolName: "request_visual_capture",
      tier: 3,
    })
    expect(execute).not.toHaveBeenCalled()
    approvals.approve(pending!.id)
    await expect(result).resolves.toEqual({
      ok: true,
      data: {
        state: "awaiting-visible-user-selection",
        captureRequestId: "capture-request-a",
      },
    })
    expect(durable.records.map((record) => record.status)).toEqual(
      expect.arrayContaining(["approval-required", "allowed", "dispatch-started", "completed"]),
    )
  })

  it("audits denial and timeout without dispatching capture", async () => {
    const deniedApprovals = new McpApprovalLifecycle()
    const deniedAudit = audit()
    const deniedExecute = vi.fn()
    const denied = invokeMcpControlTool(
      "request_visual_capture",
      caller,
      { projectId: "project-a", chatId: "chat-a", runId: "run-a" },
      undefined,
      { approvals: deniedApprovals, audit: deniedAudit.writer, execute: deniedExecute },
    )
    deniedApprovals.deny(deniedApprovals.listPending()[0]!.id)
    await expect(denied).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-denied" },
    })
    expect(deniedExecute).not.toHaveBeenCalled()
    expect(deniedAudit.records.at(-1)).toMatchObject({ status: "denied" })

    const timeoutApprovals = new McpApprovalLifecycle()
    const timeoutAudit = audit()
    vi.useFakeTimers()
    const timedOut = invokeMcpControlTool(
      "request_visual_capture",
      caller,
      { projectId: "project-a", chatId: "chat-a", runId: "run-a" },
      undefined,
      { approvals: timeoutApprovals, audit: timeoutAudit.writer, execute: vi.fn() },
    )
    await vi.advanceTimersByTimeAsync(60_001)
    vi.useRealTimers()
    await expect(timedOut).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-timeout" },
    })
    expect(timeoutAudit.records.at(-1)).toMatchObject({ status: "timed-out" })
  })
})
