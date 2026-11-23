import { constants, createReadStream, existsSync, readFileSync, type BigIntStats } from "node:fs"
import {
  copyFile,
  mkdir,
  mkdtemp,
  lstat,
  open,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import type { SimpleGit, StatusResult } from "simple-git"
import { eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { agentRuns, checkpoints, fileChangeManifests, getDatabase, getDatabasePath } from "./db"
import type * as schema from "./db/schema"
import { recordRunTimingInterval } from "./run-timings"
import { splitUnifiedDiffByFile } from "./git/diff-parser"
import { createGit } from "./git/git-factory"

type CheckpointKind = "before" | "after"
type AppDatabase = BetterSQLite3Database<typeof schema>

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
  treeCommit?: string
  indexTree?: string
  profileObjects?: boolean
  originals?: Record<string, string | null>
  crlfPaths?: string[]
  fileCapture?: {
    listMs: number
    validateAndCopyMs: number
    listed: number
    copied: number
    copiedBytes: number
  }
  reviewTree?: string
  skipped?: boolean
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

export async function hashWorktreeFile(
  worktreePath: string,
  filePath: string,
): Promise<string | null> {
  const absolutePath = join(worktreePath, filePath)
  const hash = createHash("sha256")
  try {
    // Node's decoder preserves base64 boundaries while keeping each chunk bounded.
    for await (const chunk of createReadStream(absolutePath, { encoding: "base64" }))
      hash.update(chunk)
    return hash.digest("hex").slice(0, 16)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function buildStatusSnapshot(
  worktreePath: string | null,
  db: AppDatabase,
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
    const git = createGit(worktreePath)
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

    const profile = checkpointProfile(db)
    const [head, staged, { originals, fileCapture, crlfPaths, eagerTree }] = await Promise.all([
      git.revparse(["--verify", "HEAD"]).catch(() => null),
      git.raw(["write-tree"]),
      captureOriginals(worktreePath, git, profile),
    ])
    const gitCommit = head?.trim() ?? null
    const indexTree = staged.trim()
    const treeCommit = eagerTree ? await captureEagerTree(worktreePath, git, profile) : indexTree
    return {
      gitCommit,
      snapshot: {
        available: true,
        files: {},
        treeCommit,
        indexTree,
        profileObjects: true,
        originals,
        crlfPaths,
        fileCapture,
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

// New snapshots write dirty blobs to the application's profile. The real repository
// retains HEAD and the staged tree so later GC cannot remove their original blobs.
function checkpointProfile(db: AppDatabase) {
  const file = db.get<{ file: string }>(
    sql`SELECT file FROM pragma_database_list WHERE name = 'main'`,
  )?.file
  return dirname(file || getDatabasePath())
}

export function checkpointReadEnvironment(profile = dirname(getDatabasePath())): NodeJS.ProcessEnv {
  return {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(
      join(profile, "checkpoint-objects").replaceAll("\\", "/"),
    ),
  }
}

export function checkpointReader(
  worktreePath: string,
  profileObjects?: boolean,
  profile?: string,
): SimpleGit {
  return profileObjects
    ? createGit(worktreePath, undefined, ["GIT_ALTERNATE_OBJECT_DIRECTORIES"]).env(
        checkpointReadEnvironment(profile),
      )
    : createGit(worktreePath)
}

function safeSnapshotPath(root: string, name: string) {
  // Imported records must never be able to place a file outside the private staging tree.
  if (
    !name ||
    isAbsolute(name) ||
    /^[a-z]:/i.test(name) ||
    name
      .replaceAll("\\", "/")
      .split("/")
      .some((p) => p === ".." || p.toLowerCase() === ".git")
  )
    throw new Error("Invalid checkpoint path")
  return join(root, name)
}

async function eachFile<T>(items: T[], operation: (item: T, worker: number) => Promise<void>) {
  let next = 0
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(16, items.length) }, async (_, worker) => {
      while (next < items.length) await operation(items[next++]!, worker)
    }),
  )
  const failed = results.find((item) => item.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
}

async function copyOriginal(
  source: FileHandle,
  destination: string,
  stat: BigIntStats,
  buffer: Buffer,
) {
  const output = await open(destination, "wx", Number(stat.mode & 0o777n))
  try {
    const mode = Number(stat.mode & 0o777n)
    if (process.platform !== "win32" && mode & process.umask()) await output.chmod(mode)
    let remaining = stat.size
    while (remaining > 0n) {
      const length = remaining < BigInt(buffer.length) ? Number(remaining) : buffer.length
      const { bytesRead } = await source.read(buffer, 0, length)
      if (!bytesRead) throw new Error("Checkpoint source ended before its recorded size")
      let offset = 0
      while (offset < bytesRead) {
        const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset)
        if (!bytesWritten) throw new Error("Could not write complete checkpoint file")
        offset += bytesWritten
      }
      remaining -= BigInt(bytesRead)
    }
  } finally {
    await output.close()
  }
}

function stamp(info: BigIntStats) {
  return [
    info.dev,
    info.ino,
    info.size,
    info.mode,
    info.ctimeNs,
    info.mtimeNs,
    info.birthtimeNs,
  ].join(":")
}

type Ending = "index" | "crlf" | "raw"
let lastEndings:
  { root: string; files: Map<string, { identity: string; ending: Ending }> } | undefined

function parseEndings(output: string) {
  const endings = new Map<string, Ending>()
  for (const entry of output.split("\0")) {
    const tab = entry.indexOf("\t")
    if (tab < 0) continue
    const [index, work] = entry
      .slice(0, tab)
      .split(/\s+/)
      .map((part) => part.slice(2))
    const ending =
      work === "crlf" && index === "lf"
        ? "crlf"
        : work && (work !== index || work === "mixed")
          ? "raw"
          : "index"
    endings.set(entry.slice(tab + 1), ending)
  }
  return endings
}

async function cleanTrackedEndings(
  root: string,
  git: SimpleGit,
  stages: string,
  mustCopy: Set<string>,
) {
  const tracked = stages.split("\0").filter(Boolean)
  // Above the memory bound Git remains authoritative. No prior workspace remains retained.
  if (tracked.length > 32768) {
    lastEndings = undefined
    return parseEndings(await git.raw(["ls-files", "--cached", "--eol", "-z"]))
  }
  const prior = lastEndings?.root === root ? lastEndings.files : undefined
  const next: NonNullable<typeof lastEndings>["files"] = new Map()
  const endings = new Map<string, Ending>(),
    pending = new Map<string, { physical: string; identity: string }>()
  await eachFile(tracked, async (record) => {
    const tab = record.indexOf("\t"),
      name = record.slice(tab + 1)
    if (mustCopy.has(name)) return
    const path = safeSnapshotPath(root, name)
    const info = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null
      throw error
    })
    if (!info) {
      mustCopy.add(name)
      return
    }
    const physical = stamp(info),
      identity = record.slice(0, tab) + "\0" + physical
    const cached = prior?.get(name)
    if (cached?.identity === identity) {
      next.set(name, cached)
      endings.set(name, cached.ending)
    } else pending.set(name, { physical, identity })
  })
  if (pending.size) {
    const names = [...pending.keys()]
    // A full sweep is cheaper on a cold checkout. Small changes use literal pathspecs.
    const args = names.length > 64 || names.join(" ").length > 6000 ? [] : ["--", ...names]
    const classified = parseEndings(
      await git.raw(["--literal-pathspecs", "ls-files", "--cached", "--eol", "-z", ...args]),
    )
    await eachFile(names, async (name) => {
      const entry = pending.get(name)!,
        ending = classified.get(name)
      if (
        !ending ||
        stamp(await lstat(safeSnapshotPath(root, name), { bigint: true })) !== entry.physical
      ) {
        throw new Error("File changed during checkpoint: " + name)
      }
      next.set(name, { identity: entry.identity, ending })
      endings.set(name, ending)
    })
  }
  lastEndings = { root, files: next }
  return endings
}

async function captureOriginals(worktree: string, git: SimpleGit, profile: string) {
  const files = join(profile, "checkpoint-files")
  const fromRepo = relative(worktree, files)
  if (!fromRepo || (!isAbsolute(fromRepo) && fromRepo !== ".." && !fromRepo.startsWith(".." + sep)))
    throw new Error("The checkpoint profile must be outside the working repository")
  const started = Date.now()
  const [raw, stages, filtered] = await Promise.all([
    git.raw(["ls-files", "-z", "--others", "--modified", "--deleted", "--exclude-standard"]),
    git.raw(["ls-files", "--cached", "--stage", "-z"]),
    git.raw([
      "ls-files",
      "--cached",
      "-z",
      "--",
      ":(exclude,attr:!filter !working-tree-encoding !ident)",
    ]),
  ])
  const mustCopy = new Set([...raw.split("\0"), ...filtered.split("\0")].filter(Boolean))
  const crlfPaths: string[] = []
  for (const [path, ending] of await cleanTrackedEndings(worktree, git, stages, mustCopy)) {
    if (ending === "crlf" && !mustCopy.has(path)) crlfPaths.push(path)
    else if (ending === "raw") mustCopy.add(path)
  }
  const names = [...mustCopy]
  const listedAt = Date.now()
  const fileCapture = {
    listMs: listedAt - started,
    validateAndCopyMs: 0,
    listed: names.length,
    copied: 0,
    copiedBytes: 0,
  }
  const originals: Record<string, string | null> = Object.create(null)
  if (!names.length) return { originals, fileCapture, crlfPaths, eagerTree: false }
  await Promise.all([
    mkdir(files, { recursive: true, mode: 0o700 }),
    mkdir(join(profile, "checkpoint-objects"), { recursive: true, mode: 0o700 }),
  ])
  const root = await realpath(worktree)
  const parents = new Map<string, Promise<string | null>>()
  let unsupported = false
  const buffers: Buffer[] = []
  await eachFile(names, async (name, worker) => {
    const path = safeSnapshotPath(root, name)
    const parent = dirname(path)
    const resolved =
      parents.get(parent) ??
      realpath(parent).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null
        throw error
      })
    parents.set(parent, resolved)
    const actual = await resolved
    if (actual !== null && actual !== parent) {
      unsupported = true
      return
    }
    const stat = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null
      throw error
    })
    if (!stat) {
      originals[name] = null
      return
    }
    // Let Git preserve submodule and symlink semantics through its normal indexer.
    if (!stat.isFile()) {
      unsupported = true
      return
    }
    const identity = stamp(stat)
    const key = createHash("sha256").update(path).update("\0").update(identity).digest("hex")
    const target = join(files, key)
    if (!existsSync(target)) {
      const temp = join(files, randomUUID() + ".partial")
      const source = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        if (stamp(await source.stat({ bigint: true })) !== identity)
          throw new Error("File changed before checkpoint: " + name)
        const buffer = (buffers[worker] ??= Buffer.allocUnsafe(256 * 1024))
        await copyOriginal(source, temp, stat, buffer)
        const final = await lstat(path, { bigint: true })
        if (
          stamp(final) !== identity ||
          stamp(await source.stat({ bigint: true })) !== identity ||
          (await realpath(parent)) !== parent
        )
          throw new Error("File changed during checkpoint: " + name)
        await rename(temp, target)
        fileCapture.copied++
        fileCapture.copiedBytes += Number(stat.size)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      } finally {
        await source.close()
      }
    }
    originals[name] = key
  })
  fileCapture.validateAndCopyMs = Date.now() - listedAt
  return { originals, fileCapture, crlfPaths, eagerTree: unsupported }
}

async function privateWriter(
  worktree: string,
  base: string,
  index: string,
  profile: string,
  work?: string,
  gitDir?: string,
) {
  const realObjects = (
    await createGit(worktree).raw(["rev-parse", "--path-format=absolute", "--git-path", "objects"])
  ).trim()
  const objects = join(profile, "checkpoint-objects")
  await mkdir(objects, { recursive: true })
  const env: Record<string, string> = {
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(realObjects.replaceAll("\\", "/")),
  }
  if (work) {
    env.GIT_DIR =
      gitDir ?? (await createGit(worktree).raw(["rev-parse", "--absolute-git-dir"])).trim()
    env.GIT_WORK_TREE = work
  }
  return createGit(base, undefined, Object.keys(env)).env(env)
}

const rawAttributes = "* -text -crlf !eol -filter -ident !working-tree-encoding\n"

async function initRawGitDir(worktree: string, temp: string) {
  const git = createGit(worktree)
  const [objectFormat, fileOptions] = await Promise.all([
    git.raw(["rev-parse", "--show-object-format"]),
    git
      .raw(["config", "--type=bool", "--get-regexp", "^core\\.(filemode|symlinks|ignorecase)$"])
      .catch(() => ""),
  ])
  const format = objectFormat.trim()
  const dir = join(temp, "git")
  if (format !== "sha1" && format !== "sha256") throw new Error("Unsupported Git object format")
  // Preserve filesystem semantics but keep conversion attributes and templates private.
  const settings = fileOptions.split("\n").flatMap((line) => {
    const match = /^core\.(filemode|symlinks|ignorecase) (true|false)$/.exec(line.trim())
    return match ? [match[1] + " = " + match[2]] : []
  })
  await Promise.all(
    ["info", "refs", "objects"].map((name) => mkdir(join(dir, name), { recursive: true })),
  )
  await Promise.all([
    writeFile(join(dir, "HEAD"), "ref: refs/heads/checkpoint\n"),
    writeFile(
      join(dir, "config"),
      [
        "[core]",
        ...settings,
        ...(format === "sha256"
          ? ["repositoryformatversion = 1", "[extensions]", "objectformat = sha256"]
          : ["repositoryformatversion = 0"]),
        "",
      ].join("\n"),
    ),
    writeFile(join(dir, "info", "attributes"), rawAttributes),
  ])
  return dir
}

async function captureEagerTree(worktree: string, git: SimpleGit, profile: string) {
  const temp = await mkdtemp(join(tmpdir(), "flapstack-checkpoint-"))
  try {
    const index = join(temp, "index")
    const source = (
      await git.raw(["rev-parse", "--path-format=absolute", "--git-path", "index"])
    ).trim()
    if (existsSync(source)) await copyFile(source, index)
    const privateGit = await privateWriter(worktree, worktree, index, profile)
    if (!existsSync(index)) await privateGit.raw(["read-tree", "--empty"])
    await privateGit.raw(["add", "-A"])
    return (await privateGit.raw(["write-tree"])).trim()
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function projectedTree(
  worktree: string,
  snapshot: CheckpointStatusSnapshot,
  profile: string,
  paths?: Set<string>,
) {
  const tree = snapshot.treeCommit!
  if (!snapshot.originals) return tree
  const raw = snapshot.crlfPaths !== undefined
  const dirty = Object.entries(snapshot.originals).filter(
    ([name]) => !paths || paths.has(name) || (!raw && basename(name) === ".gitattributes"),
  )
  const crlf = snapshot.crlfPaths?.filter((name) => !paths || paths.has(name)) ?? []
  if (!dirty.length && !crlf.length) return tree
  const temp = await mkdtemp(join(tmpdir(), "flapstack-checkpoint-project-"))
  try {
    const work = join(temp, "work")
    await mkdir(work)
    const gitDir = raw ? await initRawGitDir(worktree, temp) : undefined
    const git = await privateWriter(worktree, work, join(temp, "index"), profile, work, gitDir)
    await git.raw(["read-tree", tree])
    if (crlf.length && gitDir) {
      const attributes = join(gitDir, "info", "attributes")
      await writeFile(attributes, "* text eol=crlf !crlf -filter -ident !working-tree-encoding\n")
      for (let i = 0; i < crlf.length; i += 16) {
        const names = crlf.slice(i, i + 16)
        for (const name of names) safeSnapshotPath(work, name)
        await git.raw(["checkout-index", "--force", "--", ...names])
      }
      await writeFile(attributes, rawAttributes)
    }
    await eachFile(dirty, async ([name, key]) => {
      const dest = safeSnapshotPath(work, name)
      if (key === null) return
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid checkpoint file identity")
      await mkdir(dirname(dest), { recursive: true })
      const source = join(profile, "checkpoint-files", key)
      await copyFile(source, dest)
    })
    const list = join(temp, "paths")
    // An eager tree already excludes deleted files. Git will reject an unmatched pathspec.
    const names = [
      ...crlf,
      ...dirty
        .filter(([, key]) => key !== null || tree === snapshot.indexTree)
        .map(([name]) => name),
    ]
    if (!names.length) return tree
    await writeFile(list, names.map((name) => name + "\0").join(""))
    await git.raw([
      "--literal-pathspecs",
      "add",
      "--force",
      "-A",
      "--pathspec-from-file=" + list,
      "--pathspec-file-nul",
    ])
    return (await git.raw(["write-tree"])).trim()
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

export async function captureWorktreeTree(
  worktreePath: string,
  changedPaths?: string[],
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "flapstack-checkpoint-"))
  try {
    const tempIndexPath = join(tempDir, "index")
    const indexPath = (
      await createGit(worktreePath).raw([
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      ])
    ).trim()
    const hasIndex = existsSync(indexPath)
    // Reuse Git's file-stat cache without ever changing the user's index.
    const real = createGit(worktreePath)
    const env: Record<string, string> = { GIT_INDEX_FILE: tempIndexPath }
    if (changedPaths) {
      env.GIT_DIR = await initRawGitDir(worktreePath, tempDir)
      env.GIT_WORK_TREE = worktreePath
      env.GIT_OBJECT_DIRECTORY = (
        await real.raw(["rev-parse", "--path-format=absolute", "--git-path", "objects"])
      ).trim()
    }
    const git = createGit(worktreePath, undefined, Object.keys(env)).env(env)
    if (!hasIndex) await git.raw(["read-tree", "--empty"])
    else if (changedPaths) await git.raw(["read-tree", (await real.raw(["write-tree"])).trim()])
    else await copyFile(indexPath, tempIndexPath)
    if (changedPaths) {
      // Undo only mutates these paths. Keep their current bytes recoverable without
      // copying unrelated untracked files into the user's object store.
      const tracked = new Set((await git.raw(["ls-files", "--cached", "-z"])).split("\0"))
      const present: string[] = []
      for (const name of changedPaths) {
        if (
          tracked.has(name) ||
          (await lstat(safeSnapshotPath(worktreePath, name)).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT" || error.code === "ENOTDIR") return false
              throw error
            },
          ))
        )
          present.push(name)
      }
      if (present.length) {
        const list = join(tempDir, "paths")
        await writeFile(list, present.map((name) => name + "\0").join(""))
        await git.raw([
          "--literal-pathspecs",
          "add",
          "--force",
          "-A",
          "--pathspec-from-file=" + list,
          "--pathspec-file-nul",
        ])
      }
    } else await git.raw(["add", "-A"])
    const tree = (await git.raw(["write-tree"])).trim()
    if (!tree) throw new Error("Could not capture worktree tree")
    return (
      await git.raw([
        "-c",
        "user.name=Flapstack Recovery",
        "-c",
        "user.email=recovery@flapstack.local",
        "commit-tree",
        tree,
        "-m",
        "Flapstack private checkpoint",
      ])
    ).trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
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
        treeCommit: parsed.treeCommit,
        indexTree: parsed.indexTree,
        profileObjects: parsed.profileObjects,
        originals: parsed.originals,
        crlfPaths: parsed.crlfPaths,
        fileCapture: parsed.fileCapture,
        reviewTree: parsed.reviewTree,
        skipped: parsed.skipped,
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
    const git = createGit(worktreePath)
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

async function treeManifest(
  worktreePath: string,
  before: string,
  after: string,
  profileObjects: boolean,
  profile: string,
): Promise<ManifestEntryInput[]> {
  if (before === after) return []
  const git = checkpointReader(worktreePath, profileObjects, profile)
  // Report both sides of a move separately so each pathname has its own undo preimage.
  const options = ["--no-renames", "--no-ext-diff", "--no-textconv", "-z", before, after, "--"]
  const [raw, numstat] = await Promise.all([
    git.raw(["diff", "--raw", "--no-abbrev", ...options]),
    git.raw(["diff", "--numstat", ...options]),
  ])
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstat.split("\0")) {
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]+)$/.exec(line)
    if (match)
      stats.set(match[3]!, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 })
  }
  const fields = raw.split("\0")
  const entries: ManifestEntryInput[] = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const filePath = fields[i + 1]!
    const [, , beforeHash, afterHash, code] = fields[i]!.split(" ")
    if (!filePath || !beforeHash || !afterHash || !code)
      throw new Error("Invalid checkpoint tree diff")
    entries.push({
      filePath,
      changeType: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
      beforeHash: /^0+$/.test(beforeHash) ? null : beforeHash,
      afterHash: /^0+$/.test(afterHash) ? null : afterHash,
      ...(stats.get(filePath) ?? { additions: 0, deletions: 0 }),
    })
  }
  return entries
}

export async function captureCheckpoint(
  runId: string,
  worktreePath: string | null,
  kind: CheckpointKind,
  db: AppDatabase = getDatabase(),
) {
  const started = Date.now()
  const run = db
    .select({ mode: agentRuns.permissionMode })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .get()
  const { gitCommit, snapshot } =
    run?.mode === "read-only"
      ? {
          gitCommit: null,
          snapshot: { available: false, files: {}, skipped: true } as CheckpointStatusSnapshot,
        }
      : await buildStatusSnapshot(worktreePath, db)

  const checkpoint = db
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

  if (worktreePath && snapshot.treeCommit) {
    try {
      const git = createGit(worktreePath)
      await git.raw([
        "update-ref",
        `refs/flapstack/checkpoints/${checkpoint.id}`,
        snapshot.profileObjects ? (gitCommit ?? snapshot.indexTree!) : snapshot.treeCommit,
      ])
      if (snapshot.indexTree) {
        await git.raw([
          "update-ref",
          `refs/flapstack/checkpoint-indexes/${checkpoint.id}`,
          snapshot.indexTree,
        ])
      }
    } catch (error) {
      console.warn("[checkpoints] Could not retain private checkpoint ref", error)
    }
  }

  recordRunTimingInterval(db, runId, kind, started, Date.now())
  return checkpoint
}

/** Restore the exact worktree and index captured before a run. */
export async function restoreCheckpoint(checkpointId: string): Promise<boolean> {
  const db = getDatabase()
  const checkpoint = db.select().from(checkpoints).where(eq(checkpoints.id, checkpointId)).get()
  if (!checkpoint) throw new Error("Checkpoint not found")
  if (!checkpoint.worktreePath) return false

  const snapshot = parseCheckpointSnapshot(checkpoint.gitStatusJson)
  if (snapshot.skipped) return false
  if (!snapshot.available || !snapshot.treeCommit || !snapshot.indexTree) {
    throw new Error("Checkpoint cannot safely restore the worktree and index")
  }

  const git = checkpointReader(checkpoint.worktreePath, snapshot.profileObjects)
  const retainedRef = `refs/flapstack/checkpoints/${checkpoint.id}`
  const retainedIndexRef = `refs/flapstack/checkpoint-indexes/${checkpoint.id}`
  const retainedBase = (await git.raw(["rev-parse", "--verify", `${retainedRef}^{tree}`])).trim()
  const retainedTree = snapshot.profileObjects
    ? await projectedTree(checkpoint.worktreePath, snapshot, checkpointProfile(db))
    : retainedBase
  const retainedIndexTree = (
    await git.raw(["rev-parse", "--verify", `${retainedIndexRef}^{tree}`])
  ).trim()
  const temporary = await mkdtemp(join(tmpdir(), "flapstack-restore-"))
  try {
    const checkout = checkpointReader(checkpoint.worktreePath, snapshot.profileObjects).env({
      ...(snapshot.profileObjects ? checkpointReadEnvironment() : {}),
      GIT_INDEX_FILE: join(temporary, "index"),
    })
    await checkout.raw(["read-tree", retainedTree])
    const writer = snapshot.crlfPaths
      ? await privateWriter(
          checkpoint.worktreePath,
          checkpoint.worktreePath,
          join(temporary, "index"),
          checkpointProfile(db),
          checkpoint.worktreePath,
          await initRawGitDir(checkpoint.worktreePath, temporary),
        )
      : checkout
    await writer.raw(["checkout-index", "-a", "-f"])
    await checkout.raw(["clean", "-fd"])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  await git.raw(["read-tree", retainedIndexTree])
  return true
}

export async function captureRunManifest(runId: string, db: AppDatabase = getDatabase()) {
  const runCheckpoints = db.select().from(checkpoints).where(eq(checkpoints.runId, runId)).all()

  const before = runCheckpoints.find((checkpoint) => checkpoint.kind === "before")
  const after = runCheckpoints.find((checkpoint) => checkpoint.kind === "after")
  const beforeSnapshot = parseCheckpointSnapshot(before?.gitStatusJson ?? null)
  const afterSnapshot = parseCheckpointSnapshot(after?.gitStatusJson ?? null)
  const worktreePath = after?.worktreePath ?? before?.worktreePath
  let entries: ManifestEntryInput[] = []
  if (worktreePath && beforeSnapshot.treeCommit && afterSnapshot.treeCommit) {
    const profile = checkpointProfile(db)
    const beforeFiles =
        beforeSnapshot.originals ?? (Object.create(null) as Record<string, string | null>),
      afterFiles = afterSnapshot.originals ?? (Object.create(null) as Record<string, string | null>)
    const changed = new Set(
      [...Object.keys(beforeFiles), ...Object.keys(afterFiles)].filter(
        (path) => beforeFiles[path] !== afterFiles[path],
      ),
    )
    const oldCrlf = new Set(beforeSnapshot.crlfPaths),
      newCrlf = new Set(afterSnapshot.crlfPaths)
    for (const path of oldCrlf) if (!newCrlf.has(path)) changed.add(path)
    for (const path of newCrlf) if (!oldCrlf.has(path)) changed.add(path)
    const privateObjects = !!(beforeSnapshot.profileObjects || afterSnapshot.profileObjects)
    if (beforeSnapshot.treeCommit !== afterSnapshot.treeCommit) {
      const staged = await checkpointReader(worktreePath, privateObjects, profile).raw([
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        beforeSnapshot.treeCommit,
        afterSnapshot.treeCommit,
        "--",
      ])
      staged
        .split("\0")
        .filter(Boolean)
        .forEach((path) => changed.add(path))
    }
    if (changed.size) {
      const [beforeTree, afterTree] = await Promise.all([
        projectedTree(worktreePath, beforeSnapshot, profile, changed),
        projectedTree(worktreePath, afterSnapshot, profile, changed),
      ])
      entries = await treeManifest(worktreePath, beforeTree, afterTree, privateObjects, profile)
      beforeSnapshot.reviewTree = beforeTree
      afterSnapshot.reviewTree = afterTree
    }
  } else if (!beforeSnapshot.profileObjects && !afterSnapshot.profileObjects) {
    const paths = [
      ...new Set([...Object.keys(beforeSnapshot.files), ...Object.keys(afterSnapshot.files)]),
    ]
    const stats = await getDiffStats(worktreePath ?? null, paths)
    entries = buildManifestEntriesFromSnapshots(beforeSnapshot, afterSnapshot, stats, worktreePath)
  }
  if (!entries.length)
    entries = [
      {
        filePath: "",
        changeType: "none",
        additions: 0,
        deletions: 0,
        beforeHash: null,
        afterHash: null,
      },
    ]
  return db.transaction((tx) => {
    if (before && beforeSnapshot.reviewTree)
      tx.update(checkpoints)
        .set({ gitStatusJson: JSON.stringify(beforeSnapshot) })
        .where(eq(checkpoints.id, before.id))
        .run()
    if (after && afterSnapshot.reviewTree)
      tx.update(checkpoints)
        .set({ gitStatusJson: JSON.stringify(afterSnapshot) })
        .where(eq(checkpoints.id, after.id))
        .run()
    tx.delete(fileChangeManifests).where(eq(fileChangeManifests.runId, runId)).run()
    return entries.map((entry) =>
      tx
        .insert(fileChangeManifests)
        .values({ runId, ...entry })
        .returning()
        .get(),
    )
  })
}
