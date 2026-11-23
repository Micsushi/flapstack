import { createHash } from "node:crypto"
import { realpathSync, statSync, watch, type FSWatcher } from "node:fs"
import { lstat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { setImmediate } from "node:timers/promises"
import { beginDatabaseAccessMaintenance } from "./db/access"
import { createGit } from "./git/git-factory"

const checkoutTails = new Map<string, Promise<void>>()
const finishing = new Map<string, Promise<void>>()

/** Keep same-checkout provider writes and Undo ordered through the postimage boundary. */
export async function acquireCheckpointCheckout(path: string): Promise<() => void> {
  const physical = realpathSync.native(path)
  const key = process.platform === "win32" ? physical.toLowerCase() : physical
  const previous = checkoutTails.get(key) ?? Promise.resolve()
  let unlock!: () => void
  const tail = new Promise<void>((resolve) => {
    unlock = resolve
  })
  checkoutTails.set(key, tail)
  await previous
  const releaseQueue = () => {
    unlock()
    if (checkoutTails.get(key) === tail) checkoutTails.delete(key)
  }
  try {
    const id = createHash("sha256").update(key).digest("hex")
    const lease = beginDatabaseAccessMaintenance(
      join(tmpdir(), "flapstack-checkout-leases", id),
      "checkpoint",
    )
    return () => {
      try {
        lease.release()
      } finally {
        releaseQueue()
      }
    }
  } catch (cause) {
    releaseQueue()
    throw new Error(
      "Another Flapstack process may be using this checkout. Retry after it finishes.",
      { cause },
    )
  }
}

export async function checkpointGitPaths(path: string) {
  const git = createGit(path)
  const locations = await git
    .raw([
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--path-format=absolute",
      "--git-common-dir",
      "--git-path",
      "index",
    ])
    .catch(async (error) => {
      if (await git.checkIsRepo()) throw error
      return ""
    })
  if (!locations) return undefined
  const [root, gitDir, common, index] = locations.trimEnd().split(/\r?\n/)
  if (!root || !gitDir || !common || !index) throw new Error("Could not locate checkout metadata.")
  return {
    root: resolve(root),
    gitDir: resolve(gitDir),
    common: resolve(common),
    index: resolve(index),
  }
}
export type CheckpointGitPaths = Awaited<ReturnType<typeof checkpointGitPaths>>

/** An editor or Git client can still change the checkout while the app's own writers are waiting. */
export function observePostimage(path: string, git: CheckpointGitPaths) {
  let changed = false
  const cutoff = BigInt(Date.now()) * 1_000_000n
  const root = resolve(path)
  const indexIdentity = () => {
    const info = git && statSync(git.index, { bigint: true, throwIfNoEntry: false })
    return info && [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":")
  }
  const initialIndex = indexIdentity()
  const watchers: FSWatcher[] = []
  const watchRoot = (root: string, relevant: (name: string) => boolean) => {
    const watcher = watch(root, { recursive: true, persistent: false }, (_event, file) => {
      if (!file || relevant(file.replaceAll("\\", "/"))) changed = true
    })
    watcher.on("error", () => {
      changed = true
    })
    watchers.push(watcher)
  }
  try {
    watchRoot(git?.root ?? path, (name) => !name.startsWith(".git/"))
    if (git) {
      for (const dir of new Set([git.gitDir, git.common])) {
        watchRoot(dir, (name) =>
          /^(?:HEAD$|index$|packed-refs$|config(?:\.worktree)?$|info\/attributes$|refs\/heads(?:\/|$)|reftable(?:\/|$))/i.test(
            name,
          ),
        )
      }
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close()
    throw error
  }
  return {
    async validate(paths: string[]) {
      // Native notifications can arrive after the capture. Check every path the
      // inverse would touch, including parents of deleted or renamed entries.
      const checked = new Set<string>()
      for (const name of paths) {
        if (!name) continue
        let current = resolve(root, name)
        if (!current.startsWith(root.endsWith(sep) ? root : root + sep))
          throw new Error("Invalid checkpoint change path.")
        while (!checked.has(current)) {
          checked.add(current)
          const info = await lstat(current, { bigint: true }).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
              throw error
            },
          )
          if (info && (info.ctimeNs >= cutoff || info.mtimeNs >= cutoff)) changed = true
          if (current === root) break
          current = dirname(current)
        }
      }
      await setImmediate()
      if (changed || indexIdentity() !== initialIndex)
        throw new Error("The checkout changed while this run's Undo was being saved.")
    },
    close: () => watchers.forEach((watcher) => watcher.close()),
  }
}

export function trackCheckpointFinalization(
  database: string,
  runId: string,
  completion: Promise<void>,
) {
  const key = resolve(database) + "\0" + runId
  const settled = completion
    .catch((error) => console.warn("[checkpoints] Finalization cleanup failed", error))
    .finally(() => finishing.delete(key))
  finishing.set(key, settled)
}

export async function waitForCheckpointFinalization(database?: string, runId?: string) {
  if (database && runId) await finishing.get(resolve(database) + "\0" + runId)
  else await Promise.allSettled(finishing.values())
}
