import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { lstat, mkdir, rm } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import { simpleGit, type SimpleGit } from "simple-git"
import type { PortableScopeId } from "../../../shared/portability"
import {
  readJsonFile,
  sha256,
  snapshotRegularFileNoFollow,
  stableJson,
  writeJsonAtomic,
} from "./io"
import { portableScopeRegistry } from "./scope-registry"
import { assertNoSecretText } from "./secrets"

export type PrivateSyncConfig = {
  schemaVersion: 1
  repoPath: string
  remote: string
  branch: string
  scopes: PortableScopeId[]
  includedPaths: string[]
}

export type PrivateSyncFilePreview = {
  path: string
  previousPath?: string
  status: string
  oldOid: string | null
  newOid: string | null
}

export type PrivateSyncPreview = {
  action: "pull" | "commit" | "push"
  branch: string
  remote: string
  includedPaths: string[]
  localOid: string | null
  remoteOid: string | null
  files: PrivateSyncFilePreview[]
  ahead: number
  behind: number
  conflicts: string[]
  workingTreeClean: boolean
  secretSafe: boolean
  fingerprint: string
}

type NameStatusEntry = { status: string; paths: string[] }
const execFileAsync = promisify(execFile)
const REVIEWED_REMOTE_REF = "refs/flapstack/previews/reviewed"

export const PRIVATE_SYNC_REVIEW_LIMITS = {
  commitCount: 64,
  changedPathsPerCommit: 256,
  totalChangedPaths: 2_048,
  blobBytes: 4_000_000,
  totalBlobBytes: 16_000_000,
  diffOutputBytes: 8_000_000,
} as const

const PRIVATE_SYNC_LIMIT_ERROR =
  "Private sync review exceeds supported history limits: 64 commits, 256 changed paths per commit, 2,048 total changed paths, or 16,000,000 scanned blob bytes. Split or squash the private sync history."

export type PrivateSyncMutationHooks = {
  beforeCommitCas?: () => void | Promise<void>
  beforePushLease?: () => void | Promise<void>
}

export type PrivateSyncPreviewHooks = {
  afterWorktreeFileOpen?: (path: string) => void | Promise<void>
}

export async function linkPrivateSync(input: {
  stateRoot: string
  repoPath: string
  remote: string
  branch: string
  scopes: readonly PortableScopeId[]
  initialize?: boolean
  clone?: boolean
}): Promise<PrivateSyncConfig> {
  validateRemote(input.remote)
  validateBranch(input.branch)
  if (!isAbsolute(input.repoPath)) throw new Error("Private sync repository path must be absolute.")
  const scopes = validateScopes(input.scopes)
  if (!(await pathExists(input.repoPath))) {
    if (input.clone) {
      await simpleGit().clone(input.remote, input.repoPath, ["--branch", input.branch])
    } else {
      if (!input.initialize) throw new Error("Private sync repository does not exist.")
      await mkdir(input.repoPath, { recursive: true, mode: 0o700 })
    }
  }
  await assertRepoPath(input.repoPath)
  const git = simpleGit(input.repoPath)
  if (!(await git.checkIsRepo())) {
    if (!input.initialize) throw new Error("Selected private sync path is not a git repository.")
    await git.init()
    await git.checkoutLocalBranch(input.branch)
  }
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((entry) => entry.name === "origin")
  if (origin && (origin.refs.fetch !== input.remote || origin.refs.push !== input.remote)) {
    throw new Error("Existing origin fetch and push URLs must match the reviewed private remote.")
  }
  if (!origin) await git.addRemote("origin", input.remote)
  const current = await currentBranch(git)
  if (current !== input.branch) throw new Error("Selected repository is on a different branch.")
  const config: PrivateSyncConfig = {
    schemaVersion: 1,
    repoPath: input.repoPath,
    remote: input.remote,
    branch: input.branch,
    scopes,
    includedPaths: deriveIncludedPaths(scopes),
  }
  await writeJsonAtomic(configPath(input.stateRoot), config)
  return config
}

export async function getPrivateSyncConfig(stateRoot: string): Promise<PrivateSyncConfig | null> {
  try {
    const raw = await readJsonFile<unknown>(configPath(stateRoot))
    const config = validatePersistedConfig(raw)
    await assertRepoPath(config.repoPath)
    return config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function unlinkPrivateSync(stateRoot: string): Promise<void> {
  const config = await getPrivateSyncConfig(stateRoot)
  if (config) await deleteReviewedRemoteRef(simpleGit(config.repoPath))
  await rm(configPath(stateRoot), { force: true })
}

export async function previewPrivateSync(
  stateRoot: string,
  action: PrivateSyncPreview["action"],
  hooks?: PrivateSyncPreviewHooks,
): Promise<PrivateSyncPreview> {
  const config = await requireConfig(stateRoot)
  const git = simpleGit(config.repoPath)
  await assertRepoContract(git, config)
  const localOid = await resolveOptionalRef(git, "HEAD")
  const status = await git.status()
  const conflicts = [...status.conflicted].sort()
  let remoteOid: string | null = null
  let ahead = 0
  let behind = 0
  let files: PrivateSyncFilePreview[]
  let secretSafe: boolean

  if (action === "commit") {
    const commit = await inspectCommitWorktree(git, config, localOid, hooks)
    files = commit.files
    secretSafe = commit.secretSafe
  } else {
    remoteOid = await fetchRemotePreview(git, config)
    ;({ ahead, behind } = await countDivergence(git, config, localOid, remoteOid))
    const from = action === "pull" ? localOid : remoteOid
    const to = action === "pull" ? remoteOid : localOid
    files = await buildRangePreview(git, config, from, to, action)
    secretSafe = await auditCommitRange(git, config, from, to)
  }

  const value: Omit<PrivateSyncPreview, "fingerprint"> = {
    action,
    branch: config.branch,
    remote: config.remote,
    includedPaths: [...config.includedPaths],
    localOid,
    remoteOid,
    files,
    ahead,
    behind,
    conflicts,
    workingTreeClean: status.isClean(),
    secretSafe,
  }
  const preview = { ...value, fingerprint: fingerprint(value) }
  await writeJsonAtomic(previewPath(stateRoot, preview.fingerprint), preview)
  return preview
}

export async function pullPrivateSync(input: {
  stateRoot: string
  expectedFingerprint: string
}): Promise<{ updated: boolean }> {
  const { config, git, preview } = await loadReviewedPreview(
    input.stateRoot,
    "pull",
    input.expectedFingerprint,
  )
  if (!preview.secretSafe)
    throw new Error("Remote private sync content contains secret candidates.")
  if (
    preview.conflicts.length > 0 ||
    preview.ahead > 0 ||
    !preview.workingTreeClean ||
    (await git.status()).isClean() === false
  ) {
    throw new Error("Private sync pull cannot fast-forward cleanly.")
  }
  if (preview.behind === 0) {
    await deleteReviewedRemoteRef(git)
    return { updated: false }
  }
  if (!preview.remoteOid) throw new Error("Reviewed remote commit is unavailable.")
  await assertRangeStillMatches(git, config, preview, "pull")
  await git.raw(["merge", "--ff-only", preview.remoteOid])
  await deleteReviewedRemoteRef(git)
  await rm(previewPath(input.stateRoot, preview.fingerprint), { force: true })
  return { updated: true }
}

export async function commitPrivateSync(input: {
  stateRoot: string
  expectedFingerprint: string
  message: string
  hooks?: PrivateSyncMutationHooks
}): Promise<{ commit: string }> {
  const { config, git, preview } = await loadReviewedPreview(
    input.stateRoot,
    "commit",
    input.expectedFingerprint,
  )
  if (!preview.secretSafe) throw new Error("Private sync content contains secret candidates.")
  if (!input.message.trim() || input.message.length > 200 || /[\r\n]/.test(input.message))
    throw new Error("Commit message must be one bounded line.")
  const current = await inspectCommitWorktree(git, config, preview.localOid)
  if (
    stableJson(current.files) !== stableJson(preview.files) ||
    current.secretSafe !== preview.secretSafe
  ) {
    throw new Error("Private sync preview is stale; review again.")
  }
  const temporaryIndex = join(input.stateRoot, "private-sync-indexes", `${randomUUID()}.index`)
  await mkdir(join(input.stateRoot, "private-sync-indexes"), { recursive: true, mode: 0o700 })
  const indexEnvironment = { GIT_INDEX_FILE: temporaryIndex }
  try {
    await runGit(
      config.repoPath,
      preview.localOid ? ["read-tree", preview.localOid] : ["read-tree", "--empty"],
      indexEnvironment,
    )
    await runGit(config.repoPath, ["add", "--all", "--", ...config.includedPaths], indexEnvironment)
    const stagedPaths = parseNulList(
      await runGit(
        config.repoPath,
        ["diff", "--cached", "--name-only", "-z", ...(preview.localOid ? [preview.localOid] : [])],
        indexEnvironment,
      ),
    )
    assertApprovedPaths(config, stagedPaths)
    if (
      stableJson(stagedPaths.sort()) !== stableJson(preview.files.map((file) => file.path).sort())
    ) {
      throw new Error("Private sync staged content changed after preview.")
    }
    for (const file of preview.files) {
      const stagedOid = await resolveOptionalRefWithEnvironment(
        config.repoPath,
        `:${file.path}`,
        indexEnvironment,
      )
      if (stagedOid !== file.newOid)
        throw new Error("Private sync staged object changed after preview.")
    }
    const tree = (await runGit(config.repoPath, ["write-tree"], indexEnvironment)).trim()
    const commitArgs = ["commit-tree", tree]
    if (preview.localOid) commitArgs.push("-p", preview.localOid)
    commitArgs.push("-m", input.message.trim())
    const commit = (await runGit(config.repoPath, commitArgs)).trim()
    await input.hooks?.beforeCommitCas?.()
    const objectFormat = await readGitObjectFormat(git)
    assertOidMatchesObjectFormat(commit, objectFormat)
    if (preview.localOid) assertOidMatchesObjectFormat(preview.localOid, objectFormat)
    const expectedOld = preview.localOid ?? "0".repeat(gitObjectIdLength(objectFormat))
    await runGit(config.repoPath, [
      "update-ref",
      `refs/heads/${config.branch}`,
      commit,
      expectedOld,
    ])
    await git.raw(["reset", "--mixed", commit, "--", ...config.includedPaths])
    await rm(previewPath(input.stateRoot, preview.fingerprint), { force: true })
    return { commit }
  } finally {
    await rm(temporaryIndex, { force: true })
  }
}

export async function pushPrivateSync(input: {
  stateRoot: string
  expectedFingerprint: string
  hooks?: PrivateSyncMutationHooks
}): Promise<{ pushed: boolean }> {
  const { config, git, preview } = await loadReviewedPreview(
    input.stateRoot,
    "push",
    input.expectedFingerprint,
  )
  if (!preview.secretSafe)
    throw new Error("Outgoing private sync commits contain secret candidates.")
  if (preview.behind > 0 || preview.conflicts.length > 0)
    throw new Error("Private sync push is divergent or conflicted.")
  if (preview.ahead === 0) {
    await deleteReviewedRemoteRef(git)
    return { pushed: false }
  }
  if (!preview.localOid) throw new Error("Reviewed local commit is unavailable.")
  await assertRangeStillMatches(git, config, preview, "push")
  const remoteOid = await readRemoteOid(git, config)
  if (remoteOid !== preview.remoteOid)
    throw new Error("Private sync remote moved after preview; review again.")
  const objectFormat = await readGitObjectFormat(git)
  assertOidMatchesObjectFormat(preview.localOid, objectFormat)
  if (preview.remoteOid) {
    assertOidMatchesObjectFormat(preview.remoteOid, objectFormat)
    await runGit(config.repoPath, [
      "merge-base",
      "--is-ancestor",
      preview.remoteOid,
      preview.localOid,
    ])
  }
  const branchRef = `refs/heads/${config.branch}`
  const expectedRemoteOid = preview.remoteOid ?? "0".repeat(gitObjectIdLength(objectFormat))
  await input.hooks?.beforePushLease?.()
  await runGit(config.repoPath, [
    "push",
    `--force-with-lease=${branchRef}:${expectedRemoteOid}`,
    "origin",
    `${preview.localOid}:${branchRef}`,
  ])
  await deleteReviewedRemoteRef(git)
  await rm(previewPath(input.stateRoot, preview.fingerprint), { force: true })
  return { pushed: true }
}

async function loadReviewedPreview(
  stateRoot: string,
  action: PrivateSyncPreview["action"],
  expectedFingerprint: string,
): Promise<{ config: PrivateSyncConfig; git: SimpleGit; preview: PrivateSyncPreview }> {
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint))
    throw new Error("Private sync preview fingerprint is invalid.")
  const preview = await readJsonFile<PrivateSyncPreview>(
    previewPath(stateRoot, expectedFingerprint),
  )
  const { fingerprint: storedFingerprint, ...value } = preview
  if (
    storedFingerprint !== expectedFingerprint ||
    fingerprint(value) !== expectedFingerprint ||
    preview.action !== action
  ) {
    throw new Error("Private sync preview is stale; review again.")
  }
  const config = await requireConfig(stateRoot)
  if (stableJson(config.includedPaths) !== stableJson(preview.includedPaths))
    throw new Error("Private sync scope contract changed after preview.")
  const git = simpleGit(config.repoPath)
  await assertRepoContract(git, config)
  if ((await resolveOptionalRef(git, "HEAD")) !== preview.localOid)
    throw new Error("Private sync local commit moved after preview; review again.")
  return { config, git, preview }
}

async function assertRangeStillMatches(
  git: SimpleGit,
  config: PrivateSyncConfig,
  preview: PrivateSyncPreview,
  action: "pull" | "push",
): Promise<void> {
  const from = action === "pull" ? preview.localOid : preview.remoteOid
  const to = action === "pull" ? preview.remoteOid : preview.localOid
  const files = await buildRangePreview(git, config, from, to, action)
  const secretSafe = await auditCommitRange(git, config, from, to)
  if (stableJson(files) !== stableJson(preview.files) || secretSafe !== preview.secretSafe)
    throw new Error("Private sync reviewed Git objects changed after preview.")
}

async function inspectCommitWorktree(
  git: SimpleGit,
  config: PrivateSyncConfig,
  localOid: string | null,
  hooks?: PrivateSyncPreviewHooks,
): Promise<{ files: PrivateSyncFilePreview[]; secretSafe: boolean }> {
  const status = await git.status()
  if (status.files.length > PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths)
    throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
  const staged = parseNameStatus(
    await runGitBounded(
      config.repoPath,
      ["diff", "--cached", "--name-status", "-z"],
      PRIVATE_SYNC_REVIEW_LIMITS.diffOutputBytes,
    ),
    PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths,
  )
  assertApprovedPaths(
    config,
    staged.flatMap((entry) => entry.paths),
  )
  const paths = status.files
    .map((file) => file.path)
    .filter((path) => isApprovedPath(config, path))
    .sort()
  const files: PrivateSyncFilePreview[] = []
  let secretSafe = true
  const objectFormat = await readGitObjectFormat(git)
  for (const path of paths) {
    const absolute = join(config.repoPath, path)
    let newOid: string | null = null
    try {
      const snapshot = await snapshotRegularFileNoFollow(absolute, {
        maxBytes: PRIVATE_SYNC_REVIEW_LIMITS.blobBytes,
        previewBytes: PRIVATE_SYNC_REVIEW_LIMITS.blobBytes,
        afterOpen: () => hooks?.afterWorktreeFileOpen?.(path),
      })
      newOid = gitBlobOid(snapshot.preview, objectFormat)
      try {
        assertNoSecretText(snapshot.preview.toString("utf8"), path)
      } catch {
        secretSafe = false
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    files.push({
      path,
      status: "working-tree",
      oldOid: localOid ? await blobOidAt(config.repoPath, localOid, path, objectFormat) : null,
      newOid,
    })
  }
  return { files, secretSafe }
}

export function gitBlobOid(contents: Uint8Array, objectFormat: string): string {
  assertGitObjectFormat(objectFormat)
  return createHash(objectFormat)
    .update(`blob ${contents.byteLength}\0`)
    .update(contents)
    .digest("hex")
}

function assertGitObjectFormat(value: string): asserts value is "sha1" | "sha256" {
  if (value !== "sha1" && value !== "sha256")
    throw new Error(`Unsupported Git object format: ${value || "missing"}.`)
}

async function readGitObjectFormat(git: SimpleGit): Promise<"sha1" | "sha256"> {
  const value = (await git.raw(["rev-parse", "--show-object-format"])).trim().toLowerCase()
  assertGitObjectFormat(value)
  return value
}

function gitObjectIdLength(format: "sha1" | "sha256"): 40 | 64 {
  return format === "sha1" ? 40 : 64
}

function assertOidMatchesObjectFormat(oid: string, format: "sha1" | "sha256"): void {
  if (!new RegExp(`^[a-f0-9]{${gitObjectIdLength(format)}}$`).test(oid))
    throw new Error(`Git object ID does not match repository ${format} format.`)
}

function isGitObjectId(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
}

async function fetchRemotePreview(
  git: SimpleGit,
  config: PrivateSyncConfig,
): Promise<string | null> {
  const advertised = await readRemoteOid(git, config)
  if (!advertised) {
    await deleteReviewedRemoteRef(git)
    return null
  }
  await git.raw([
    "fetch",
    "--no-tags",
    "origin",
    `+refs/heads/${config.branch}:${REVIEWED_REMOTE_REF}`,
  ])
  const fetched = await resolveOptionalRef(git, REVIEWED_REMOTE_REF)
  if (fetched !== advertised) throw new Error("Private sync remote moved while previewing; retry.")
  return fetched
}

async function deleteReviewedRemoteRef(git: SimpleGit): Promise<void> {
  try {
    await git.raw(["update-ref", "-d", REVIEWED_REMOTE_REF])
  } catch {
    // Missing preview refs are already clean.
  }
}

async function readRemoteOid(git: SimpleGit, config: PrivateSyncConfig): Promise<string | null> {
  const output = await git.raw(["ls-remote", "--heads", "origin", `refs/heads/${config.branch}`])
  return parsePrivateSyncRemoteOid(
    output,
    `refs/heads/${config.branch}`,
    await readGitObjectFormat(git),
  )
}

export function parsePrivateSyncRemoteOid(
  output: string,
  expectedRef: string,
  objectFormat: string,
): string | null {
  assertGitObjectFormat(objectFormat)
  if (!output) return null
  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t([^\r\n]+)\r?\n?$/.exec(output)
  if (!match || match[2] !== expectedRef)
    throw new Error("Private sync remote advertisement is malformed.")
  assertOidMatchesObjectFormat(match[1], objectFormat)
  return match[1]
}

async function countDivergence(
  git: SimpleGit,
  config: PrivateSyncConfig,
  localOid: string | null,
  remoteOid: string | null,
): Promise<{ ahead: number; behind: number }> {
  if (!localOid && !remoteOid) return { ahead: 0, behind: 0 }
  const objectFormat = await readGitObjectFormat(git)
  const maximum = PRIVATE_SYNC_REVIEW_LIMITS.commitCount + 1
  const outputLimit = maximum * (gitObjectIdLength(objectFormat) + 2)
  const arguments_ =
    localOid && remoteOid
      ? ["rev-list", "--left-right", `--max-count=${maximum}`, `${localOid}...${remoteOid}`]
      : ["rev-list", `--max-count=${maximum}`, localOid ?? remoteOid!]
  const lines = (await runGitBounded(config.repoPath, arguments_, outputLimit))
    .split(/\r?\n/)
    .filter(Boolean)
  if (lines.length > PRIVATE_SYNC_REVIEW_LIMITS.commitCount)
    throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
  if (!localOid) {
    for (const oid of lines) assertOidMatchesObjectFormat(oid, objectFormat)
    return { ahead: 0, behind: lines.length }
  }
  if (!remoteOid) {
    for (const oid of lines) assertOidMatchesObjectFormat(oid, objectFormat)
    return { ahead: lines.length, behind: 0 }
  }
  let ahead = 0
  let behind = 0
  for (const line of lines) {
    const side = line[0]
    if (side !== "<" && side !== ">") throw new Error("Private sync Git range is malformed.")
    assertOidMatchesObjectFormat(line.slice(1), objectFormat)
    if (side === "<") ahead += 1
    else behind += 1
  }
  return { ahead, behind }
}

async function buildRangePreview(
  git: SimpleGit,
  config: PrivateSyncConfig,
  from: string | null,
  to: string | null,
  action: "pull" | "push",
): Promise<PrivateSyncFilePreview[]> {
  if (!to) return []
  const objectFormat = await readGitObjectFormat(git)
  const entries = from
    ? parseNameStatus(
        await runGitBounded(
          config.repoPath,
          ["diff", "--name-status", "-z", from, to],
          PRIVATE_SYNC_REVIEW_LIMITS.diffOutputBytes,
        ),
        PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths,
      )
    : parseNameStatus(
        await runGitBounded(
          config.repoPath,
          ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", to],
          PRIVATE_SYNC_REVIEW_LIMITS.diffOutputBytes,
        ),
        PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths,
      )
  const files: PrivateSyncFilePreview[] = []
  for (const entry of entries) {
    assertApprovedPaths(config, entry.paths)
    const path = entry.paths.at(-1)!
    const previousPath = entry.paths.length > 1 ? entry.paths[0] : undefined
    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      status: `${action === "pull" ? "incoming" : "outgoing"}:${entry.status}`,
      oldOid: from
        ? await blobOidAt(config.repoPath, from, previousPath ?? path, objectFormat)
        : null,
      newOid: await blobOidAt(config.repoPath, to, path, objectFormat),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function auditCommitRange(
  git: SimpleGit,
  config: PrivateSyncConfig,
  from: string | null,
  to: string | null,
): Promise<boolean> {
  if (!to) return true
  const objectFormat = await readGitObjectFormat(git)
  const range = from ? `${from}..${to}` : to
  const commits = (
    await runGitBounded(
      config.repoPath,
      ["rev-list", "--reverse", `--max-count=${PRIVATE_SYNC_REVIEW_LIMITS.commitCount + 1}`, range],
      (PRIVATE_SYNC_REVIEW_LIMITS.commitCount + 1) * (gitObjectIdLength(objectFormat) + 1),
    )
  )
    .split(/\r?\n/)
    .filter(Boolean)
  if (commits.length > PRIVATE_SYNC_REVIEW_LIMITS.commitCount)
    throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
  for (const commit of commits) assertOidMatchesObjectFormat(commit, objectFormat)

  const reviewedCommits: Array<{ commit: string; entries: NameStatusEntry[] }> = []
  let totalChangedPaths = 0
  for (const commit of commits) {
    const entries = parseNameStatus(
      await runGitBounded(
        config.repoPath,
        ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", commit],
        PRIVATE_SYNC_REVIEW_LIMITS.diffOutputBytes,
      ),
      PRIVATE_SYNC_REVIEW_LIMITS.changedPathsPerCommit,
    )
    for (const entry of entries) {
      assertApprovedPaths(config, entry.paths)
    }
    totalChangedPaths += changedPathCount(entries)
    if (totalChangedPaths > PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths)
      throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
    reviewedCommits.push({ commit, entries })
  }

  const blobs = new Map<string, { path: string; size: number }>()
  let totalBlobBytes = 0
  for (const { commit, entries } of reviewedCommits) {
    for (const entry of entries) {
      if (entry.status.startsWith("D")) continue
      const path = entry.paths.at(-1)!
      const oid = await blobOidAt(config.repoPath, commit, path, objectFormat)
      if (!oid) throw new Error(`Private sync commit lacks reviewed blob: ${path}`)
      if (blobs.has(oid)) continue
      const size = Number(
        (await runGitBounded(config.repoPath, ["cat-file", "-s", oid], 100)).trim(),
      )
      if (!Number.isSafeInteger(size) || size < 0 || size > PRIVATE_SYNC_REVIEW_LIMITS.blobBytes)
        throw new Error(`Private sync Git object is unsupported: ${path}`)
      totalBlobBytes += size
      assertPrivateSyncBlobBudget(totalBlobBytes)
      blobs.set(oid, { path, size })
    }
  }

  let secretSafe = true
  for (const [oid, blob] of blobs) {
    const content = await runGitBounded(config.repoPath, ["cat-file", "blob", oid], blob.size + 1)
    if (Buffer.byteLength(content) !== blob.size)
      throw new Error(`Private sync Git object changed while reviewing: ${blob.path}`)
    if (content.includes("\0")) throw new Error(`Private sync Git object is not text: ${blob.path}`)
    try {
      assertNoSecretText(content, blob.path)
    } catch {
      secretSafe = false
    }
  }
  return secretSafe
}

async function blobOidAt(
  repoPath: string,
  ref: string,
  path: string,
  objectFormat: "sha1" | "sha256",
): Promise<string | null> {
  const output = await runGitBounded(repoPath, ["ls-tree", "-z", ref, "--", path], 16_384)
  if (!output) return null
  const match = /^(\d+) blob ((?:[a-f0-9]{40}|[a-f0-9]{64}))\t([^\0]+)\0?$/.exec(output)
  if (!match || match[3] !== path)
    throw new Error(`Private sync path is not a regular file: ${path}`)
  assertOidMatchesObjectFormat(match[2], objectFormat)
  return match[2]
}

export function parsePrivateSyncNameStatus(
  output: string,
  maxChangedPaths = PRIVATE_SYNC_REVIEW_LIMITS.totalChangedPaths,
): NameStatusEntry[] {
  return parseNameStatus(output, maxChangedPaths)
}

function parseNameStatus(output: string, maxChangedPaths: number): NameStatusEntry[] {
  const tokens = parseNulList(output)
  const entries: NameStatusEntry[] = []
  let parsedPaths = 0
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]
    if (!status || !/^[ACDMRTUXB][0-9]*$/.test(status))
      throw new Error("Private sync Git diff is malformed.")
    const count = status.startsWith("R") || status.startsWith("C") ? 2 : 1
    const paths = tokens.slice(index, index + count)
    if (paths.length !== count) throw new Error("Private sync Git diff path is missing.")
    parsedPaths += count
    if (parsedPaths > maxChangedPaths) throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
    index += count
    entries.push({ status, paths })
  }
  return entries
}

function changedPathCount(entries: readonly NameStatusEntry[]): number {
  return entries.reduce((count, entry) => count + entry.paths.length, 0)
}

export function assertPrivateSyncBlobBudget(totalBytes: number): void {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    totalBytes > PRIVATE_SYNC_REVIEW_LIMITS.totalBlobBytes
  )
    throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
}

function parseNulList(value: string): string[] {
  return value.split("\0").filter(Boolean)
}

async function assertRepoContract(git: SimpleGit, config: PrivateSyncConfig): Promise<void> {
  await assertRepoPath(config.repoPath)
  if (!(await git.checkIsRepo())) throw new Error("Private sync repository is unavailable.")
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((entry) => entry.name === "origin")
  if (!origin || origin.refs.fetch !== config.remote || origin.refs.push !== config.remote) {
    throw new Error("Private sync origin fetch or push URL changed after linking.")
  }
  if ((await currentBranch(git)) !== config.branch)
    throw new Error("Private sync branch changed or HEAD is detached after linking.")
}

async function currentBranch(git: SimpleGit): Promise<string> {
  try {
    const branch = (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim()
    if (!branch) throw new Error("detached")
    return branch
  } catch {
    throw new Error("Private sync repository must have an attached branch.")
  }
}

async function assertRepoPath(repoPath: string): Promise<void> {
  if (!isAbsolute(repoPath)) throw new Error("Private sync repository path must be absolute.")
  const info = await lstat(repoPath)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Private sync repository must be a non-symlink directory.")
}

function validatePersistedConfig(raw: unknown): PrivateSyncConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Private sync configuration is invalid.")
  const value = raw as Record<string, unknown>
  if (
    value.schemaVersion !== 1 ||
    typeof value.repoPath !== "string" ||
    typeof value.remote !== "string" ||
    typeof value.branch !== "string" ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string") ||
    !Array.isArray(value.includedPaths) ||
    !value.includedPaths.every((path) => typeof path === "string")
  ) {
    throw new Error("Private sync configuration is invalid.")
  }
  validateRemote(value.remote)
  validateBranch(value.branch)
  if (!isAbsolute(value.repoPath)) throw new Error("Private sync repository path must be absolute.")
  const scopes = validateScopes(value.scopes as PortableScopeId[])
  const includedPaths = deriveIncludedPaths(scopes)
  if (stableJson(value.includedPaths) !== stableJson(includedPaths))
    throw new Error("Private sync included paths do not match the validated scopes.")
  return {
    schemaVersion: 1,
    repoPath: value.repoPath,
    remote: value.remote,
    branch: value.branch,
    scopes,
    includedPaths,
  }
}

function validateScopes(scopes: readonly PortableScopeId[]): PortableScopeId[] {
  if (scopes.length === 0) throw new Error("Select at least one private sync scope.")
  const unique = [...new Set(scopes)]
  for (const scopeId of unique) {
    const scope = portableScopeRegistry.get(scopeId)
    if (scope.handler.privateSync !== "eligible-after-secret-scan") {
      throw new Error(`Scope ${scopeId} is not eligible for private git sync.`)
    }
  }
  return unique.sort()
}

function deriveIncludedPaths(scopes: readonly PortableScopeId[]): string[] {
  return scopes.map((scope) => `scopes/${scope}`).sort()
}

function assertApprovedPaths(config: PrivateSyncConfig, paths: readonly string[]): void {
  const escaped = paths.find((path) => !isApprovedPath(config, path))
  if (escaped) throw new Error(`Private sync Git range touches unapproved path: ${escaped}`)
}

function isApprovedPath(config: PrivateSyncConfig, path: string): boolean {
  return config.includedPaths.some((root) => path === root || path.startsWith(`${root}/`))
}

function validateRemote(remote: string): void {
  if (!remote || /[\r\n\0]/.test(remote)) throw new Error("Private sync remote is invalid.")
  if (isAbsolute(remote)) return
  if (/^[^@\s/:]+@[^:\s]+:.+$/.test(remote)) {
    if (/[?#]/.test(remote)) throw new Error("Private sync remote must not contain query tokens.")
    return
  }
  let parsed: URL
  try {
    parsed = new URL(remote)
  } catch {
    throw new Error("Use an SSH, HTTPS, file, or absolute local private remote.")
  }
  if (!new Set(["https:", "ssh:", "file:"]).has(parsed.protocol))
    throw new Error("Use an SSH, HTTPS, file, or absolute local private remote.")
  if (parsed.search || parsed.hash)
    throw new Error("Private sync remote must not contain query or fragment tokens.")
  if (parsed.password || (parsed.protocol !== "ssh:" && parsed.username))
    throw new Error("Remote URLs must not embed credentials.")
}

function validateBranch(branch: string): void {
  if (
    !/^(?![.-])(?!.*\.\.)(?!.*[~^:?*\\\[\s])[A-Za-z0-9._\/-]+$/.test(branch) ||
    branch.endsWith("/")
  ) {
    throw new Error("Private sync branch is invalid.")
  }
}

function fingerprint(value: Omit<PrivateSyncPreview, "fingerprint">): string {
  return sha256(stableJson(value))
}

async function resolveOptionalRef(git: SimpleGit, ref: string): Promise<string | null> {
  try {
    const value = (await git.raw(["rev-parse", "--verify", ref])).trim()
    return isGitObjectId(value) ? value : null
  } catch {
    return null
  }
}

async function resolveOptionalRefWithEnvironment(
  repoPath: string,
  ref: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const value = (await runGit(repoPath, ["rev-parse", "--verify", ref], environment)).trim()
    return isGitObjectId(value) ? value : null
  } catch {
    return null
  }
}

async function runGit(
  repoPath: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    env: { ...process.env, ...environment },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

async function runGitBounded(
  repoPath: string,
  args: readonly string[],
  maxOutputBytes: number,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
      env: process.env,
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      windowsHide: true,
    })
    if (Buffer.byteLength(stdout) > maxOutputBytes) throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
    return stdout
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("maxBuffer") || error.message.includes("stdout maxBuffer"))
    )
      throw new Error(PRIVATE_SYNC_LIMIT_ERROR)
    throw error
  }
}

async function requireConfig(stateRoot: string): Promise<PrivateSyncConfig> {
  const config = await getPrivateSyncConfig(stateRoot)
  if (!config) throw new Error("Private sync is not linked.")
  return config
}

function configPath(stateRoot: string): string {
  return join(stateRoot, "private-sync.json")
}

function previewPath(stateRoot: string, fingerprintValue: string): string {
  return join(stateRoot, "private-sync-previews", `${fingerprintValue}.json`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
