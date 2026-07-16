import { realpathSync, statSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Projects identify canonical folders. Symlink aliases collapse to the same
 * folder, while distinct folders and linked Git worktrees remain separate.
 */
export function resolveCanonicalProjectPath(inputPath: string): string {
  const selectedPath = realpathSync(resolve(inputPath))
  if (!statSync(selectedPath).isDirectory()) throw new Error("Project path must be a directory")
  return selectedPath
}

export function findProjectByCanonicalPath<T extends { path: string }>(
  candidates: readonly T[],
  canonicalPath: string,
): T | undefined {
  return candidates.find((candidate) => {
    try {
      return resolveCanonicalProjectPath(candidate.path) === canonicalPath
    } catch {
      return false
    }
  })
}
