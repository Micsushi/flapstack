import type { PlanSourceLink } from "../../../shared/plan-kanban-consistency"
import { describePlanSourceLinkStatus } from "../../../shared/plan-kanban-consistency"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"

export function PlanSourceComparisonDialog({
  link,
  onClose,
}: {
  link: PlanSourceLink
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Plan source comparison</DialogTitle>
          <DialogDescription>
            Read-only comparison. Later plan edits never overwrite the durable {link.kind}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={link.diverged ? "destructive" : "outline"}>
            {describePlanSourceLinkStatus(link.status)}
          </Badge>
          <span className="text-muted-foreground">
            {link.kind} version {link.entity.version} · {link.entity.status}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ComparisonPane
            title={`Durable ${link.kind}`}
            name={link.compare.durableTitle}
            body={link.compare.durableBody}
          />
          <ComparisonPane
            title="Current plan source"
            name={link.compare.currentSourceTitle}
            body={link.compare.currentSourceBody}
          />
        </div>

        <dl className="grid gap-1 rounded-md border bg-muted/20 p-3 font-mono text-[11px] sm:grid-cols-[140px_1fr]">
          <dt className="text-muted-foreground">Source path</dt>
          <dd className="break-all">{link.provenance.sourcePath}</dd>
          <dt className="text-muted-foreground">Creation fingerprint</dt>
          <dd className="break-all">{link.provenance.sourceFingerprint}</dd>
          <dt className="text-muted-foreground">Current fingerprint</dt>
          <dd className="break-all">{link.source?.fingerprint ?? "Unavailable"}</dd>
          <dt className="text-muted-foreground">Candidate ID</dt>
          <dd className="break-all">{link.provenance.sourceCandidateId}</dd>
        </dl>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ComparisonPane({
  title,
  name,
  body,
}: {
  title: string
  name: string | null
  body: string | null
}) {
  return (
    <section className="min-w-0 rounded-md border p-3" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <p className="mt-2 text-sm font-medium">{name ?? "Unavailable"}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
        {body ?? "No description."}
      </p>
    </section>
  )
}
