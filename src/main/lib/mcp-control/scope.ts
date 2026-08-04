export type McpCanonicalChatScope = {
  chatId: string
  kind: "global" | "project" | "task"
  projectId: string | null
  taskId: string | null
}

export function canonicalMcpChatScope(row: Record<string, unknown>): McpCanonicalChatScope | null {
  const chatId = typeof row.id === "string" ? row.id : null
  const projectId = typeof row.project_id === "string" ? row.project_id : null
  const taskId = typeof row.task_id === "string" ? row.task_id : null
  if (!chatId) return null
  if (row.scope === "global" && !projectId && !taskId) {
    return { chatId, kind: "global", projectId: null, taskId: null }
  }
  if (row.scope === "project" && projectId && !taskId && row.valid_project_id === projectId) {
    return { chatId, kind: "project", projectId, taskId: null }
  }
  if (
    row.scope === "task" &&
    projectId &&
    taskId &&
    row.valid_project_id === projectId &&
    row.task_project_id === projectId
  ) {
    return { chatId, kind: "task", projectId, taskId }
  }
  return null
}
