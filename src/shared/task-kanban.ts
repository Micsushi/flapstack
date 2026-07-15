import type { TaskWorkflowStatus } from "./plan-kanban"

export const taskKanbanColumns = [
  { status: "backlog", title: "Backlog", description: "Captured work not yet planned" },
  { status: "planned", title: "Planned", description: "Ready to start" },
  { status: "in-progress", title: "In Progress", description: "Work currently underway" },
  { status: "review", title: "Review", description: "Waiting for review or proof" },
  { status: "done", title: "Done", description: "Completed work" },
] as const satisfies ReadonlyArray<{
  status: TaskWorkflowStatus
  title: string
  description: string
}>

export type TaskKanbanChatFilter = "all" | "with-chats" | "without-chats" | "running"
export type TaskKanbanSort = "board" | "updated" | "name"

export interface TaskKanbanCard {
  id: string
  projectId: string
  project: {
    id: string
    name: string
    path: string
    gitRemoteUrl: string | null
    gitProvider: string | null
    gitOwner: string | null
    gitRepo: string | null
  }
  name: string
  description: string | null
  status: TaskWorkflowStatus
  boardOrder: string
  version: number
  primaryWorktreePath: string | null
  primaryBranch: string | null
  sourceType: string | null
  sourcePath: string | null
  createdAt: Date | null
  updatedAt: Date | null
  chats: {
    total: number
    active: number
    latestId: string | null
    latestName: string | null
    latestUpdatedAt: Date | null
  }
  runs: {
    total: number
    running: number
    latestStatus: string | null
    latestStartedAt: Date | null
  }
}

export interface TaskKanbanFilters {
  search: string
  chatFilter: TaskKanbanChatFilter
  sort: TaskKanbanSort
}

export interface TaskKanbanMoveTarget {
  targetStatus: TaskWorkflowStatus
  beforeTaskId?: string
}

const ORDER_STEP = 1024

export function createRebalancedBoardOrders(taskIds: readonly string[]): Map<string, string> {
  return new Map(
    taskIds.map((taskId, index) => [
      taskId,
      `a${((index + 1) * ORDER_STEP).toString(36).padStart(8, "0")}`,
    ]),
  )
}

export function selectTaskKanbanCards(
  cards: readonly TaskKanbanCard[],
  filters: TaskKanbanFilters,
): TaskKanbanCard[] {
  const search = filters.search.trim().toLocaleLowerCase()
  const selected = cards.filter((card) => {
    if (
      search &&
      ![card.name, card.description, card.project.name, card.primaryBranch, card.sourcePath]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(search))
    ) {
      return false
    }
    if (filters.chatFilter === "with-chats") return card.chats.active > 0
    if (filters.chatFilter === "without-chats") return card.chats.active === 0
    if (filters.chatFilter === "running") return card.runs.running > 0
    return true
  })

  return [...selected].sort((left, right) => {
    if (filters.sort === "name")
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    if (filters.sort === "updated") {
      return (
        (right.updatedAt?.getTime() ?? right.createdAt?.getTime() ?? 0) -
          (left.updatedAt?.getTime() ?? left.createdAt?.getTime() ?? 0) ||
        left.id.localeCompare(right.id)
      )
    }
    return left.boardOrder.localeCompare(right.boardOrder) || left.id.localeCompare(right.id)
  })
}

export function getTaskKanbanKeyboardMove(
  card: Pick<TaskKanbanCard, "id" | "status">,
  orderedColumnTaskIds: readonly string[],
  key: string,
  altKey: boolean,
): TaskKanbanMoveTarget | null {
  if (!altKey) return null
  const columnIndex = taskKanbanColumns.findIndex((column) => column.status === card.status)
  if (key === "ArrowLeft" && columnIndex > 0) {
    return { targetStatus: taskKanbanColumns[columnIndex - 1].status }
  }
  if (key === "ArrowRight" && columnIndex < taskKanbanColumns.length - 1) {
    return { targetStatus: taskKanbanColumns[columnIndex + 1].status }
  }

  const cardIndex = orderedColumnTaskIds.indexOf(card.id)
  if (cardIndex < 0) return null
  if (key === "ArrowUp" && cardIndex > 0) {
    return { targetStatus: card.status, beforeTaskId: orderedColumnTaskIds[cardIndex - 1] }
  }
  if (key === "ArrowDown" && cardIndex < orderedColumnTaskIds.length - 1) {
    return {
      targetStatus: card.status,
      beforeTaskId: orderedColumnTaskIds[cardIndex + 2],
    }
  }
  return null
}

export function getTaskKanbanCardAriaLabel(card: TaskKanbanCard): string {
  const column = taskKanbanColumns.find((item) => item.status === card.status)
  const chatText = `${card.chats.active} active chat${card.chats.active === 1 ? "" : "s"}`
  const runText = `${card.runs.running} running run${card.runs.running === 1 ? "" : "s"}`
  return `${card.name}, ${column?.title ?? card.status}, ${card.project.name}, ${chatText}, ${runText}. Alt plus arrow keys moves this task.`
}
