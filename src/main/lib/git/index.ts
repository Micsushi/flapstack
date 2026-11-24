/**
 * Git module - combines all git-related routers
 * Flattened structure to match Superset API (changes.getStatus, changes.stageFile, etc.)
 */
import { router } from "../trpc"
import { createBranchesRouter } from "./branches"
import { createFileContentsRouter } from "./file-contents"
import { createGitOperationsRouter } from "./git-operations"
import { createStagingRouter } from "./staging"
import { createStatusRouter } from "./status"

// Re-export worktree utilities
export * from "./worktree"
export * from "./worktree-naming"

// Re-export GitHub utilities
export * from "./github"

// Re-export types
export type {
  GitChangesStatus,
  ChangedFile,
  CommitInfo,
  FileContents,
} from "../../../shared/changes-types"

/**
 * Combined git router with flattened procedures
 * This matches Superset's changes router API structure
 */
export const createGitRouter = () => {
  return router({
    // Merge all sub-router procedures at top level
    ...createStatusRouter()._def.procedures,
    ...createStagingRouter()._def.procedures,
    ...createGitOperationsRouter()._def.procedures,
    ...createBranchesRouter()._def.procedures,
    ...createFileContentsRouter()._def.procedures,
  })
}

export * from "./remote-info"
