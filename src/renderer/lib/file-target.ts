export type RootedFileTarget = { rootPath: string; relativePath: string }
export type DurableFileTarget = RootedFileTarget | { subChatId: string; filePath: string }

function slash(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^[/\\]{2}/.test(path)
}

export function toRootedFileTarget(
  rootPath: string | null | undefined,
  filePath: string | null | undefined,
): RootedFileTarget | null {
  if (!rootPath || !filePath) return null
  if (!isAbsolutePath(filePath)) return { rootPath, relativePath: filePath }

  const normalizedRoot = slash(rootPath)
  const normalizedFile = slash(filePath)
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot)
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot
  const comparableFile = caseInsensitive ? normalizedFile.toLowerCase() : normalizedFile
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null
  return { rootPath, relativePath: normalizedFile.slice(normalizedRoot.length + 1) }
}

export function toDurablePlanFileTarget(
  worktreePath: string | null | undefined,
  subChatId: string | null | undefined,
  filePath: string | null | undefined,
): DurableFileTarget | null {
  const rooted = toRootedFileTarget(worktreePath, filePath)
  if (rooted) return rooted
  if (subChatId && filePath && isAbsolutePath(filePath)) return { subChatId, filePath }
  return null
}
