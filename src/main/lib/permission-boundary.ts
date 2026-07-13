import { lstat, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

/** Resolve existing paths and the nearest existing parent without following an escape. */
export async function isWithinProjectBoundary(
  root: string,
  requestedPath: string,
): Promise<boolean> {
  try {
    const realRoot = await realpath(root)
    const lexicalTarget = resolve(realRoot, requestedPath)
    if (!inside(realRoot, lexicalTarget)) return false

    let current = lexicalTarget
    while (true) {
      let info
      try {
        info = await lstat(current)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
        const parent = dirname(current)
        if (parent === current || !inside(realRoot, parent)) return false
        current = parent
        continue
      }
      if (info.isSymbolicLink()) {
        try {
          return inside(realRoot, await realpath(current))
        } catch {
          return false
        }
      }
      return inside(realRoot, await realpath(current))
    }
  } catch {
    return false
  }
}
