export type McpConnectionState = "disabled" | "connecting" | "connected" | "failed"

export type McpExposureView = {
  chatId: string
  chatName: string
  supported: boolean
  enabled: boolean
  connection: McpConnectionState
  callerLabel: string | null
  error: string | null
}

export type McpApprovalRisk = 1 | 2 | 3
export type McpApprovalState = "pending" | "approved" | "denied" | "timed-out" | "cancelled"

export type McpPendingApprovalView = {
  id: string
  chatId: string
  chatName: string
  callerLabel: string
  toolName: string
  risk: McpApprovalRisk
  targetLabel: string
  inputSummary: string
  requestedAt: string
  expiresAt: string
  state: McpApprovalState
  sessionGrantOptions: readonly string[]
}

export type McpAuditDecision =
  "allowed" | "denied" | "approval-required" | "approved" | "failed" | "completed"

export type McpAuditView = {
  id: string
  correlationId: string
  occurredAt: string
  callerLabel: string
  chatId: string | null
  chatName: string | null
  runId: string | null
  toolName: string
  tier: 0 | 1 | 2 | 3
  decision: McpAuditDecision
  summary: string
  durationMs: number | null
}

export type McpAuditFilters = {
  caller: string
  tool: string
  decision: McpAuditDecision | "all"
  from: string | null
  to: string | null
}

export type McpAuditPage = {
  entries: McpAuditView[]
  nextCursor: string | null
}

export function approvalsForChat(
  approvals: readonly McpPendingApprovalView[],
  chatId: string,
): McpPendingApprovalView[] {
  return approvals.filter((approval) => approval.chatId === chatId && approval.state === "pending")
}

export function approvalPresentation(
  approval: McpPendingApprovalView,
  activeChatId: string | null,
): "dialog" | "badge" | "hidden" {
  if (approval.state !== "pending") return "hidden"
  return approval.chatId === activeChatId ? "dialog" : "badge"
}

export function canOfferSessionGrant(approval: McpPendingApprovalView): boolean {
  return (
    approval.state === "pending" && approval.risk < 3 && approval.sessionGrantOptions.length > 0
  )
}

export function filterAuditEntries(
  entries: readonly McpAuditView[],
  filters: McpAuditFilters,
): McpAuditView[] {
  const caller = filters.caller.trim().toLocaleLowerCase()
  const tool = filters.tool.trim().toLocaleLowerCase()
  const from = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY
  const to = filters.to ? Date.parse(filters.to) : Number.POSITIVE_INFINITY

  return entries.filter((entry) => {
    const occurredAt = Date.parse(entry.occurredAt)
    return (
      (!caller || entry.callerLabel.toLocaleLowerCase().includes(caller)) &&
      (!tool || entry.toolName.toLocaleLowerCase().includes(tool)) &&
      (filters.decision === "all" || entry.decision === filters.decision) &&
      occurredAt >= from &&
      occurredAt <= to
    )
  })
}

export function pageAuditEntries(
  entries: readonly McpAuditView[],
  cursor: string | null,
  limit: number,
): McpAuditPage {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 25
  const cursorIndex = cursor ? entries.findIndex((entry) => entry.id === cursor) : -1
  if (cursor && cursorIndex === -1) return { entries: [], nextCursor: null }

  const start = cursorIndex + 1
  const page = entries.slice(start, start + boundedLimit)
  const hasMore = start + page.length < entries.length

  return {
    entries: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  }
}
