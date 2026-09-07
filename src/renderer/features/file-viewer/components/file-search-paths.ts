import { isWindowsFilePath, toRootedFileTarget } from "../../../lib/file-target"

export function joinFileSearchPath(projectPath: string, relativePath: string): string {
  const root = isWindowsFilePath(projectPath)
    ? projectPath.replace(/[\\/]+$/, "")
    : projectPath.replace(/\/+$/, "")
  return `${root}/${relativePath}`
}

export function fileSearchPathKey(projectPath: string, path: string): string {
  return isWindowsFilePath(projectPath)
    ? path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    : path.replace(/\/+$/, "")
}

export function recentFileSearchItems(projectPath: string, paths: string[], query: string) {
  const items: { id: string; label: string; path: string }[] = []
  const seen = new Set<string>()
  for (const absolutePath of paths) {
    const target = toRootedFileTarget(projectPath, absolutePath)
    if (!target || !/^(?:[A-Za-z]:[\\/]|[/\\])/.test(absolutePath)) continue
    const path = target.relativePath
    const key = fileSearchPathKey(projectPath, path)
    if (seen.has(key) || !path.toLowerCase().includes(query.toLowerCase())) continue
    seen.add(key)
    items.push({ id: `recent-${key}`, label: path.slice(path.lastIndexOf("/") + 1), path })
  }
  return items
}
