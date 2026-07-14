import { ArrowRight, Clock3, ShieldCheck, ShieldX } from "lucide-react"
import type { AutomationControlRecord } from "../../../../main/lib/automation/control-service"

export function AutomationCard({
  automation,
  onClick,
}: {
  automation: AutomationControlRecord
  onClick: () => void
}) {
  const errorState =
    automation.approval.state === "denied" || automation.approval.state === "revoked"
  return (
    <button
      type="button"
      onClick={onClick}
      className="group h-full w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${automation.draft.name}, ${automation.state}, approval ${automation.approval.state}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{automation.draft.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {automation.draft.description || automation.draft.run.prompt}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded border px-1.5 py-0.5 capitalize">{automation.state}</span>
        <span className="rounded border px-1.5 py-0.5">{automation.draft.trigger.type}</span>
        <span className="rounded border px-1.5 py-0.5">{automation.draft.run.harness}</span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        {errorState ? (
          <ShieldX className="h-3.5 w-3.5 text-red-500" />
        ) : automation.approval.state === "approved" ? (
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Clock3 className="h-3.5 w-3.5 text-amber-500" />
        )}
        <span className="capitalize">Approval {automation.approval.state}</span>
      </div>
    </button>
  )
}
