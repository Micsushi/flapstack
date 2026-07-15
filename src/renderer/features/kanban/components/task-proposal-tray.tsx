import { useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import {
  AI_TASK_PROPOSAL_BATCH_CAP,
  type TaskProposalRecord,
} from "../../../../shared/task-proposals"
import { describePlanSourceLinkStatus } from "../../../../shared/plan-kanban-consistency"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../../components/ui/button"
import { Badge } from "../../../components/ui/badge"
import { PlanSourceComparisonDialog } from "../../plan/plan-source-comparison-dialog"

type Proposal = TaskProposalRecord

export function TaskProposalTray({ projectId }: { projectId?: string }) {
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const utils = trpc.useUtils()
  const proposals = trpc.taskProposals.list.useQuery(
    { projectId, includeArchived: false, limit: 20 },
    { refetchInterval: 5_000 },
  )
  const items = proposals.data?.items ?? []
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  )

  const refresh = async () => {
    await Promise.all([
      utils.taskProposals.invalidate(),
      utils.tasks.board.invalidate(),
      utils.tasks.list.invalidate(),
      utils.chats.list.invalidate(),
    ])
  }
  const approve = trpc.taskProposals.approve.useMutation({
    onSuccess: async () => {
      await refresh()
      toast.success("Proposal approved. Task and idle chat created.")
    },
    onError: async (error) => {
      await utils.taskProposals.invalidate()
      toast.error(error.message || "Proposal approval failed.")
    },
  })
  const approveBatch = trpc.taskProposals.approveBatch.useMutation({
    onSuccess: async () => {
      setSelected(new Set())
      await refresh()
      toast.success("Proposal batch approved. Tasks and idle chats created.")
    },
    onError: async (error) => {
      await utils.taskProposals.invalidate()
      toast.error(error.message || "Proposal batch approval failed.")
    },
  })
  const deny = trpc.taskProposals.deny.useMutation({
    onSuccess: async () => {
      await utils.taskProposals.invalidate()
      toast.success("Proposal denied and archived.")
    },
    onError: async (error) => {
      await utils.taskProposals.invalidate()
      toast.error(error.message || "Proposal denial failed.")
    },
  })

  const loadApproval = async (proposal: Proposal) => {
    const preview = await utils.taskProposals.preview.fetch({ proposalId: proposal.id })
    return {
      proposalId: proposal.id,
      expectedVersion: preview.proposal.version,
      review: preview.review,
    }
  }

  const handleBatchApprove = async () => {
    if (
      selectedItems.length < 1 ||
      selectedItems.length > AI_TASK_PROPOSAL_BATCH_CAP ||
      approveBatch.isPending
    ) {
      return
    }
    try {
      approveBatch.mutate({ approvals: await Promise.all(selectedItems.map(loadApproval)) })
    } catch (error) {
      await utils.taskProposals.invalidate()
      toast.error(error instanceof Error ? error.message : "Proposal preview changed.")
    }
  }

  const handleSingleApprove = async (proposal: Proposal) => {
    try {
      approve.mutate(await loadApproval(proposal))
    } catch (error) {
      await utils.taskProposals.invalidate()
      toast.error(error instanceof Error ? error.message : "Proposal preview changed.")
    }
  }

  return (
    <section
      className="mx-4 mb-2 rounded-md border border-border/70 bg-muted/20"
      aria-label="AI task proposal tray"
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left text-xs font-medium"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          AI proposals
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {items.length}
          </span>
        </button>
        <span className="text-[11px] text-muted-foreground">
          Inert until you approve exact task and chat state.
        </span>
        {selectedItems.length > 0 && (
          <Button
            type="button"
            size="sm"
            className="ml-auto h-7 text-xs"
            disabled={selectedItems.length > AI_TASK_PROPOSAL_BATCH_CAP || approveBatch.isPending}
            onClick={() => void handleBatchApprove()}
          >
            {approveBatch.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Approve selected ({selectedItems.length}/{AI_TASK_PROPOSAL_BATCH_CAP})
          </Button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border/60 p-2">
          {proposals.isLoading ? (
            <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading proposals
            </p>
          ) : proposals.isError ? (
            <p className="p-2 text-xs text-destructive">
              Proposal tray unavailable: {proposals.error.message}
            </p>
          ) : items.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No pending AI task proposals.</p>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {items.map((proposal) => (
                <ProposalPreview
                  key={proposal.id}
                  proposal={proposal}
                  selected={selected.has(proposal.id)}
                  busy={approve.isPending || deny.isPending || approveBatch.isPending}
                  onSelected={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked) next.add(proposal.id)
                      else next.delete(proposal.id)
                      return next
                    })
                  }
                  onApprove={() => handleSingleApprove(proposal)}
                  onDeny={() =>
                    deny.mutate({ proposalId: proposal.id, expectedVersion: proposal.version })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ProposalPreview({
  proposal,
  selected,
  busy,
  onSelected,
  onApprove,
  onDeny,
}: {
  proposal: Proposal
  selected: boolean
  busy: boolean
  onSelected: (checked: boolean) => void
  onApprove: () => Promise<void>
  onDeny: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const preview = trpc.taskProposals.preview.useQuery(
    { proposalId: proposal.id },
    { refetchOnWindowFocus: false },
  )
  const sourceLinks = trpc.planSources.sourceLinks.useQuery(
    { projectId: proposal.projectId },
    { enabled: Boolean(proposal.source), refetchOnWindowFocus: true, refetchInterval: 5_000 },
  )
  const sourceLink = sourceLinks.data?.find(
    (link) => link.kind === "proposal" && link.entity.id === proposal.id,
  )
  return (
    <article
      className="rounded-md border border-border/70 bg-background p-3"
      aria-label={`Task proposal ${proposal.name}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          disabled={!preview.data || busy}
          onChange={(event) => onSelected(event.target.checked)}
          aria-label={`Select ${proposal.name} for batch approval`}
          className="mt-0.5 h-4 w-4"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-medium">{proposal.name}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {proposal.projectName} · {proposal.targetStatus} · version {proposal.version}
          </p>
          {sourceLink && (
            <Badge
              variant={sourceLink.diverged ? "destructive" : "outline"}
              className="mt-1 text-[9px]"
            >
              {describePlanSourceLinkStatus(sourceLink.status)}
            </Badge>
          )}
          {proposal.description && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {proposal.description}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setDetailsOpen((value) => !value)}
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Exact task and chat preview
      </button>
      {detailsOpen && (
        <div className="mt-2 rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
          {preview.isLoading ? (
            <span className="text-muted-foreground">Loading exact preview…</span>
          ) : preview.isError ? (
            <span className="text-destructive">{preview.error.message}</span>
          ) : preview.data ? (
            <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
              <dt className="text-muted-foreground">Task</dt>
              <dd>{preview.data.review.taskName}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{preview.data.review.status}</dd>
              <dt className="text-muted-foreground">Permission</dt>
              <dd>{preview.data.review.permissionMode}</dd>
              <dt className="text-muted-foreground">Worktree</dt>
              <dd>{preview.data.review.worktreeMode}</dd>
              <dt className="text-muted-foreground">Chat</dt>
              <dd className="whitespace-pre-wrap break-words">{preview.data.review.seedText}</dd>
              <dt className="text-muted-foreground">Run</dt>
              <dd>None. Approval leaves the chat idle.</dd>
            </dl>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {sourceLink && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto h-7 text-xs"
            onClick={() => setComparisonOpen(true)}
          >
            Compare source
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={onDeny}
        >
          <X className="mr-1 h-3 w-3" /> Deny
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={busy || !preview.data}
          onClick={() => void onApprove()}
        >
          <Check className="mr-1 h-3 w-3" /> Approve exact preview
        </Button>
      </div>
      {sourceLink && comparisonOpen && (
        <PlanSourceComparisonDialog link={sourceLink} onClose={() => setComparisonOpen(false)} />
      )}
    </article>
  )
}
