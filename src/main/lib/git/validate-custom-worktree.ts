import { realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import simpleGit from "simple-git"
import { getCurrentBranch } from "./worktree"

export type CustomWorktreeValidation =
  | { valid: true; path: string; branch: string | null }
  | { valid: false; path: string; error: string }

/** Validate an explicitly entered checkout before it becomes a run cwd. */
export async function validateCustomWorktreePath(
  requestedPath: string,
): Promise<CustomWorktreeValidation> {
  if (!isAbsolute(requestedPath)) {
    return { valid: false, path: requestedPath, error: "Enter an absolute path." }
  }

  try {
    const info = await stat(requestedPath)
    if (!info.isDirectory()) {
      return { valid: false, path: requestedPath, error: "The selected path is not a directory." }
    }
    const resolvedPath = await realpath(requestedPath)
    const git = simpleGit(resolvedPath)
    if (!(await git.checkIsRepo())) {
      return {
        valid: false,
        path: resolvedPath,
        error: "The selected directory is not a Git checkout.",
      }
    }
    const checkoutRoot = await realpath((await git.revparse(["--show-toplevel"])).trim())
    const branch = await getCurrentBranch(checkoutRoot)
    return { valid: true, path: checkoutRoot, branch }
  } catch (error) {
    return {
      valid: false,
      path: requestedPath,
      error:
        error instanceof Error
          ? `Could not use this Git checkout: ${error.message}`
          : "Could not use this Git checkout.",
    }
  }
}
