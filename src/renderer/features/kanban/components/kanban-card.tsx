import { memo, useState } from "react"
import { Archive, GitBranch, MessageSquare, Play, ExternalLink } from "lucide-react"
import { formatTimeAgo } from "../../../lib/utils/format-time-ago"
import { cn } from "../../../lib/utils"
import {
  getTaskKanbanCardAriaLabel,
  getTaskKanbanKeyboardMove,
  type TaskKanbanCard as TaskKanbanCardData,
  type TaskKanbanMoveTarget,
} from "../../../../shared/task-kanban"
import { describePlanSourceLinkStatus } from "../../../../shared/plan-kanban-consistency"
import { Badge } from "../../../components/ui/badge"
import { trpc } from "../../../lib/trpc"
import { PlanSourceComparisonDialog } from "../../plan/plan-source-comparison-dialog"

export type { TaskKanbanCardData }

interface KanbanCardProps {
  card: TaskKanbanCardData
  orderedColumnTaskIds: readonly string[]
  moveEnabled: boolean
  onOpenTask: (card: TaskKanbanCardData) => void
  onOpenChat: (card: TaskKanbanCardData) => void
  onMove: (card: TaskKanbanCardData, target: TaskKanbanMoveTarget) => void
  onArchive: (card: TaskKanbanCardData) => void
  onDragStart: (taskId: string) => void
  onDropBefore: (taskId: string) => void
}

export const KanbanCard = memo(function KanbanCard({
  card,
  orderedColumnTaskIds,
  moveEnabled,
  onOpenTask,
  onOpenChat,
  onMove,
  onArchive,
  onDragStart,
  onDropBefore,
}: KanbanCardProps) {
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const timeAgo = formatTimeAgo(card.updatedAt ?? card.createdAt ?? new Date())
  const sourceLinks = trpc.planSources.sourceLinks.useQuery(
    { projectId: card.projectId },
    {
      enabled: Boolean(card.sourcePath),
      refetchOnWindowFocus: true,
      refetchInterval: 5_000,
    },
  )
  const sourceLink = sourceLinks.data?.find(
    (link) => link.kind === "task" && link.entity.id === card.id,
  )

  return (
    <article
      className="group rounded-md border border-border/60 bg-card p-2 shadow-sm transition-colors hover:border-border"
      draggable={moveEnabled}
      onDragStart={() => onDragStart(card.id)}
      onDragOver={(event) => {
        if (moveEnabled) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDropBefore(card.id)
      }}
      data-task-id={card.id}
    >
      <button
        type="button"
        className={cn(
          "w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          moveEnabled && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={getTaskKanbanCardAriaLabel(card)}
        onClick={() => onOpenTask(card)}
        onKeyDown={(event) => {
          const target = getTaskKanbanKeyboardMove(
            card,
            orderedColumnTaskIds,
            event.key,
            event.altKey && moveEnabled,
          )
          if (!target) return
          event.preventDefault()
          onMove(card, target)
        }}
      >
        <span className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{card.name}</span>
          {sourceLink && (
            <Badge
              variant={sourceLink.diverged ? "destructive" : "outline"}
              className="shrink-0 text-[9px]"
            >
              {describePlanSourceLinkStatus(sourceLink.status)}
            </Badge>
          )}
        </span>
        {card.description && (
          <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
            {card.description}
          </span>
        )}
        <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{card.project.gitRepo ?? card.project.name}</span>
          {card.primaryBranch && (
            <span className="flex min-w-0 items-center gap-0.5" title={card.primaryBranch}>
              <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{card.primaryBranch}</span>
            </span>
          )}
          <span className="ml-auto shrink-0">{timeAgo}</span>
        </span>
      </button>

      <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1" title={`${card.chats.total} linked chats`}>
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          {card.chats.active}
        </span>
        <span className="inline-flex items-center gap-1" title={`${card.runs.total} linked runs`}>
          <Play className="h-3 w-3" aria-hidden="true" />
          {card.runs.running > 0 ? `${card.runs.running} running` : card.runs.total}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {card.chats.latestId && (
            <button
              type="button"
              className="rounded p-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenChat(card)}
              aria-label={`Open latest chat for ${card.name}`}
              title="Open latest chat"
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          {sourceLink && (
            <button
              type="button"
              className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setComparisonOpen(true)}
              aria-label={`Compare plan source for ${card.name}`}
              title="Compare durable task with current plan source"
            >
              Compare
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onArchive(card)}
            aria-label={`Archive task ${card.name}`}
            title="Archive task"
          >
            <Archive className="h-3 w-3" />
          </button>
        </span>
      </div>
      {sourceLink && comparisonOpen && (
        <PlanSourceComparisonDialog link={sourceLink} onClose={() => setComparisonOpen(false)} />
      )}
    </article>
  )
})
