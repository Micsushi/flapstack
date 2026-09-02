import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export const FLAPSTACK_GIT_EXCLUDE_BEGIN = "# BEGIN Flapstack project knowledge exclusion (owned):"
export const FLAPSTACK_GIT_EXCLUDE_END = "# END Flapstack project knowledge exclusion (owned):"
const FLAPSTACK_GIT_EXCLUDE_LOCK = "flapstack-project-vault-exclude.lock"
const LOCK_WAIT_TIMEOUT_MS = 10_000
const LOCK_STALE_AFTER_MS = 30_000
const COMPARE_AND_SWAP_ATTEMPTS = 8

export type ProjectVaultGitExclusionHooks = {
  /** Test seam for proving a user edit between read and atomic replace is retained. */
  beforeCompareAndSwap?: () => void
  /** Test seam for proving a user edit in the final comparison/replace window is recovered. */
  afterCompareBeforeCommit?: () => void
  /** Test seam for proving a failed post-write verification restores only our mutation. */
  beforeVerify?: () => void
}

type GitExclusionPlan = {
  projectRoot: string
  repositoryRoot: string
  commonDirectory: string
  excludePath: string
  pattern: string
  beginMarker: string
  endMarker: string
  ownedBlock: string
  probePath: string
}

type ExcludeSnapshot = {
  exists: boolean
  content: string
  mode: number
  deviceId: number
  inodeId: number
  size: number
  modifiedAt: number
  changedAt: number
}

export function ensureProjectVaultGitExclusion(
  projectRoot: string,
  hooks: ProjectVaultGitExclusionHooks = {},
): void {
  try {
    const plan = getGitExclusionPlan(projectRoot)
    prepareGitInfoDirectory(plan)
    withGitExclusionLock(plan, () => {
      let inserted = false
      try {
        inserted = updateExcludeFile(
          plan,
          (current) => {
            assertOwnedMarkersConsistent(current, plan)
            if (current.includes(plan.ownedBlock)) return current
            const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
            return `${current}${separator}${plan.ownedBlock}`
          },
          hooks,
        )
        const installed = readExcludeSnapshot(plan).content
        if (countOccurrences(installed, plan.ownedBlock) !== 1) {
          throw new Error("the Flapstack-owned rule is missing or duplicated")
        }
        hooks.beforeVerify?.()
        verifyOwnedIgnoreRule(plan)
      } catch (error) {
        if (!inserted) throw error
        try {
          updateExcludeFile(plan, (current) => removeExactOwnedBlock(current, plan))
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "the Flapstack-owned rule installation failed and rollback also failed",
          )
        }
        throw error
      }
    })
  } catch (error) {
    throw gitExclusionError("could not be installed and verified", error)
  }
}

export function removeProjectVaultGitExclusion(
  projectRoot: string,
  hooks: ProjectVaultGitExclusionHooks = {},
): void {
  removeProjectVaultGitExclusionOwnedBlock(projectRoot, hooks, true)
}

export function restoreProjectVaultGitExclusionForImportTransaction(
  operationId: string,
  projectRoot: string,
  action: "ensure" | "remove",
): void {
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) {
    throw new Error("Import transaction Git exclusion restore requires a valid operation ID.")
  }
  if (action === "ensure") ensureProjectVaultGitExclusion(projectRoot)
  else removeProjectVaultGitExclusionOwnedBlock(projectRoot, {}, false)
}

function removeProjectVaultGitExclusionOwnedBlock(
  projectRoot: string,
  hooks: ProjectVaultGitExclusionHooks,
  enforceTrackingTransition: boolean,
): void {
  try {
    const plan = getGitExclusionPlan(projectRoot)
    prepareGitInfoDirectory(plan)
    withGitExclusionLock(plan, () => {
      let removed = false
      try {
        const current = readExcludeSnapshot(plan).content
        assertOwnedMarkersConsistent(current, plan)
        if (enforceTrackingTransition && current.includes(plan.ownedBlock))
          assertNoLinkedWorktreeExposure(plan)
        removed = updateExcludeFile(plan, (current) => removeExactOwnedBlock(current, plan), hooks)
        hooks.beforeVerify?.()
        const updated = readExcludeSnapshot(plan).content
        if (updated.includes(plan.beginMarker) || updated.includes(plan.endMarker)) {
          throw new Error("the Flapstack-owned rule removal could not be verified")
        }
        if (enforceTrackingTransition) assertNoSiblingOwnedRuleForPattern(updated, plan)
      } catch (error) {
        if (!removed) throw error
        try {
          updateExcludeFile(plan, (current) => {
            assertOwnedMarkersConsistent(current, plan)
            if (current.includes(plan.ownedBlock)) return current
            const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
            return `${current}${separator}${plan.ownedBlock}`
          })
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "the Flapstack-owned rule removal failed and rollback also failed",
          )
        }
        throw error
      }
    })
  } catch (error) {
    throw gitExclusionError(
      enforceTrackingTransition
        ? "could not be removed and verified"
        : "transaction-owned rule could not be restored",
      error,
    )
  }
}

export function assertProjectVaultGitTrackingTransitionSupported(projectRoot: string): void {
  try {
    assertNoLinkedWorktreeExposure(getGitExclusionPlan(projectRoot))
  } catch (error) {
    throw gitExclusionError("tracking transition is unsupported", error)
  }
}

function getGitExclusionPlan(projectRootInput: string): GitExclusionPlan {
  const lexicalProjectRoot = resolve(projectRootInput)
  assertSafeGitMetadataPath(lexicalProjectRoot, "Project root", "directory")
  const projectRoot = realpathSync(lexicalProjectRoot)

  const repositoryRoot = realpathSync(
    resolve(runGit(projectRoot, ["rev-parse", "--show-toplevel"])),
  )
  const projectRelativePath = relative(repositoryRoot, projectRoot)
  if (
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath)
  ) {
    throw new Error("the project root is outside the repository worktree")
  }

  const commonDirectory = resolve(
    runGit(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  )
  const gitDirectory = resolve(runGit(projectRoot, ["rev-parse", "--absolute-git-dir"]))
  const relativeVaultPath = join(projectRelativePath, ".flapstack", "knowledge")
  const normalizedVaultPath = relativeVaultPath.split(sep).join("/")
  const pattern = `/${normalizedVaultPath}/`
  const ruleId = createHash("sha256")
    .update(`${gitDirectory}\0${pattern}`)
    .digest("hex")
    .slice(0, 16)
  const beginMarker = `${FLAPSTACK_GIT_EXCLUDE_BEGIN} ${ruleId}`
  const endMarker = `${FLAPSTACK_GIT_EXCLUDE_END} ${ruleId}`
  const ownedBlock = `${beginMarker}\n${pattern}\n${endMarker}\n`
  return {
    projectRoot,
    repositoryRoot,
    commonDirectory,
    excludePath: join(commonDirectory, "info", "exclude"),
    pattern,
    beginMarker,
    endMarker,
    ownedBlock,
    probePath: `${normalizedVaultPath}/.flapstack-git-exclude-probe`,
  }
}

function verifyOwnedIgnoreRule(plan: GitExclusionPlan): void {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-v", "-z", "--stdin"], {
    cwd: plan.projectRoot,
    input: Buffer.from(`${plan.probePath}\0`, "utf8"),
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error("git check-ignore did not confirm the vault path")

  const fields = result.stdout.toString("utf8").split("\0")
  if (fields.at(-1) === "") fields.pop()
  if (fields.length !== 4) throw new Error("git check-ignore returned an unexpected response")
  const [source, _line, pattern, path] = fields
  const sourcePath = resolve(plan.repositoryRoot, source)
  if (
    sourcePath !== resolve(plan.excludePath) ||
    pattern !== plan.pattern ||
    path !== plan.probePath
  ) {
    throw new Error("git check-ignore did not prove the Flapstack-owned local rule")
  }
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    throw new Error(detail || `git ${args.join(" ")} failed`)
  }
  const output = result.stdout.trim()
  if (!output) throw new Error(`git ${args.join(" ")} returned no path`)
  return output
}

function assertSafeGitMetadataPath(
  path: string,
  label: string,
  expectedType: "directory" | "file",
): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (expectedType === "directory" ? !info.isDirectory() : !info.isFile()) {
    throw new Error(`${label} is not a ${expectedType}`)
  }
}

function assertOwnedMarkersConsistent(content: string, plan: GitExclusionPlan): void {
  const hasBegin = content.includes(plan.beginMarker)
  const hasEnd = content.includes(plan.endMarker)
  const hasBlock = content.includes(plan.ownedBlock)
  if ((hasBegin || hasEnd) && !hasBlock) {
    throw new Error("the Flapstack-owned rule markers are incomplete or modified")
  }
}

function prepareGitInfoDirectory(plan: GitExclusionPlan): void {
  assertSafeGitMetadataPath(plan.commonDirectory, "Git common directory", "directory")
  const infoDirectory = dirname(plan.excludePath)
  if (!existsSync(infoDirectory)) mkdirSync(infoDirectory)
  assertSafeGitMetadataPath(infoDirectory, "Git info directory", "directory")
  if (!existsSync(plan.excludePath)) {
    try {
      writeFileSync(plan.excludePath, "", { encoding: "utf8", flag: "wx", mode: 0o600 })
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
    }
  }
  assertSafeGitMetadataPath(plan.excludePath, "Git local exclude", "file")
}

function withGitExclusionLock<T>(plan: GitExclusionPlan, action: () => T): T {
  const lockPath = join(dirname(plan.excludePath), FLAPSTACK_GIT_EXCLUDE_LOCK)
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
  let descriptor: number | null = null
  while (descriptor === null) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600)
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      let lock: ReturnType<typeof lstatSync>
      try {
        lock = lstatSync(lockPath)
      } catch (lockError) {
        if (isNotFoundError(lockError)) continue
        throw lockError
      }
      if (lock.isSymbolicLink() || !lock.isFile()) {
        throw new Error("the Git exclusion lock is not a regular file")
      }
      if (Date.now() - lock.mtimeMs > LOCK_STALE_AFTER_MS) {
        let ownerPid: number | null
        try {
          ownerPid = readLockOwnerPid(lockPath)
        } catch (lockError) {
          if (isNotFoundError(lockError)) continue
          if (isLockAccessBusyError(lockError)) {
            if (Date.now() >= deadline) {
              throw new Error("timed out waiting for the Git exclusion lock", {
                cause: lockError,
              })
            }
            sleepSync(20)
            continue
          }
          throw lockError
        }
        if (ownerPid === null || !isProcessAlive(ownerPid)) {
          try {
            const unchanged = lstatSync(lockPath)
            if (sameFilesystemEntry(lock, unchanged)) rmSync(lockPath)
          } catch (lockError) {
            if (!isNotFoundError(lockError)) throw lockError
          }
          continue
        }
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for the Git exclusion lock")
      sleepSync(20)
    }
  }

  const ownedIdentity = fstatSync(descriptor)
  let result: T | undefined
  let actionError: unknown
  try {
    writeFileSync(descriptor, `${process.pid}\n`, "utf8")
    fsyncSync(descriptor)
    result = action()
  } catch (error) {
    actionError = error
  }
  let cleanupError: unknown
  try {
    closeSync(descriptor)
    const current = lstatSync(lockPath)
    if (sameFilesystemEntry(ownedIdentity, current)) rmSync(lockPath)
  } catch (error) {
    if (!isNotFoundError(error)) cleanupError = error
  }
  if (actionError !== undefined) {
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [actionError, cleanupError],
        "Git exclusion action failed and its lock cleanup also failed.",
      )
    }
    throw actionError
  }
  if (cleanupError !== undefined) throw cleanupError
  return result as T
}

function updateExcludeFile(
  plan: GitExclusionPlan,
  transform: (current: string) => string,
  hooks: Pick<
    ProjectVaultGitExclusionHooks,
    "beforeCompareAndSwap" | "afterCompareBeforeCommit"
  > = {},
): boolean {
  let recoveredContent: string | null = null
  let changed = false
  for (let attempt = 0; attempt < COMPARE_AND_SWAP_ATTEMPTS; attempt += 1) {
    const snapshot = readExcludeSnapshot(plan)
    const sourceContent = recoveredContent ?? snapshot.content
    const next = transform(sourceContent)
    if (next === snapshot.content) return changed
    const temporaryPath = join(dirname(plan.excludePath), `.flapstack-exclude-${randomUUID()}.tmp`)
    const recoveryPath = join(dirname(plan.excludePath), `.flapstack-exclude-${randomUUID()}.bak`)
    try {
      writeFileSync(temporaryPath, next, {
        encoding: "utf8",
        flag: "wx",
        mode: snapshot.mode,
      })
      hooks.beforeCompareAndSwap?.()
      const latest = readExcludeSnapshot(plan)
      if (!sameExcludeSnapshot(latest, snapshot)) continue
      hooks.afterCompareBeforeCommit?.()
      const beforeCommit = readExcludeSnapshot(plan)
      if (!sameExcludeSnapshot(beforeCommit, latest)) {
        recoveredContent = beforeCommit.content
        continue
      }
      renameSync(plan.excludePath, recoveryPath)
      try {
        linkSync(temporaryPath, plan.excludePath)
      } catch (error) {
        if (!existsSync(plan.excludePath)) renameSync(recoveryPath, plan.excludePath)
        else recoveredContent = readExcludeSnapshot(plan).content
        if (recoveredContent !== null) continue
        throw error
      }
      changed = true
      const displacedContent = readExcludeSnapshotAt(recoveryPath).content
      const committed = readExcludeSnapshot(plan)
      if (committed.content !== next) {
        recoveredContent = committed.content
        continue
      }
      if (displacedContent !== latest.content) {
        recoveredContent = displacedContent
        continue
      }
      return changed
    } finally {
      rmSync(temporaryPath, { force: true })
      rmSync(recoveryPath, { force: true })
    }
  }
  throw new Error("the Git local exclude changed concurrently too many times")
}

function readExcludeSnapshot(plan: GitExclusionPlan): ExcludeSnapshot {
  return readExcludeSnapshotAt(plan.excludePath)
}

function readExcludeSnapshotAt(path: string): ExcludeSnapshot {
  for (let attempt = 0; attempt < COMPARE_AND_SWAP_ATTEMPTS; attempt += 1) {
    assertSafeGitMetadataPath(path, "Git local exclude", "file")
    const before = lstatSync(path)
    const content = readFileSync(path, "utf8")
    const after = lstatSync(path)
    if (
      sameFilesystemEntry(before, after) &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs
    ) {
      return {
        exists: true,
        content,
        mode: after.mode,
        deviceId: after.dev,
        inodeId: after.ino,
        size: after.size,
        modifiedAt: after.mtimeMs,
        changedAt: after.ctimeMs,
      }
    }
  }
  throw new Error("the Git local exclude changed concurrently too many times")
}

function sameExcludeSnapshot(left: ExcludeSnapshot, right: ExcludeSnapshot): boolean {
  return (
    left.exists === right.exists &&
    left.content === right.content &&
    left.deviceId === right.deviceId &&
    left.inodeId === right.inodeId &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt
  )
}

function removeExactOwnedBlock(content: string, plan: GitExclusionPlan): string {
  assertOwnedMarkersConsistent(content, plan)
  const occurrences = countOccurrences(content, plan.ownedBlock)
  if (occurrences === 0) return content
  if (occurrences !== 1) throw new Error("the Flapstack-owned rule is duplicated")
  return content.replace(plan.ownedBlock, "")
}

function assertNoSiblingOwnedRuleForPattern(content: string, plan: GitExclusionPlan): void {
  const siblingBlock = new RegExp(
    `${escapeRegExp(FLAPSTACK_GIT_EXCLUDE_BEGIN)} ([a-f0-9]{16})\\r?\\n${escapeRegExp(plan.pattern)}\\r?\\n${escapeRegExp(FLAPSTACK_GIT_EXCLUDE_END)} \\1(?:\\r?\\n|$)`,
  )
  if (siblingBlock.test(content)) {
    throw new Error(
      "tracking cannot be enabled independently while a linked worktree owns the same shared Git exclusion",
    )
  }
}

function assertNoLinkedWorktreeExposure(plan: GitExclusionPlan): void {
  const worktrees = runGit(plan.projectRoot, ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
  if (worktrees.length > 1) {
    throw new Error(
      "tracking cannot be enabled while a linked worktree shares the common Git exclusion",
    )
  }
}

function sameFilesystemEntry(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isLockAccessBusyError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EBUSY" || error.code === "EPERM")
  )
}

function readLockOwnerPid(lockPath: string): number | null {
  const raw = readFileSync(lockPath, "utf8").trim()
  if (!/^[1-9]\d*$/.test(raw)) return null
  const pid = Number(raw)
  return Number.isSafeInteger(pid) ? pid : null
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function countOccurrences(content: string, value: string): number {
  return content.split(value).length - 1
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function gitExclusionError(action: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(`Project vault Git local exclusion ${action}: ${detail}`, { cause })
}
