import { isAbsolute, resolve, sep } from "node:path"

export function resolveInsideRoot(rootPath: string, targetRelativePath: string): string {
  if (targetRelativePath.includes("\0")) {
    throw new Error("Path contains invalid characters")
  }

  if (isAbsolute(targetRelativePath)) {
    throw new Error("Target path must be relative")
  }

  const resolvedRoot = resolve(rootPath)
  const resolvedTarget = resolve(resolvedRoot, targetRelativePath)

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error("Target path escapes root")
  }

  return resolvedTarget
}
