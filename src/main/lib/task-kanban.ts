import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import * as schema from "./db/schema"
import { agentRuns, chats, projects, tasks } from "./db/schema"
import { assertTaskStatusTransition, type TaskWorkflowStatus } from "../../shared/plan-kanban"
import { createRebalancedBoardOrders, type TaskKanbanCard } from "../../shared/task-kanban"

type Database = BetterSQLite3Database<typeof schema>

export class TaskKanbanError extends Error {
  constructor(
    readonly code: "not-found" | "stale-version" | "invalid-target",
    message: string,
  ) {
    super(message)
    this.name = "TaskKanbanError"
  }
}

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

export function listTaskKanban(
  database: Database,
  input: { projectId?: string; includeArchived?: boolean },
): TaskKanbanCard[] {
  const conditions = []
  if (input.projectId) conditions.push(eq(tasks.projectId, input.projectId))
  if (!input.includeArchived) conditions.push(isNull(tasks.archivedAt))

  const taskRows = database
    .select()
    .from(tasks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(tasks.status), asc(tasks.boardOrder), asc(tasks.createdAt), asc(tasks.id))
    .all()
  if (taskRows.length === 0) return []

  const projectIds = [...new Set(taskRows.map((task) => task.projectId))]
  const projectRows = database.select().from(projects).where(inArray(projects.id, projectIds)).all()
  const projectsById = new Map(projectRows.map((project) => [project.id, project]))

  const taskIds = taskRows.map((task) => task.id)
  const chatRows = database.select().from(chats).where(inArray(chats.taskId, taskIds)).all()
  const chatIds = chatRows.map((chat) => chat.id)
  const runRows = chatIds.length
    ? database.select().from(agentRuns).where(inArray(agentRuns.chatId, chatIds)).all()
    : []

  const chatsByTask = new Map<string, typeof chatRows>()
  for (const chat of chatRows) {
    if (!chat.taskId) continue
    const rows = chatsByTask.get(chat.taskId) ?? []
    rows.push(chat)
    chatsByTask.set(chat.taskId, rows)
  }
  const runsByChat = new Map<string, typeof runRows>()
  for (const run of runRows) {
    const rows = runsByChat.get(run.chatId) ?? []
    rows.push(run)
    runsByChat.set(run.chatId, rows)
  }

  return taskRows.map((task) => {
    const project = projectsById.get(task.projectId)
    if (!project) throw new TaskKanbanError("not-found", `Project ${task.projectId} is missing.`)
    const taskChats = chatsByTask.get(task.id) ?? []
    const activeChats = taskChats.filter((chat) => chat.archivedAt === null)
    const latestChat = [...activeChats].sort(
      (left, right) =>
        timestamp(right.updatedAt ?? right.createdAt) -
          timestamp(left.updatedAt ?? left.createdAt) || left.id.localeCompare(right.id),
    )[0]
    const taskRuns = taskChats.flatMap((chat) => runsByChat.get(chat.id) ?? [])
    const latestRun = [...taskRuns].sort(
      (left, right) =>
        timestamp(right.startedAt) - timestamp(left.startedAt) || left.id.localeCompare(right.id),
    )[0]

    return {
      id: task.id,
      projectId: task.projectId,
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      },
      name: task.name,
      description: task.description,
      status: task.status as TaskWorkflowStatus,
      boardOrder: task.boardOrder,
      version: task.version,
      primaryWorktreePath: task.primaryWorktreePath,
      primaryBranch: task.primaryBranch,
      sourceType: task.sourceType,
      sourcePath: task.sourcePath,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      chats: {
        total: taskChats.length,
        active: activeChats.length,
        latestId: latestChat?.id ?? null,
        latestName: latestChat?.name ?? null,
        latestUpdatedAt: latestChat?.updatedAt ?? latestChat?.createdAt ?? null,
      },
      runs: {
        total: taskRuns.length,
        running: taskRuns.filter((run) => run.status === "running").length,
        latestStatus: latestRun?.status ?? null,
        latestStartedAt: latestRun?.startedAt ?? null,
      },
    }
  })
}

export function moveTaskKanbanCard(
  database: Database,
  input: {
    id: string
    expectedVersion: number
    targetStatus: TaskWorkflowStatus
    beforeTaskId?: string
  },
) {
  return database.transaction((tx) => {
    const current = tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.id), isNull(tasks.archivedAt)))
      .get()
    if (!current) throw new TaskKanbanError("not-found", "Task is missing or archived.")
    if (current.version !== input.expectedVersion) {
      throw new TaskKanbanError("stale-version", "Task changed in another window. Board refreshed.")
    }
    try {
      assertTaskStatusTransition(current.status as TaskWorkflowStatus, input.targetStatus)
    } catch (error) {
      throw new TaskKanbanError(
        "invalid-target",
        error instanceof Error ? error.message : "Invalid task status transition.",
      )
    }

    const targetRows = tx
      .select({ id: tasks.id, boardOrder: tasks.boardOrder })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, current.projectId),
          eq(tasks.status, input.targetStatus),
          isNull(tasks.archivedAt),
          ne(tasks.id, current.id),
        ),
      )
      .orderBy(asc(tasks.boardOrder), asc(tasks.createdAt), asc(tasks.id))
      .all()

    const orderedIds = targetRows.map((task) => task.id)
    if (input.beforeTaskId) {
      const targetIndex = orderedIds.indexOf(input.beforeTaskId)
      if (targetIndex < 0) {
        throw new TaskKanbanError("invalid-target", "Drop target is missing or in another column.")
      }
      orderedIds.splice(targetIndex, 0, current.id)
    } else {
      orderedIds.push(current.id)
    }

    const orders = createRebalancedBoardOrders(orderedIds)
    for (const target of targetRows) {
      const nextOrder = orders.get(target.id)
      if (nextOrder && nextOrder !== target.boardOrder) {
        tx.update(tasks).set({ boardOrder: nextOrder }).where(eq(tasks.id, target.id)).run()
      }
    }

    const updated = tx
      .update(tasks)
      .set({
        status: input.targetStatus,
        boardOrder: orders.get(current.id),
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, current.id),
          eq(tasks.version, input.expectedVersion),
          isNull(tasks.archivedAt),
        ),
      )
      .returning()
      .get()
    if (!updated) {
      throw new TaskKanbanError("stale-version", "Task changed in another window. Board refreshed.")
    }
    return updated
  })
}

export function archiveTaskKanbanCard(
  database: Database,
  input: { id: string; expectedVersion: number },
) {
  const updated = database
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date(), version: sql`${tasks.version} + 1` })
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.version, input.expectedVersion),
        isNull(tasks.archivedAt),
      ),
    )
    .returning()
    .get()
  if (!updated) {
    throw new TaskKanbanError("stale-version", "Task changed in another window. Board refreshed.")
  }
  return updated
}
