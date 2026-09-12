import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { YAP_REVIEW_REQUEST_EVENT } from "../../../../shared/task-proposals"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../../components/ui/button"

export function TaskProposalTray({ projectId }: { projectId?: string }) {
  const [expanded, setExpanded] = useState(true)
  const query = trpc.projectRecords.yapProposals.useQuery(
    { projectId },
    { refetchInterval: 15_000, retry: false },
  )
  const proposals = (query.data?.proposals ?? []).filter(
    (proposal) => !["applied", "cancelled"].includes(proposal.status),
  )
  if (!query.isError && proposals.length === 0) return null
  return (
    <section className="mx-4 mb-2 border-t pt-2" aria-label="Yap proposals">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-medium"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Yap proposals{proposals.length > 0 ? ` (${proposals.length})` : ""}
      </button>
      {expanded &&
        (query.isError ? (
          <div role="status" className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span>{query.error.message}</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {proposals.map((proposal) => (
              <li key={proposal.proposalId} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 break-words text-sm">
                  {proposal.rows[0]?.interpretedRequest || "Untitled proposal"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(YAP_REVIEW_REQUEST_EVENT, {
                        detail: { proposalId: proposal.proposalId, source: "task-proposal-tray" },
                      }),
                    )
                  }
                >
                  Review in Yap
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
