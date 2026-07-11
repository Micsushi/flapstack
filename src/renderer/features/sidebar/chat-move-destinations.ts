export type ChatMoveTarget =
  | {
      scope: "global"
      label: string
      detail: string
    }
  | {
      scope: "project"
      projectId: string
      label: string
      detail: string
    }
  | {
      scope: "task"
      projectId: string
      taskId: string
      label: string
      detail: string
    }

type MoveProject = {
  id: string
  name: string
  gitRepo?: string | null
}

type MoveTask = {
  id: string
  name: string
  projectId: string
}

export type ChatMoveLocation = {
  scope?: "global" | "project" | "task" | null
  projectId?: string | null
  taskId?: string | null
}

export type ChatMoveMutationInput =
  | { id: string; scope: "global" }
  | { id: string; scope: "project"; projectId: string }
  | { id: string; scope: "task"; taskId: string }

export function buildChatMoveDestinations(
  projects: readonly MoveProject[] = [],
  tasks: readonly MoveTask[] = [],
): ChatMoveTarget[] {
  const tasksByProject = new Map<string, MoveTask[]>()

  for (const task of tasks) {
    const projectTasks = tasksByProject.get(task.projectId) ?? []
    projectTasks.push(task)
    tasksByProject.set(task.projectId, projectTasks)
  }

  const destinations: ChatMoveTarget[] = [
    { scope: "global", label: "Global chats", detail: "No project" },
  ]

  for (const project of projects) {
    const projectLabel = project.gitRepo?.trim() || project.name
    destinations.push({
      scope: "project",
      projectId: project.id,
      label: projectLabel,
      detail: "Project",
    })

    for (const task of tasksByProject.get(project.id) ?? []) {
      destinations.push({
        scope: "task",
        projectId: project.id,
        taskId: task.id,
        label: task.name,
        detail: `${projectLabel} · Task`,
      })
    }
  }

  return destinations
}

export function chatMoveTargetKey(target: ChatMoveTarget): string {
  if (target.scope === "global") return "global"
  if (target.scope === "project") return `project:${target.projectId}`
  return `task:${target.taskId}`
}

export function isCurrentChatMoveTarget(
  location: ChatMoveLocation,
  target: ChatMoveTarget,
): boolean {
  if (target.scope === "task") return location.taskId === target.taskId
  if (target.scope === "project") {
    return !location.taskId && location.projectId === target.projectId
  }
  return !location.projectId && !location.taskId
}

export function toChatMoveMutationInput(
  chatId: string,
  target: ChatMoveTarget,
): ChatMoveMutationInput {
  if (target.scope === "global") return { id: chatId, scope: "global" }
  if (target.scope === "project") {
    return { id: chatId, scope: "project", projectId: target.projectId }
  }
  return { id: chatId, scope: "task", taskId: target.taskId }
}
