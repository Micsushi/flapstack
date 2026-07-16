export function getNonMainWorktreeLabel({
  projectPath,
  worktreePath,
}: {
  projectPath?: string | null
  worktreePath?: string | null
}): string | null {
  const project = normalizePath(projectPath)
  const worktree = normalizePath(worktreePath)
  if (!project || !worktree || project === worktree) return null

  return worktree.split("/").filter(Boolean).at(-1) ?? null
}

function normalizePath(path?: string | null): string | null {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized || null
}
