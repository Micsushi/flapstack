export interface StoredOperationScopeIdentity {
  chatId: string
  taskId: string | null
  connectionKey: string
}

export interface ResolvedOperationScope {
  chatId: string
  taskId: string | null
  projectPath: string | null
  connectionKey: string
}

export function resolveStoredOperationScope<TScope extends ResolvedOperationScope>(
  row: StoredOperationScopeIdentity,
  resolveChatScope: (chatId: string) => TScope,
): TScope {
  const scope = resolveChatScope(row.chatId)
  if (scope.chatId !== row.chatId || scope.connectionKey !== row.connectionKey) {
    throw new Error("Stored Flapshot operation no longer belongs to its chat connection")
  }
  return { ...scope, taskId: row.taskId }
}
