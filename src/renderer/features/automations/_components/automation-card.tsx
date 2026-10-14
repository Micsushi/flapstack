import { WorkspaceRow } from "../../../components/ui/workspace"
import { ArrowRight } from "lucide-react"
import type { AutomationControlRecord } from "../../../../main/lib/automation/control-service"

export function AutomationCard({
  automation,
  onClick,
}: {
  automation: AutomationControlRecord
  onClick: () => void
}) {
  const approvalNeedsAttention = automation.approval.state !== "approved"
  return (
    <WorkspaceRow
      type="button"
      onClick={onClick}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 sm:flex"
      aria-label={`Open ${automation.draft.name}, ${automation.state}, approval ${automation.approval.state}`}
    >
      <h2 className="col-span-2 min-w-0 flex-1 break-words text-sm font-medium sm:truncate">
        {automation.draft.name}
      </h2>
      <div className="flex flex-wrap gap-x-3 sm:justify-end gap-y-1 text-xs text-muted-foreground">
        <span>
          {
            {
              manual: "Manual",
              schedule: "Scheduled",
              "run-complete": "After a run",
              "file-change": "On file changes",
            }[automation.draft.trigger.type]
          }
        </span>
        <span className="capitalize">{automation.state}</span>
        {approvalNeedsAttention && (
          <span>
            {automation.approval.state === "pending"
              ? "Needs approval"
              : `Approval ${automation.approval.state}`}
          </span>
        )}
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      />
    </WorkspaceRow>
  )
}
