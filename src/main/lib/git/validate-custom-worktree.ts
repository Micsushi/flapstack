import { realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { simpleGit } from "simple-git"
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
    // An ordinary checkout can report both facts in one Git process. The final
    // line is the ref name. The root itself may contain a newline on Unix.
    const location = await git.revparse(["--show-toplevel", "--abbrev-ref", "HEAD"]).catch(() => "")
    const endOfRoot = location.lastIndexOf("\n")
    if (endOfRoot !== -1) {
      const root = location.slice(0, endOfRoot).replace(/\r$/, "")
      const branch = location.slice(endOfRoot + 1).trim()
      return { valid: true, path: await realpath(root), branch: branch === "HEAD" ? null : branch }
    }
    // Unborn HEAD cannot resolve a ref yet. Preserve its validated checkout root.
    if (!(await git.checkIsRepo())) {
      return {
        valid: false,
        path: resolvedPath,
        error:
          "Choose the Git repository folder itself, not its parent folder. For example, choose …/GitHub/flapstack instead of …/GitHub.",
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
