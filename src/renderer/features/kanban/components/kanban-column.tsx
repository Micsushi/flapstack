import { memo } from "react"
import { cn } from "../../../lib/utils"
import { KanbanCard, type TaskKanbanCardData } from "./kanban-card"
import type { TaskKanbanMoveTarget } from "../../../../shared/task-kanban"
import type { TaskWorkflowStatus } from "../../../../shared/plan-kanban"

interface KanbanColumnProps {
  title: string
  description: string
  status: TaskWorkflowStatus
  cards: TaskKanbanCardData[]
  moveEnabled: boolean
  onOpenTask: (card: TaskKanbanCardData) => void
  onOpenChat: (card: TaskKanbanCardData) => void
  onMove: (card: TaskKanbanCardData, target: TaskKanbanMoveTarget) => void
  onArchive: (card: TaskKanbanCardData) => void
  onDragStart: (taskId: string) => void
  onDrop: (status: TaskWorkflowStatus, beforeTaskId?: string) => void
}

const statusColors: Record<TaskWorkflowStatus, string> = {
  backlog: "bg-muted-foreground/40",
  planned: "bg-violet-500",
  "in-progress": "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
}

export const KanbanColumn = memo(function KanbanColumn({
  title,
  description,
  status,
  cards,
  moveEnabled,
  onOpenTask,
  onOpenChat,
  onMove,
  onArchive,
  onDragStart,
  onDrop,
}: KanbanColumnProps) {
  const headingId = `task-kanban-${status}`
  const taskIds = cards.map((card) => card.id)

  return (
    <section
      className="flex h-full min-w-[210px] max-w-[290px] flex-1 flex-col"
      aria-labelledby={headingId}
      onDragOver={(event) => {
        if (moveEnabled) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(status)
      }}
    >
      <div className="mb-2 px-2 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColors[status])} />
          <h2 id={headingId} className="text-sm font-medium">
            {title}
          </h2>
          <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground">
            {cards.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-1 pb-4" role="list">
        {cards.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
            No tasks
          </div>
        ) : (
          cards.map((card) => (
            <div key={card.id} role="listitem">
              <KanbanCard
                card={card}
                orderedColumnTaskIds={taskIds}
                moveEnabled={moveEnabled}
                onOpenTask={onOpenTask}
                onOpenChat={onOpenChat}
                onMove={onMove}
                onArchive={onArchive}
                onDragStart={onDragStart}
                onDropBefore={(beforeTaskId) => onDrop(status, beforeTaskId)}
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
})
