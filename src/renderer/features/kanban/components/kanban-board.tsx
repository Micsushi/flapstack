import { memo, useMemo, useState } from "react"
import { KanbanColumn } from "./kanban-column"
import type { TaskKanbanCardData } from "./kanban-card"
import { taskKanbanColumns, type TaskKanbanMoveTarget } from "../../../../shared/task-kanban"
import type { TaskWorkflowStatus } from "../../../../shared/plan-kanban"

interface KanbanBoardProps {
  cards: TaskKanbanCardData[]
  moveEnabled: boolean
  onOpenTask: (card: TaskKanbanCardData) => void
  onOpenChat: (card: TaskKanbanCardData) => void
  onMove: (card: TaskKanbanCardData, target: TaskKanbanMoveTarget) => void
  onArchive: (card: TaskKanbanCardData) => void
}

export const KanbanBoard = memo(function KanbanBoard({
  cards,
  moveEnabled,
  onOpenTask,
  onOpenChat,
  onMove,
  onArchive,
}: KanbanBoardProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const cardsByStatus = useMemo(() => {
    const grouped = new Map<TaskWorkflowStatus, TaskKanbanCardData[]>(
      taskKanbanColumns.map((column) => [column.status, []]),
    )
    for (const card of cards) grouped.get(card.status)?.push(card)
    return grouped
  }, [cards])

  const handleDrop = (status: TaskWorkflowStatus, beforeTaskId?: string) => {
    const card = cards.find((item) => item.id === draggedTaskId)
    setDraggedTaskId(null)
    if (!card || card.id === beforeTaskId) return
    onMove(card, { targetStatus: status, beforeTaskId })
  }

  return (
    <div className="h-full overflow-x-auto" role="region" aria-label="Task Kanban board">
      <div className="mx-auto flex h-full min-w-min max-w-[1500px] gap-3 px-4 py-2">
        {taskKanbanColumns.map((column) => (
          <KanbanColumn
            key={column.status}
            title={column.title}
            description={column.description}
            status={column.status}
            cards={cardsByStatus.get(column.status) ?? []}
            moveEnabled={moveEnabled}
            onOpenTask={onOpenTask}
            onOpenChat={onOpenChat}
            onMove={onMove}
            onArchive={onArchive}
            onDragStart={setDraggedTaskId}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  )
})
