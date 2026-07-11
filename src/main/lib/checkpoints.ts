import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import simpleGit, { type SimpleGit, type StatusResult } from "simple-git"
import { eq } from "drizzle-orm"
import { checkpoints, fileChangeManifests, getDatabase } from "./db"
import { computeContentHash } from "./git/cache"
import { splitUnifiedDiffByFile } from "./git/diff-parser"

type CheckpointKind = "before" | "after"

type FileSnapshot = {
  path: string
  index: string
  workingTree: string
  hash: string | null
  missing: boolean
}

export type CheckpointStatusSnapshot = {
  available: boolean
  status?: StatusResult
  files: Record<string, FileSnapshot>
  error?: string
}

export type ManifestEntryInput = {
  filePath: string
  changeType: string
  additions: number
  deletions: number
  beforeHash: string | null
  afterHash: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function hashWorktreeFile(worktreePath: string, filePath: string): Promise<string | null> {
  const absolutePath = join(worktreePath, filePath)
  if (!existsSync(absolutePath)) return null
  const content = await readFile(absolutePath)
  return computeContentHash(content.toString("base64"))
}

async function buildStatusSnapshot(
  worktreePath: string | null,
): Promise<{ gitCommit: string | null; snapshot: CheckpointStatusSnapshot }> {
  if (!worktreePath || !existsSync(worktreePath)) {
    return {
      gitCommit: null,
      snapshot: {
        available: false,
        files: {},
        error: worktreePath ? "Worktree path is missing" : "No worktree path",
      },
    }
  }

  try {
    const git = simpleGit(worktreePath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      return {
        gitCommit: null,
        snapshot: {
          available: false,
          files: {},
          error: "Worktree is not a git repository",
        },
      }
    }

    const [gitCommit, status] = await Promise.all([
      git.revparse(["HEAD"]).then((value) => value.trim()),
      git.status(),
    ])

    const files: Record<string, FileSnapshot> = {}
    await Promise.all(
      status.files.map(async (file) => {
        const hash = await hashWorktreeFile(worktreePath, file.path)
        files[file.path] = {
          path: file.path,
          index: file.index,
          workingTree: file.working_dir,
          hash,
          missing: hash === null,
        }
      }),
    )

    return {
      gitCommit,
      snapshot: {
        available: true,
        status,
        files,
      },
    }
  } catch (error) {
    return {
      gitCommit: null,
      snapshot: {
        available: false,
        files: {},
        error: errorMessage(error),
      },
    }
  }
}

function parseCheckpointSnapshot(value: string | null): CheckpointStatusSnapshot {
  if (!value) return { available: false, files: {}, error: "Checkpoint has no status snapshot" }

  try {
    const parsed = JSON.parse(value) as Partial<CheckpointStatusSnapshot> & {
      unavailable?: boolean
      error?: string
    }
    if (parsed.files && typeof parsed.files === "object") {
      return {
        available: parsed.available ?? !parsed.unavailable,
        status: parsed.status,
        files: parsed.files,
        error: parsed.error,
      }
    }

    return {
      available: !parsed.unavailable,
      status: parsed as unknown as StatusResult,
      files: {},
      error: parsed.error,
    }
  } catch (error) {
    return {
      available: false,
      files: {},
      error: `Invalid checkpoint JSON: ${errorMessage(error)}`,
    }
  }
}

function inferChangeType(before?: FileSnapshot, after?: FileSnapshot): string {
  if (!before && after) return "added"
  if (before && !after) return "deleted"
  if (before?.missing && !after?.missing) return "added"
  if (!before?.missing && after?.missing) return "deleted"
  if (before?.index !== after?.index || before?.workingTree !== after?.workingTree) return "status"
  return "modified"
}

function countFileLines(snapshot?: FileSnapshot, worktreePath?: string | null): number {
  if (!snapshot || snapshot.missing || !worktreePath) return 0
  try {
    const absolutePath = join(worktreePath, snapshot.path)
    if (!existsSync(absolutePath)) return 0
    return readFileSyncForLineCount(absolutePath)
  } catch {
    return 0
  }
}

function readFileSyncForLineCount(absolutePath: string): number {
  const content = readFileSync(absolutePath, "utf8")
  if (!content) return 0
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
}

export function buildManifestEntriesFromSnapshots(
  beforeSnapshot: CheckpointStatusSnapshot,
  afterSnapshot: CheckpointStatusSnapshot,
  diffStats: Map<string, { additions: number; deletions: number }> = new Map(),
  worktreePath: string | null = null,
): ManifestEntryInput[] {
  const filePaths = new Set([
    ...Object.keys(beforeSnapshot.files),
    ...Object.keys(afterSnapshot.files),
  ])

  const entries = Array.from(filePaths)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((filePath) => {
      const before = beforeSnapshot.files[filePath]
      const after = afterSnapshot.files[filePath]
      if (
        before &&
        after &&
        before.hash === after.hash &&
        before.index === after.index &&
        before.workingTree === after.workingTree &&
        before.missing === after.missing
      ) {
        return []
      }

      const diffStat = diffStats.get(filePath)
      const changeType = inferChangeType(before, after)
      const fallbackLines =
        changeType === "added"
          ? { additions: countFileLines(after, worktreePath), deletions: 0 }
          : changeType === "deleted"
            ? { additions: 0, deletions: 0 }
            : { additions: 0, deletions: 0 }

      return [
        {
          filePath,
          changeType,
          additions: diffStat?.additions ?? fallbackLines.additions,
          deletions: diffStat?.deletions ?? fallbackLines.deletions,
          beforeHash: before?.hash ?? null,
          afterHash: after?.hash ?? null,
        },
      ]
    })

  if (entries.length > 0) return entries

  return [
    {
      filePath: "",
      changeType: "none",
      additions: 0,
      deletions: 0,
      beforeHash: null,
      afterHash: null,
    },
  ]
}

async function getDiffStats(
  worktreePath: string | null,
  paths: string[],
): Promise<Map<string, { additions: number; deletions: number }>> {
  const stats = new Map<string, { additions: number; deletions: number }>()
  if (!worktreePath || paths.length === 0 || !existsSync(worktreePath)) return stats

  try {
    const git = simpleGit(worktreePath)
    if (!(await git.checkIsRepo())) return stats
    const diffText = await git.diff(["HEAD", "--no-color", "--", ...paths])
    for (const file of splitUnifiedDiffByFile(diffText)) {
      const filePath = file.isDeletedFile ? file.oldPath : file.newPath || file.oldPath
      if (!filePath || filePath === "/dev/null") continue
      stats.set(filePath, { additions: file.additions, deletions: file.deletions })
    }
  } catch {
    return stats
  }

  return stats
}

async function getGitObjectHash(
  git: SimpleGit,
  commit: string,
  filePath: string,
): Promise<string | null> {
  try {
    return (await git.revparse([`${commit}:${filePath}`])).trim()
  } catch {
    return null
  }
}

async function getCommitManifestEntries(params: {
  worktreePath: string | null
  beforeCommit?: string | null
  afterCommit?: string | null
}): Promise<ManifestEntryInput[]> {
  if (
    !params.worktreePath ||
    !params.beforeCommit ||
    !params.afterCommit ||
    params.beforeCommit === params.afterCommit ||
    !existsSync(params.worktreePath)
  ) {
    return []
  }

  try {
    const git = simpleGit(params.worktreePath)
    if (!(await git.checkIsRepo())) return []

    const [numstat, nameStatus] = await Promise.all([
      git.raw(["diff", "--numstat", params.beforeCommit, params.afterCommit, "--"]),
      git.raw(["diff", "--name-status", params.beforeCommit, params.afterCommit, "--"]),
    ])

    const stats = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstat.split("\n")) {
      if (!line.trim()) continue
      const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t")
      const filePath = pathParts[pathParts.length - 1]
      if (!filePath) continue
      stats.set(filePath, {
        additions: additionsRaw === "-" ? 0 : Number(additionsRaw) || 0,
        deletions: deletionsRaw === "-" ? 0 : Number(deletionsRaw) || 0,
      })
    }

    const entries = await Promise.all(
      nameStatus
        .split("\n")
        .filter((line) => line.trim())
        .map(async (line): Promise<ManifestEntryInput | null> => {
          const [statusRaw, ...pathParts] = line.split("\t")
          const filePath = pathParts[pathParts.length - 1]
          if (!statusRaw || !filePath) return null

          const status = statusRaw[0]
          const changeType =
            status === "A"
              ? "added"
              : status === "D"
                ? "deleted"
                : status === "R"
                  ? "renamed"
                  : status === "C"
                    ? "copied"
                    : "modified"
          const diffStat = stats.get(filePath)

          return {
            filePath,
            changeType,
            additions: diffStat?.additions ?? 0,
            deletions: diffStat?.deletions ?? 0,
            beforeHash: await getGitObjectHash(git, params.beforeCommit!, filePath),
            afterHash: await getGitObjectHash(git, params.afterCommit!, filePath),
          }
        }),
    )

    return entries.filter((entry): entry is ManifestEntryInput => Boolean(entry))
  } catch {
    return []
  }
}

export async function captureCheckpoint(
  runId: string,
  worktreePath: string | null,
  kind: CheckpointKind,
) {
  const db = getDatabase()
  const { gitCommit, snapshot } = await buildStatusSnapshot(worktreePath)

  return db
    .insert(checkpoints)
    .values({
      runId,
      kind,
      worktreePath,
      gitCommit,
      gitStatusJson: JSON.stringify(snapshot),
    })
    .returning()
    .get()
}

export async function captureRunManifest(runId: string) {
  const db = getDatabase()
  db.delete(fileChangeManifests).where(eq(fileChangeManifests.runId, runId)).run()

  const runCheckpoints = db.select().from(checkpoints).where(eq(checkpoints.runId, runId)).all()

  const before = runCheckpoints.find((checkpoint) => checkpoint.kind === "before")
  const after = runCheckpoints.find((checkpoint) => checkpoint.kind === "after")
  const beforeSnapshot = parseCheckpointSnapshot(before?.gitStatusJson ?? null)
  const afterSnapshot = parseCheckpointSnapshot(after?.gitStatusJson ?? null)
  const changedPaths = Array.from(
    new Set([...Object.keys(beforeSnapshot.files), ...Object.keys(afterSnapshot.files)]),
  )
  const diffStats = await getDiffStats(
    after?.worktreePath ?? before?.worktreePath ?? null,
    changedPaths,
  )
  const snapshotEntries = buildManifestEntriesFromSnapshots(
    beforeSnapshot,
    afterSnapshot,
    diffStats,
    after?.worktreePath ?? before?.worktreePath ?? null,
  )
  const commitEntries = await getCommitManifestEntries({
    worktreePath: after?.worktreePath ?? before?.worktreePath ?? null,
    beforeCommit: before?.gitCommit,
    afterCommit: after?.gitCommit,
  })
  const entriesByPath = new Map<string, ManifestEntryInput>()
  for (const entry of snapshotEntries) {
    if (entry.changeType === "none" && commitEntries.length > 0) continue
    entriesByPath.set(entry.filePath, entry)
  }
  for (const entry of commitEntries) {
    entriesByPath.set(entry.filePath, entry)
  }
  const entries =
    entriesByPath.size > 0
      ? Array.from(entriesByPath.values()).sort((a, b) => a.filePath.localeCompare(b.filePath))
      : snapshotEntries

  return entries.map((entry) =>
    db
      .insert(fileChangeManifests)
      .values({
        runId,
        ...entry,
      })
      .returning()
      .get(),
  )
}

export const captureNoChangeManifest = captureRunManifest
