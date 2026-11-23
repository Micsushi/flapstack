import { and, eq } from "drizzle-orm"
import { checkpoints, getDatabase } from "../db"
import { restoreCheckpoint } from "../checkpoints"
import { simpleGit } from "simple-git"
import { sleep } from "../../../shared/sleep"

const APPLY_RETRIES = 3
const APPLY_RETRY_DELAY_MS = 200

type CheckpointPayload = {
  sdkMessageUuid: string
  indexTree: string
  worktreeTree: string
}

function parseCheckpointTrees(message: string): {
  indexTree: string | null
  worktreeTree: string | null
} {
  const body = message.trim()
  if (body) {
    try {
      const parsed = JSON.parse(body) as CheckpointPayload
      if (parsed.indexTree && parsed.worktreeTree) {
        return {
          indexTree: parsed.indexTree,
          worktreeTree: parsed.worktreeTree,
        }
      }
    } catch {
      // Ignore invalid payload.
    }
  }
  return {
    indexTree: null,
    worktreeTree: null,
  }
}

export type RollbackResult =
  | { success: true; checkpointFound: true }
  | { success: true; checkpointFound: false }
  | { success: false; error: string }

export async function applyRollbackStash(
  worktreePath: string,
  sdkMessageUuid: string,
): Promise<RollbackResult> {
  try {
    const stored = getDatabase()
      .select({ id: checkpoints.id })
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.worktreePath, worktreePath),
          eq(checkpoints.sdkMessageUuid, sdkMessageUuid),
        ),
      )
      .get()
    if (stored) return { success: true, checkpointFound: await restoreCheckpoint(stored.id) }
    const git = simpleGit(worktreePath)

    const ref = `refs/checkpoints/${sdkMessageUuid}`
    let commitHash = ""
    try {
      commitHash = (await git.raw(["rev-parse", ref])).trim()
    } catch (error) {
      console.warn(`[claude] Rollback checkpoint not found for sdkMessageUuid=${sdkMessageUuid}`)
      // Checkpoint not found - return success but indicate no checkpoint was applied
      // The caller can decide whether to proceed with message truncation
      return { success: true, checkpointFound: false }
    }

    const commitMessage = await git.raw(["show", "-s", "--format=%B", commitHash])
    const { indexTree, worktreeTree } = parseCheckpointTrees(commitMessage)
    if (!indexTree || !worktreeTree) {
      console.error(
        `[claude] Rollback checkpoint missing tree metadata for sdkMessageUuid=${sdkMessageUuid}`,
      )
      return { success: false, error: "Checkpoint missing tree metadata" }
    }

    let lastError: unknown
    for (let attempt = 1; attempt <= APPLY_RETRIES; attempt += 1) {
      try {
        await git.raw(["read-tree", worktreeTree])
        await git.raw(["checkout-index", "-a", "-f"])
        await git.raw(["clean", "-fd"])
        await git.raw(["read-tree", indexTree])
        return { success: true, checkpointFound: true }
      } catch (error) {
        lastError = error
        if (attempt < APPLY_RETRIES) {
          await sleep(APPLY_RETRY_DELAY_MS)
        }
      }
    }
    throw lastError
  } catch (e) {
    console.error("[claude] Failed to apply rollback checkpoint:", e)
    const errorMessage = e instanceof Error ? e.message : "Unknown error"
    return { success: false, error: errorMessage }
  }
}
