import { describe, expect, it } from "vitest"
import {
  approvalPresentation,
  approvalsForChat,
  canOfferSessionGrant,
  filterAuditEntries,
  pageAuditEntries,
  type McpAuditView,
  type McpPendingApprovalView,
} from "../src/renderer/features/mcp-safety/model"

const pendingApproval: McpPendingApprovalView = {
  id: "approval-1",
  chatId: "chat-1",
  chatName: "Fix parser",
  callerLabel: "Claude / run-1",
  toolName: "archive_item",
  risk: 2,
  targetLabel: "Chat: Fix parser",
  inputSummary: "Archive the selected chat",
  requestedAt: "2026-07-11T10:00:00.000Z",
  expiresAt: "2026-07-11T10:05:00.000Z",
  state: "pending",
  sessionGrantOptions: ["This chat session"],
}

const auditEntries: McpAuditView[] = [
  {
    id: "event-3",
    correlationId: "call-2",
    occurredAt: "2026-07-11T10:03:00.000Z",
    callerLabel: "Codex / run-2",
    chatId: "chat-2",
    chatName: "Add tests",
    runId: "run-2",
    toolName: "launch_run",
    tier: 3,
    decision: "denied",
    summary: "User denied launch",
    durationMs: 1200,
  },
  {
    id: "event-2",
    correlationId: "call-1",
    occurredAt: "2026-07-11T10:02:00.000Z",
    callerLabel: "Claude / run-1",
    chatId: "chat-1",
    chatName: "Fix parser",
    runId: "run-1",
    toolName: "list_projects",
    tier: 0,
    decision: "completed",
    summary: "Returned 2 projects",
    durationMs: 8,
  },
  {
    id: "event-1",
    correlationId: "call-1",
    occurredAt: "2026-07-11T10:01:00.000Z",
    callerLabel: "Claude / run-1",
    chatId: "chat-1",
    chatName: "Fix parser",
    runId: "run-1",
    toolName: "list_projects",
    tier: 0,
    decision: "allowed",
    summary: "Read allowed",
    durationMs: null,
  },
]

describe("MCP safety UI model", () => {
  it("only opens the dialog for a pending approval in the active chat", () => {
    expect(approvalPresentation(pendingApproval, "chat-1")).toBe("dialog")
    expect(approvalPresentation(pendingApproval, "chat-2")).toBe("badge")
    expect(approvalPresentation({ ...pendingApproval, state: "timed-out" }, "chat-1")).toBe(
      "hidden",
    )
  })

  it("counts pending approvals by chat", () => {
    expect(
      approvalsForChat(
        [pendingApproval, { ...pendingApproval, id: "approval-2", state: "denied" }],
        "chat-1",
      ),
    ).toHaveLength(1)
  })

  it("never offers a session grant for Tier 3", () => {
    expect(canOfferSessionGrant(pendingApproval)).toBe(true)
    expect(canOfferSessionGrant({ ...pendingApproval, risk: 3 })).toBe(false)
  })

  it("filters redacted audit views by caller, tool, decision, and time", () => {
    expect(
      filterAuditEntries(auditEntries, {
        caller: "claude",
        tool: "projects",
        decision: "completed",
        from: "2026-07-11T10:01:30.000Z",
        to: "2026-07-11T10:02:30.000Z",
      }).map((entry) => entry.id),
    ).toEqual(["event-2"])
  })

  it("pages without a hidden first-page ceiling and clamps unsafe limits", () => {
    expect(pageAuditEntries(auditEntries, null, 2)).toEqual({
      entries: auditEntries.slice(0, 2),
      nextCursor: "event-2",
    })
    expect(pageAuditEntries(auditEntries, "event-2", 500)).toEqual({
      entries: [auditEntries[2]],
      nextCursor: null,
    })
    expect(pageAuditEntries(auditEntries, "stale-event", 25)).toEqual({
      entries: [],
      nextCursor: null,
    })
  })
})
