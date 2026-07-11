import { lstat, mkdir, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

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

/** Resolve and create a write parent without following symlinks inside the root. */
export async function prepareSafeWritePath(
  rootPath: string,
  targetRelativePath: string,
): Promise<string> {
  const lexicalRoot = resolve(rootPath)
  const lexicalTarget = resolveInsideRoot(lexicalRoot, targetRelativePath)
  const realRoot = await realpath(lexicalRoot)
  const parentParts = relative(lexicalRoot, dirname(lexicalTarget)).split(sep).filter(Boolean)
  let current = realRoot

  for (const part of parentParts) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error("Attachment target contains a symbolic link")
      if (!info.isDirectory()) throw new Error("Attachment target parent is not a directory")
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      await mkdir(current, { mode: 0o700 })
    }
    const resolvedCurrent = await realpath(current)
    if (resolvedCurrent !== realRoot && !resolvedCurrent.startsWith(realRoot + sep)) {
      throw new Error("Attachment target escapes root through a symbolic link")
    }
  }

  const target = join(current, basename(lexicalTarget))
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error("Attachment target cannot be a symbolic link")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  return target
}
