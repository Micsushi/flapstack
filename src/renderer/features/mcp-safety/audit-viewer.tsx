"use client"

import { Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import { trpc } from "../../lib/trpc"

const decisions = [
  "allowed",
  "dispatch-started",
  "recovery-retryable",
  "recovery-unknown",
  "retry-authorized",
  "retry-consumed",
  "reconciled-completed",
  "reconciled-failed",
  "recovery-exhausted",
  "denied",
  "approval-required",
  "timed-out",
  "stale",
  "failed",
  "completed",
] as const

type McpAuditDecision = (typeof decisions)[number]
type McpAuditFilters = {
  callerChatId: string
  toolName: string
  decision: McpAuditDecision | "all"
  from: string
  to: string
}

const emptyFilters: McpAuditFilters = {
  callerChatId: "",
  toolName: "",
  decision: "all",
  from: "",
  to: "",
}

/**
 * Read-only renderer for the deliberately redacted F4 audit DTO. It never
 * receives raw invocation payloads and target navigation is user initiated.
 */
export function McpAuditViewer({
  initialCallerChatId,
  onOpenChat,
}: {
  initialCallerChatId?: string
  onOpenChat?: (chatId: string) => void
}) {
  const [filters, setFilters] = useState<McpAuditFilters>({
    ...emptyFilters,
    callerChatId: initialCallerChatId ?? "",
  })
  const [cursor, setCursor] = useState<string | undefined>()
  const [previousCursors, setPreviousCursors] = useState<string[]>([])

  const input = useMemo(
    () => ({
      callerChatId: filters.callerChatId.trim() || undefined,
      toolName: filters.toolName.trim() || undefined,
      decision: filters.decision === "all" ? undefined : filters.decision,
      from: toIso(filters.from),
      to: toIso(filters.to),
      cursor,
      limit: 25,
    }),
    [cursor, filters],
  )
  const audit = trpc.appControl.listAuditLog.useQuery(input)

  const updateFilters = (next: Partial<McpAuditFilters>) => {
    setFilters((current) => ({ ...current, ...next }))
    setCursor(undefined)
    setPreviousCursors([])
  }
  const reset = () => {
    setFilters({ ...emptyFilters, callerChatId: initialCallerChatId ?? "" })
    setCursor(undefined)
    setPreviousCursors([])
  }
  const nextPage = () => {
    if (!audit.data?.nextCursor) return
    setPreviousCursors((current) => [...current, cursor ?? ""])
    setCursor(audit.data.nextCursor)
  }
  const previousPage = () => {
    const previous = previousCursors.at(-1)
    if (previous === undefined) return
    setPreviousCursors((current) => current.slice(0, -1))
    setCursor(previous || undefined)
  }

  return (
    <section aria-label="MCP audit history" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Audit history</h3>
          <p className="text-xs text-muted-foreground">Redacted MCP decisions and outcomes.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      <McpAuditRecoveryPanel />

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="Filter audit history by caller chat ID"
          placeholder="Caller chat ID"
          value={filters.callerChatId}
          onChange={(event) => updateFilters({ callerChatId: event.target.value })}
        />
        <Input
          aria-label="Filter audit history by tool"
          placeholder="Tool name"
          value={filters.toolName}
          onChange={(event) => updateFilters({ toolName: event.target.value })}
        />
        <Select
          value={filters.decision}
          onValueChange={(decision) =>
            updateFilters({ decision: decision as McpAuditDecision | "all" })
          }
        >
          <SelectTrigger aria-label="Filter audit history by decision">
            <SelectValue placeholder="All decisions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All decisions</SelectItem>
            {decisions.map((decision) => (
              <SelectItem key={decision} value={decision}>
                {decision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="Filter audit history from time"
            type="datetime-local"
            value={filters.from}
            onChange={(event) => updateFilters({ from: event.target.value })}
          />
          <Input
            aria-label="Filter audit history to time"
            type="datetime-local"
            value={filters.to}
            onChange={(event) => updateFilters({ to: event.target.value })}
          />
        </div>
      </div>

      {audit.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit history
        </div>
      ) : audit.isError ? (
        <div
          className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-foreground"
          role="alert"
        >
          <p>Could not load audit history.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void audit.refetch()}>
            Retry
          </Button>
        </div>
      ) : audit.data?.entries.length === 0 ? (
        <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">
          No audit records match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {audit.data?.entries.map((entry) => (
            <AuditEntry key={entry.id} entry={entry} onOpenChat={onOpenChat} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={previousCursors.length === 0}
          onClick={previousPage}
        >
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={!audit.data?.nextCursor} onClick={nextPage}>
          Next
        </Button>
      </div>
    </section>
  )
}

type McpAuditRecoveryClaim = {
  invocationId: string
  callerChatId: string
  callerRunId: string | null
  toolName: string
  tier: 0 | 1 | 2 | 3
  state:
    | "dispatch-started"
    | "recovery-retryable"
    | "recovery-unknown"
    | "retry-authorized"
    | "retry-consumed"
    | "recovery-exhausted"
  retrySafe: boolean
  createdAt: string
}

function McpAuditRecoveryPanel() {
  const recovery = trpc.appControl.listAuditRecovery.useQuery(undefined, {
    refetchInterval: 5_000,
  })
  const authorizeRetry = trpc.appControl.authorizeAuditRetry.useMutation()
  const reconcile = trpc.appControl.reconcileAuditClaim.useMutation()
  const utils = trpc.useUtils()

  const refresh = async () => {
    await Promise.all([
      utils.appControl.listAuditRecovery.invalidate(),
      utils.appControl.listAuditLog.invalidate(),
    ])
  }
  const authorize = async (invocationId: string) => {
    await authorizeRetry.mutateAsync({ invocationId })
    await refresh()
  }
  const mark = async (invocationId: string, outcome: "completed" | "failed") => {
    await reconcile.mutateAsync({ invocationId, outcome })
    await refresh()
  }
  const claims = (recovery.data ?? []) as McpAuditRecoveryClaim[]
  const error = recovery.isError || authorizeRetry.isError || reconcile.isError

  if (!recovery.isLoading && claims.length === 0 && !error) return null

  return (
    <section
      aria-label="MCP audit recovery"
      className="rounded border border-amber-500/40 bg-amber-500/5 p-3"
    >
      <h4 className="text-xs font-semibold text-foreground">Execution reconciliation</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Resolve calls whose handler may have run but whose terminal audit record is missing.
      </p>
      {recovery.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Checking recovery claims
        </p>
      ) : error ? (
        <div className="mt-2 text-xs text-destructive" role="alert">
          Could not update execution reconciliation.
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {claims.map((claim) => {
            const waiting = claim.state === "dispatch-started"
            return (
              <article
                key={claim.invocationId}
                className="rounded border border-border bg-background p-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-foreground">{claim.toolName}</span>
                  <span className="text-muted-foreground">Tier {claim.tier}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    {claim.state}
                  </span>
                </div>
                <p className="mt-1 break-all text-[11px] text-muted-foreground">
                  Invocation {claim.invocationId} · caller {claim.callerChatId}
                </p>
                {waiting ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Execution is still inside the recovery grace period.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {claim.state === "recovery-retryable" && claim.retrySafe && (
                      <Button
                        aria-label={`Authorize one retry for ${claim.invocationId}`}
                        disabled={authorizeRetry.isPending || reconcile.isPending}
                        size="sm"
                        variant="outline"
                        onClick={() => void authorize(claim.invocationId)}
                      >
                        Authorize one retry
                      </Button>
                    )}
                    <Button
                      aria-label={`Mark ${claim.invocationId} completed`}
                      disabled={authorizeRetry.isPending || reconcile.isPending}
                      size="sm"
                      variant="outline"
                      onClick={() => void mark(claim.invocationId, "completed")}
                    >
                      Mark completed
                    </Button>
                    <Button
                      aria-label={`Mark ${claim.invocationId} failed`}
                      disabled={authorizeRetry.isPending || reconcile.isPending}
                      size="sm"
                      variant="outline"
                      onClick={() => void mark(claim.invocationId, "failed")}
                    >
                      Mark failed
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

type AuditEntryProps = {
  entry: {
    id: string
    invocationId: string
    decision: McpAuditDecision
    callerChatId: string
    callerRunId: string | null
    toolName: string
    tier: 0 | 1 | 2 | 3
    durationMs: number
    occurredAt: string
    detail: {
      callerSummary: string
      chatSummary: string
      runSummary: string
      inputSummary: string
      resultSummary: string
    }
  }
  onOpenChat?: (chatId: string) => void
}

function AuditEntry({ entry, onOpenChat }: AuditEntryProps) {
  return (
    <article className="rounded border border-border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{entry.toolName}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {entry.decision}
        </span>
        <span className="text-muted-foreground">Tier {entry.tier}</span>
        <span className="text-muted-foreground">{formatDuration(entry.durationMs)}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{formatTimestamp(entry.occurredAt)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onOpenChat && entry.callerChatId && (
          <Button
            data-safe-target="chat"
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => onOpenChat(entry.callerChatId)}
          >
            Open caller chat
          </Button>
        )}
        {entry.callerRunId && (
          <span className="text-muted-foreground">Run {entry.callerRunId}</span>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">Redacted detail</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
          <dt className="text-muted-foreground">Caller</dt>
          <dd>{entry.detail.callerSummary}</dd>
          <dt className="text-muted-foreground">Chat</dt>
          <dd>{entry.detail.chatSummary}</dd>
          <dt className="text-muted-foreground">Run</dt>
          <dd>{entry.detail.runSummary}</dd>
          <dt className="text-muted-foreground">Input</dt>
          <dd>{entry.detail.inputSummary}</dd>
          <dt className="text-muted-foreground">Result</dt>
          <dd>{entry.detail.resultSummary}</dd>
        </dl>
      </details>
    </article>
  )
}

function toIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`
}
