export function resolveLocalFolder(
  targetWorktreePath: string | null | undefined,
  chatWorktreePath: string | null | undefined,
  projectPath: string | null | undefined,
): string | undefined {
  return targetWorktreePath || chatWorktreePath || projectPath || undefined
}
