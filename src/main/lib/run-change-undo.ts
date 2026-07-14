import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { agentRuns, checkpoints, fileChangeManifests, getDatabase } from "./db"
import { captureWorktreeTree, type CheckpointStatusSnapshot } from "./checkpoints"

const execFileAsync = promisify(execFile)
const worktreeLocks = new Map<string, Promise<void>>()

export type UndoFileState = {
  content: Buffer
  kind: "file" | "symlink"
  mode: number
}

type FilePlan = {
  filePath: string
  worktreeRoot: string
  absolutePath: string
  current: UndoFileState | null
  result: UndoFileState | null
}

function parseSnapshot(value: string | null): CheckpointStatusSnapshot {
  if (!value) return { available: false, files: {} }
  try {
    const parsed = JSON.parse(value) as CheckpointStatusSnapshot
    return parsed?.files ? parsed : { available: false, files: {} }
  } catch {
    return { available: false, files: {} }
  }
}

async function withWorktreeLock<T>(worktreePath: string, task: () => Promise<T>): Promise<T> {
  const previous = worktreeLocks.get(worktreePath) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  const queued = previous.then(() => current)
  worktreeLocks.set(worktreePath, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (worktreeLocks.get(worktreePath) === queued) worktreeLocks.delete(worktreePath)
  }
}

async function assertSafeParentPath(worktreeRoot: string, absolutePath: string): Promise<void> {
  if (absolutePath === worktreeRoot || !absolutePath.startsWith(`${worktreeRoot}${sep}`)) {
    throw new Error(`Unsafe undo path: ${absolutePath}`)
  }
  const parentPath = dirname(absolutePath)
  const parentRelative = relative(worktreeRoot, parentPath)
  if (!parentRelative) return

  let current = worktreeRoot
  for (const segment of parentRelative.split(sep)) {
    current = join(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error(`Unsafe symlink parent: ${current}`)
      if (!stat.isDirectory()) throw new Error(`Unsafe non-directory parent: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
  }
}

export async function resolveSafeUndoPath(
  worktreePath: string,
  filePath: string,
): Promise<{ worktreeRoot: string; absolutePath: string }> {
  const worktreeRoot = await realpath(worktreePath)
  const root = resolve(worktreeRoot)
  const absolutePath = resolve(root, filePath)
  if (absolutePath === root || !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe change path: ${filePath}`)
  }
  await assertSafeParentPath(root, absolutePath)
  return { worktreeRoot: root, absolutePath }
}

export async function readUndoFileState(path: string): Promise<UndoFileState | null> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      return {
        content: Buffer.from(await readlink(path)),
        kind: "symlink",
        mode: 0o777,
      }
    }
    if (!stat.isFile()) throw new Error(`Undo supports only files and symlinks: ${path}`)
    return {
      content: await readFile(path),
      kind: "file",
      mode: stat.mode & 0o777,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function readTreeFile(
  worktreePath: string,
  treeCommit: string,
  filePath: string,
): Promise<UndoFileState | null> {
  try {
    const { stdout: treeOutput } = await execFileAsync(
      "git",
      ["ls-tree", "-z", treeCommit, "--", `:(literal)${filePath}`],
      {
        cwd: worktreePath,
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
      },
    )
    const entry = treeOutput.subarray(
      0,
      treeOutput.indexOf(0) < 0 ? undefined : treeOutput.indexOf(0),
    )
    if (entry.length === 0) return null
    const tabIndex = entry.indexOf(9)
    if (tabIndex < 0) throw new Error(`Invalid checkpoint entry for ${filePath}`)
    const header = entry.subarray(0, tabIndex).toString()
    const [mode, type, object] = header.split(" ")
    if (!mode || type !== "blob" || !object) {
      throw new Error(`Unsupported checkpoint entry for ${filePath}`)
    }
    const { stdout } = await execFileAsync("git", ["cat-file", "blob", object], {
      cwd: worktreePath,
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    })
    return {
      content: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
      kind: mode === "120000" ? "symlink" : "file",
      mode: mode === "100755" ? 0o755 : mode === "120000" ? 0o777 : 0o644,
    }
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? ""
    if (/does not exist|exists on disk, but not in|Path .* does not exist/.test(stderr)) return null
    throw error
  }
}

function sameState(left: UndoFileState | null, right: UndoFileState | null): boolean {
  if (left === null || right === null) return left === right
  return left.kind === right.kind && left.content.equals(right.content)
}

function executableMode(mode: number): boolean {
  return (mode & 0o111) !== 0
}

export async function planInverseFileState(
  current: UndoFileState | null,
  after: UndoFileState | null,
  before: UndoFileState | null,
): Promise<{ result?: UndoFileState | null; conflict?: string }> {
  if (current && after && current.kind !== after.kind) {
    return { conflict: "File type changed after this response" }
  }
  if (
    current?.kind === "file" &&
    after?.kind === "file" &&
    executableMode(current.mode) !== executableMode(after.mode)
  ) {
    return { conflict: "File mode changed after this response" }
  }
  if (
    !sameState(current, after) &&
    [current, after, before].some((state) => state?.kind === "symlink")
  ) {
    return { conflict: "Symlink changed after this response" }
  }

  const merged = await planInverseFileContent(
    current?.content ?? null,
    after?.content ?? null,
    before?.content ?? null,
  )
  if (merged.conflict) return { conflict: merged.conflict }
  if (merged.result === undefined) return { conflict: "Undo result is unavailable" }
  if (merged.result === null) return { result: null }
  if (!before) return { conflict: "Checkpoint file metadata is missing" }

  let mode = before.mode
  if (
    before.kind === "file" &&
    after?.kind === "file" &&
    current?.kind === "file" &&
    executableMode(before.mode) === executableMode(after.mode)
  ) {
    mode = current.mode
  }
  return { result: { content: merged.result, kind: before.kind, mode } }
}

function isText(buffer: Buffer): boolean {
  return !buffer.includes(0)
}

export async function planInverseFileContent(
  current: Buffer | null,
  after: Buffer | null,
  before: Buffer | null,
): Promise<{ result?: Buffer | null; conflict?: string }> {
  if (current === null && after === null) return { result: before }
  if (current !== null && after !== null && current.equals(after)) return { result: before }

  if (before === null || after === null || current === null) {
    return { conflict: "File existence changed after this response" }
  }
  if (!isText(current) || !isText(after) || !isText(before)) {
    return { conflict: "Binary file changed after this response" }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "flapstack-undo-merge-"))
  try {
    const currentPath = join(tempDir, "current")
    const afterPath = join(tempDir, "after")
    const beforePath = join(tempDir, "before")
    await Promise.all([
      writeFile(currentPath, current),
      writeFile(afterPath, after),
      writeFile(beforePath, before),
    ])
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["merge-file", "-p", currentPath, afterPath, beforePath],
        { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 },
      )
      return { result: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout) }
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 1) return { conflict: "Later changes overlap this response" }
      throw error
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function writeUndoFileState(
  worktreeRoot: string,
  absolutePath: string,
  state: UndoFileState | null,
): Promise<void> {
  await assertSafeParentPath(worktreeRoot, absolutePath)
  if (state === null) {
    await rm(absolutePath, { force: true })
    return
  }

  await mkdir(dirname(absolutePath), { recursive: true })
  await assertSafeParentPath(worktreeRoot, absolutePath)
  const tempPath = `${absolutePath}.flapstack-undo-${randomUUID()}`
  try {
    if (state.kind === "symlink") await symlink(state.content.toString(), tempPath)
    else {
      await writeFile(tempPath, state.content, { mode: state.mode })
      await chmod(tempPath, state.mode)
    }
    await assertSafeParentPath(worktreeRoot, absolutePath)
    await rename(tempPath, absolutePath)
  } finally {
    await rm(tempPath, { force: true })
  }
}

async function writePlan(plans: FilePlan[]): Promise<void> {
  const applied: FilePlan[] = []
  try {
    for (const plan of plans) {
      await writeUndoFileState(plan.worktreeRoot, plan.absolutePath, plan.result)
      applied.push(plan)
    }
  } catch (error) {
    for (const plan of applied.reverse()) {
      await writeUndoFileState(plan.worktreeRoot, plan.absolutePath, plan.current)
    }
    throw error
  }
}

export function getRunChangeSet(runId: string) {
  const db = getDatabase()
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
  if (!run) throw new Error("Run not found")
  const runCheckpoints = db.select().from(checkpoints).where(eq(checkpoints.runId, runId)).all()
  const beforeTree = parseSnapshot(
    runCheckpoints.find((checkpoint) => checkpoint.kind === "before")?.gitStatusJson ?? null,
  ).treeCommit
  const afterTree = parseSnapshot(
    runCheckpoints.find((checkpoint) => checkpoint.kind === "after")?.gitStatusJson ?? null,
  ).treeCommit
  const files = db
    .select()
    .from(fileChangeManifests)
    .where(eq(fileChangeManifests.runId, runId))
    .all()
    .filter((entry) => entry.changeType !== "none" && entry.filePath)
  return {
    run,
    files,
    fileCount: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    recoverable: Boolean(beforeTree && afterTree),
  }
}

export async function getRunChangeReview(runId: string, filePath?: string) {
  const changeSet = getRunChangeSet(runId)
  const worktreePath = changeSet.run.worktreePath
  if (!worktreePath) throw new Error("Run has no worktree")
  if (filePath && !changeSet.files.some((file) => file.filePath === filePath)) {
    throw new Error("File is not part of this run")
  }
  const db = getDatabase()
  const runCheckpoints = db.select().from(checkpoints).where(eq(checkpoints.runId, runId)).all()
  const beforeTree = parseSnapshot(
    runCheckpoints.find((checkpoint) => checkpoint.kind === "before")?.gitStatusJson ?? null,
  ).treeCommit
  const afterTree = parseSnapshot(
    runCheckpoints.find((checkpoint) => checkpoint.kind === "after")?.gitStatusJson ?? null,
  ).treeCommit
  if (!beforeTree || !afterTree) return { ...changeSet, diff: null }
  const diffArgs = [
    "diff",
    "--no-color",
    "--find-renames",
    beforeTree,
    afterTree,
    "--",
    ...(filePath ? [`:(literal)${filePath}`] : []),
  ]
  const diff = await simpleGit(worktreePath).raw(diffArgs)
  return { ...changeSet, diff }
}

export async function undoRunChangeSet(runId: string) {
  const changeSet = getRunChangeSet(runId)
  const worktreePath = changeSet.run.worktreePath
  if (!worktreePath) throw new Error("Run has no worktree")
  if (changeSet.files.length === 0) throw new Error("Run has no file changes")

  return withWorktreeLock(worktreePath, async () => {
    const git = simpleGit(worktreePath)
    const undoneRef = `refs/flapstack/undone/${runId}`
    try {
      await git.raw(["rev-parse", "--verify", undoneRef])
      return { success: true as const, alreadyUndone: true as const, files: [] }
    } catch {
      // No undo marker: continue with preflight.
    }
    const db = getDatabase()
    const runCheckpoints = db.select().from(checkpoints).where(eq(checkpoints.runId, runId)).all()
    const before = runCheckpoints.find((checkpoint) => checkpoint.kind === "before")
    const after = runCheckpoints.find((checkpoint) => checkpoint.kind === "after")
    const beforeTree = parseSnapshot(before?.gitStatusJson ?? null).treeCommit
    const afterTree = parseSnapshot(after?.gitStatusJson ?? null).treeCommit
    if (!beforeTree || !afterTree) throw new Error("This run predates recoverable checkpoints")

    const plans: FilePlan[] = []
    const conflicts: Array<{ filePath: string; reason: string }> = []
    for (const file of [...changeSet.files].reverse()) {
      const { worktreeRoot, absolutePath } = await resolveSafeUndoPath(worktreePath, file.filePath)
      const [current, afterContent, beforeContent] = await Promise.all([
        readUndoFileState(absolutePath),
        readTreeFile(worktreePath, afterTree, file.filePath),
        readTreeFile(worktreePath, beforeTree, file.filePath),
      ])
      const merged = await planInverseFileState(current, afterContent, beforeContent)
      if (merged.conflict) conflicts.push({ filePath: file.filePath, reason: merged.conflict })
      else
        plans.push({
          filePath: file.filePath,
          worktreeRoot,
          absolutePath,
          current,
          result: merged.result ?? null,
        })
    }

    if (conflicts.length > 0) return { success: false as const, conflicts }

    const recoveryCommit = await captureWorktreeTree(worktreePath)
    await git.raw(["update-ref", `refs/flapstack/recovery/${runId}-${Date.now()}`, recoveryCommit])
    await writePlan(plans)
    await git.raw(["update-ref", undoneRef, recoveryCommit])
    return {
      success: true as const,
      alreadyUndone: false as const,
      files: plans.map((plan) => relative(plan.worktreeRoot, plan.absolutePath)),
      recoveryCommit,
    }
  })
}
