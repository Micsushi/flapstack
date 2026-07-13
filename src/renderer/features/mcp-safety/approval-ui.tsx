"use client"

import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { Button } from "../../components/ui/button"
import { Checkbox } from "../../components/ui/checkbox"
import { approvalPresentation, canOfferSessionGrant, type McpPendingApprovalView } from "./model"

export type McpApprovalAction = {
  id: string
  decision: "approve" | "deny"
  grantSession: boolean
}

export type McpApprovalSurfaceProps = {
  approvals: readonly McpPendingApprovalView[]
  activeChatId: string | null
  onDecision: (action: McpApprovalAction) => Promise<{ resolved: boolean }>
  onOpenChat?: (chatId: string) => void
}

/**
 * Renders decisions already resolved by the main-process approval lifecycle.
 * It deliberately has no navigation or focus behavior for background calls.
 */
export function McpApprovalSurface({
  approvals,
  activeChatId,
  onDecision,
  onOpenChat,
}: McpApprovalSurfaceProps) {
  const activeApproval = approvals.find(
    (approval) => approvalPresentation(approval, activeChatId) === "dialog",
  )
  const backgroundApprovals = approvals.filter(
    (approval) => approvalPresentation(approval, activeChatId) === "badge",
  )

  return (
    <>
      <McpBackgroundApprovalNotice approvals={backgroundApprovals} onOpenChat={onOpenChat} />
      {activeApproval && <McpApprovalDialog approval={activeApproval} onDecision={onDecision} />}
    </>
  )
}

export function McpBackgroundApprovalNotice({
  approvals,
  onOpenChat,
}: {
  approvals: readonly McpPendingApprovalView[]
  onOpenChat?: (chatId: string) => void
}) {
  if (approvals.length === 0) return null

  const chatApprovals = Array.from(
    new Map(approvals.map((approval) => [approval.chatId, approval])).values(),
  )
  const chats = chatApprovals.length
  return (
    <div
      className="rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-xs text-foreground"
      data-mcp-approval-notice="background"
    >
      <p aria-atomic="true" aria-live="polite" role="status">
        {approvals.length} approval{approvals.length === 1 ? "" : "s"} pending in {chats} background
        {chats === 1 ? " chat" : " chats"}.
      </p>
      {onOpenChat && (
        <div className="mt-1 flex flex-wrap gap-1">
          {chatApprovals.map((approval) => (
            <Button
              key={approval.chatId}
              aria-label={`Review MCP approval in ${approval.chatName}`}
              size="sm"
              variant="outline"
              onClick={() => onOpenChat(approval.chatId)}
            >
              Review {approval.chatName}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function McpApprovalDialog({
  approval,
  onDecision,
}: {
  approval: McpPendingApprovalView
  onDecision: McpApprovalSurfaceProps["onDecision"]
}) {
  const [grantSession, setGrantSession] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [closedId, setClosedId] = useState<string | null>(null)
  const canGrant = canOfferSessionGrant(approval)

  useEffect(() => {
    setGrantSession(false)
    setSubmitting(false)
    setClosedId(null)
  }, [approval.id])

  const decide = async (decision: McpApprovalAction["decision"]) => {
    setSubmitting(true)
    try {
      await onDecision({
        id: approval.id,
        decision,
        grantSession: decision === "approve" && canGrant && grantSession,
      })
      // The lifecycle may have accepted this decision, or it may already have
      // timed out or resolved elsewhere. Either way, close instead of leaving
      // controls visible for a request that cannot accept another decision.
      setClosedId(approval.id)
    } finally {
      setSubmitting(false)
    }
  }

  const open = approval.state === "pending" && closedId !== approval.id
  return (
    <AlertDialog open={open}>
      <AlertDialogContent aria-describedby={`mcp-approval-${approval.id}-description`}>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve MCP action</AlertDialogTitle>
          <AlertDialogDescription id={`mcp-approval-${approval.id}-description`}>
            {approval.callerLabel} requests permission before {formatTime(approval.expiresAt)}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Caller</dt>
            <dd>{approval.callerLabel}</dd>
            <dt className="text-muted-foreground">Tool</dt>
            <dd className="font-mono break-all">{approval.toolName}</dd>
            <dt className="text-muted-foreground">Risk</dt>
            <dd>Tier {approval.risk}</dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd className="break-words">{approval.targetLabel}</dd>
            <dt className="text-muted-foreground">Input</dt>
            <dd className="break-words">{approval.inputSummary}</dd>
          </dl>
          {canGrant && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="Approve this tool for the current chat session"
                checked={grantSession}
                disabled={submitting}
                onCheckedChange={(checked) => setGrantSession(checked === true)}
              />
              {approval.sessionGrantOptions[0]}
            </label>
          )}
        </AlertDialogBody>
        <AlertDialogFooter>
          <Button
            aria-label={`Deny ${approval.toolName}`}
            disabled={submitting}
            variant="outline"
            onClick={() => void decide("deny")}
          >
            Deny
          </Button>
          <Button
            aria-label={`Approve ${approval.toolName}`}
            disabled={submitting}
            onClick={() => void decide("approve")}
          >
            Approve
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function formatTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime())
    ? "the request expires"
    : `it expires at ${time.toLocaleTimeString()}`
}
