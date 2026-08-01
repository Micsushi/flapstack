import { constants } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, rmdir } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

type FileIdentity = { dev: number | bigint; ino: number | bigint; fileType: number }

export type RootedWriteSource = { data: string | Uint8Array } | { sourcePath: string }

export type RootedWriteOptions = {
  overwrite?: boolean
  createParents?: boolean
  mode?: number
  /** Undefined skips content CAS, null requires a missing target, and a hash requires exact content. */
  expectedSha256?: string | null
  /** Test seam for deterministic parent/final swap attacks. */
  beforeCommit?: (targetPath: string) => void | Promise<void>
  /** Runs after the atomic rename; failure restores the exact prior file state. */
  afterCommit?: (targetPath: string) => void | Promise<void>
  /** Test seam for deterministic replacement races before failed-write cleanup. */
  beforeFailureCleanup?: (targetPath: string) => void | Promise<void>
}

export type RootedMutationOptions = {
  /** Test seam for deterministic root/parent/final swap attacks. */
  beforeCommit?: (targetPath: string) => void | Promise<void>
}

export type RootedReadOptions = {
  /** Test seam for deterministic root/parent/final swap attacks. */
  beforeOpen?: (targetPath: string) => void | Promise<void>
  maxBytes?: number
}

export class RootedReadTooLargeError extends Error {
  constructor(public readonly byteLength: number) {
    super("Read target exceeds the allowed size")
    this.name = "RootedReadTooLargeError"
  }
}

type ExistingPathSnapshot = {
  lexicalRoot: string
  realRoot: string
  rootIdentity: FileIdentity
  parentPath: string
  parentIdentity: FileIdentity
  targetPath: string
  targetIdentity: FileIdentity
}

export function resolveInsideRoot(rootPath: string, targetRelativePath: string): string {
  if (targetRelativePath.includes("\0")) {
    throw new Error("Path contains invalid characters")
  }

  if (isAbsolute(targetRelativePath)) {
    throw new Error("Target path must be relative")
  }

  const resolvedRoot = resolve(rootPath)
  const resolvedTarget = resolve(resolvedRoot, targetRelativePath)

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error("Target path escapes root")
  }

  return resolvedTarget
}

/** Resolve and create a write parent without following symlinks inside the root. */
export async function prepareSafeWritePath(
  rootPath: string,
  targetRelativePath: string,
  options: { createParents?: boolean } = {},
): Promise<string> {
  const lexicalRoot = resolve(rootPath)
  const lexicalTarget = resolveInsideRoot(lexicalRoot, targetRelativePath)
  const realRoot = await realpath(lexicalRoot)
  const parentParts = relative(lexicalRoot, dirname(lexicalTarget)).split(sep).filter(Boolean)
  let current = realRoot

  for (const part of parentParts) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error("Attachment target contains a symbolic link")
      if (!info.isDirectory()) throw new Error("Attachment target parent is not a directory")
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      if (options.createParents === false) throw error
      await mkdir(current, { mode: 0o700 })
    }
    const resolvedCurrent = await realpath(current)
    if (resolvedCurrent !== realRoot && !resolvedCurrent.startsWith(realRoot + sep)) {
      throw new Error("Attachment target escapes root through a symbolic link")
    }
  }

  const target = join(current, basename(lexicalTarget))
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error("Attachment target cannot be a symbolic link")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  return target
}

/**
 * Strongest portable rooted write available through Node's filesystem API.
 *
 * The writer uses O_NOFOLLOW where the host exposes it, pins the written inode
 * through a file descriptor, revalidates root/parent/final identities directly
 * before commit, and uses a same-directory atomic rename for replacement.
 * Node does not expose cross-platform openat/renameat directory-handle APIs, so
 * this is fail-closed against observed swaps but is not claimed as a perfect
 * defense against an attacker continuously racing filesystem namespace calls.
 */
export async function writeFileInsideRoot(
  rootPath: string,
  targetRelativePath: string,
  source: RootedWriteSource,
  options: RootedWriteOptions = {},
): Promise<{ targetPath: string; byteLength: number }> {
  const lexicalRoot = resolve(rootPath)
  const lexicalTarget = resolveInsideRoot(lexicalRoot, targetRelativePath)
  const rootInfo = await lstat(lexicalRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Write root must be a real directory")
  }
  const realRoot = await realpath(lexicalRoot)
  const rootIdentity = identity(rootInfo)
  const targetPath = await prepareSafeWritePath(realRoot, relative(lexicalRoot, lexicalTarget), {
    createParents: options.createParents,
  })
  const parentPath = dirname(targetPath)
  const parentIdentity = identity(await lstat(parentPath))
  const initialTarget = await lstatOrNull(targetPath)
  if (initialTarget?.isSymbolicLink())
    throw new Error("Attachment target cannot be a symbolic link")
  if (initialTarget && !initialTarget.isFile()) throw new Error("Attachment target must be a file")
  if (initialTarget && !options.overwrite) throw existsError()
  const initialIdentity = initialTarget ? identity(initialTarget) : null
  const initialMode = initialTarget?.mode ?? options.mode ?? 0o600
  const initialContent = initialTarget
    ? await readExpectedFile(targetPath, initialIdentity!, options.expectedSha256)
    : null
  validateMissingExpectation(initialTarget, options.expectedSha256)

  if (!options.overwrite) {
    await options.beforeCommit?.(targetPath)
    await validateRootAndParent(lexicalRoot, realRoot, rootIdentity, parentPath, parentIdentity)
    const handle = await openNoFollowExclusive(targetPath, 0o600)
    const createdIdentity = identity(await handle.stat())
    try {
      await validateRootAndParent(lexicalRoot, realRoot, rootIdentity, parentPath, parentIdentity)
      await writeSource(handle, source)
      await handle.sync()
      const size = (await handle.stat()).size
      await handle.close()
      await validateCommittedTarget(
        lexicalRoot,
        realRoot,
        rootIdentity,
        parentPath,
        parentIdentity,
        targetPath,
        createdIdentity,
      )
      await options.afterCommit?.(targetPath)
      return { targetPath, byteLength: size }
    } catch (error) {
      await handle.close().catch(() => undefined)
      await options.beforeFailureCleanup?.(targetPath)
      await removeIfStillOwned(targetPath, parentPath, parentIdentity, createdIdentity)
      throw error
    }
  }

  // Run the caller-controlled/test seam and revalidate the namespace before a
  // secret-bearing temporary file exists. If the root or parent moved, fail
  // without materializing the payload in either the old or replacement tree.
  await options.beforeCommit?.(targetPath)
  await validateRootAndParent(lexicalRoot, realRoot, rootIdentity, parentPath, parentIdentity)
  await validateExpectedTarget(targetPath, initialIdentity)
  await validateExpectedContent(targetPath, initialIdentity, options.expectedSha256)

  const temporaryPath = join(parentPath, `.flapstack-${randomUUID()}.tmp`)
  const handle = await openNoFollowExclusive(temporaryPath, initialMode & 0o777)
  const temporaryIdentity = identity(await handle.stat())
  let committed = false
  try {
    await writeSource(handle, source)
    await handle.sync()
    const size = (await handle.stat()).size
    await handle.close()
    await chmod(temporaryPath, initialMode & 0o777)
    await validateRootAndParent(lexicalRoot, realRoot, rootIdentity, parentPath, parentIdentity)
    await validateExpectedTarget(targetPath, initialIdentity)
    await validateExpectedContent(targetPath, initialIdentity, options.expectedSha256)
    await rename(temporaryPath, targetPath)
    committed = true
    await validateCommittedTarget(
      lexicalRoot,
      realRoot,
      rootIdentity,
      parentPath,
      parentIdentity,
      targetPath,
      temporaryIdentity,
    )
    await options.afterCommit?.(targetPath)
    return { targetPath, byteLength: size }
  } catch (error) {
    await handle.close().catch(() => undefined)
    await options.beforeFailureCleanup?.(targetPath)
    if (!committed) {
      await removeIfStillOwned(temporaryPath, parentPath, parentIdentity, temporaryIdentity)
    } else {
      try {
        await rollbackCommittedWrite({
          lexicalRoot,
          realRoot,
          rootIdentity,
          parentPath,
          parentIdentity,
          targetPath,
          committedIdentity: temporaryIdentity,
          initialContent,
          initialMode,
        })
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Atomic write failed and rollback was unsafe",
        )
      }
    }
    throw error
  }
}

/**
 * Read one regular file through a pinned descriptor after validating every
 * namespace component. Final symlinks and symlinked parents are rejected.
 */
export async function readFileInsideRoot(
  rootPath: string,
  targetRelativePath: string,
  options: RootedReadOptions = {},
): Promise<Buffer> {
  const snapshot = await snapshotExistingPath(rootPath, targetRelativePath)
  const targetInfo = await lstat(snapshot.targetPath)
  if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
    throw new Error("Read target must be a real file")
  }

  await options.beforeOpen?.(snapshot.targetPath)
  await validateExistingSnapshot(snapshot)
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await open(snapshot.targetPath, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameIdentity(identity(opened), snapshot.targetIdentity)) {
      throw new Error("Read target inode changed during open")
    }
    if (options.maxBytes !== undefined && opened.size > options.maxBytes) {
      throw new RootedReadTooLargeError(opened.size)
    }
    await validateExistingSnapshot(snapshot)
    return await handle.readFile()
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** Rename an existing path without allowing the renderer to choose an absolute target. */
export async function renamePathInsideRoot(
  rootPath: string,
  targetRelativePath: string,
  newName: string,
  options: RootedMutationOptions = {},
): Promise<{ targetPath: string; newPath: string }> {
  validateSinglePathSegment(newName)
  const snapshot = await snapshotExistingPath(rootPath, targetRelativePath)
  const newPath = resolveInsideRoot(snapshot.parentPath, newName)
  if (dirname(newPath) !== snapshot.parentPath) throw new Error("Rename target must stay in parent")

  await options.beforeCommit?.(snapshot.targetPath)
  await validateExistingSnapshot(snapshot)
  if (newPath === snapshot.targetPath) {
    return { targetPath: snapshot.targetPath, newPath }
  }
  if (await lstatOrNull(newPath)) throw existsError()
  await rename(snapshot.targetPath, newPath)

  await validateRootAndParent(
    snapshot.lexicalRoot,
    snapshot.realRoot,
    snapshot.rootIdentity,
    snapshot.parentPath,
    snapshot.parentIdentity,
  )
  await validateTargetIdentity(newPath, snapshot.targetIdentity)
  return { targetPath: snapshot.targetPath, newPath }
}

/**
 * Invoke an operation such as platform trash only after immediate rooted
 * root/parent/final identity revalidation. The callback receives no
 * user-controlled absolute path; it receives the verified rooted target.
 */
export async function actOnPathInsideRoot<T>(
  rootPath: string,
  targetRelativePath: string,
  action: (targetPath: string) => Promise<T>,
  options: RootedMutationOptions = {},
): Promise<T> {
  const snapshot = await snapshotExistingPath(rootPath, targetRelativePath)
  await options.beforeCommit?.(snapshot.targetPath)
  await validateExistingSnapshot(snapshot)
  return action(snapshot.targetPath)
}

/**
 * Remove one regular file without following a final or parent symlink. Missing
 * files are idempotent. When requested, the verified parent is removed only if
 * it is still the same empty directory and is not the root itself.
 */
export async function removeFileInsideRoot(
  rootPath: string,
  targetRelativePath: string,
  options: RootedMutationOptions & { removeEmptyParent?: boolean } = {},
): Promise<{ removed: boolean; parentRemoved: boolean }> {
  const lexicalRoot = resolve(rootPath)
  resolveInsideRoot(lexicalRoot, targetRelativePath)
  let snapshot: ExistingPathSnapshot
  try {
    snapshot = await snapshotExistingPath(lexicalRoot, targetRelativePath)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { removed: false, parentRemoved: false }
    }
    throw error
  }
  const targetInfo = await lstat(snapshot.targetPath)
  if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
    throw new Error("Remove target must be a real file")
  }

  await options.beforeCommit?.(snapshot.targetPath)
  await validateExistingSnapshot(snapshot)
  await rm(snapshot.targetPath)

  let parentRemoved = false
  if (options.removeEmptyParent && snapshot.parentPath !== snapshot.realRoot) {
    await validateRootAndParent(
      snapshot.lexicalRoot,
      snapshot.realRoot,
      snapshot.rootIdentity,
      snapshot.parentPath,
      snapshot.parentIdentity,
    )
    try {
      await rmdir(snapshot.parentPath)
      parentRemoved = true
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        !["ENOTEMPTY", "EEXIST", "ENOENT"].includes(String(error.code))
      ) {
        throw error
      }
    }
  }
  return { removed: true, parentRemoved }
}

async function openNoFollowExclusive(path: string, mode: number) {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  return open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, mode)
}

async function readExpectedFile(
  targetPath: string,
  expectedIdentity: FileIdentity,
  expectedSha256: string | null | undefined,
): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const handle = await open(targetPath, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameIdentity(identity(opened), expectedIdentity)) {
      throw new Error("Write target changed during content validation")
    }
    const content = await handle.readFile()
    if (typeof expectedSha256 === "string" && sha256(content) !== expectedSha256) {
      throw new Error("Write target content is stale")
    }
    return content
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function validateMissingExpectation(
  current: Awaited<ReturnType<typeof lstatOrNull>>,
  expectedSha256: string | null | undefined,
): void {
  if (expectedSha256 === null && current) throw new Error("Write target content is stale")
  if (typeof expectedSha256 === "string" && !current) {
    throw new Error("Write target content is stale")
  }
}

async function validateExpectedContent(
  targetPath: string,
  expectedIdentity: FileIdentity | null,
  expectedSha256: string | null | undefined,
): Promise<void> {
  if (expectedSha256 === undefined) return
  if (expectedSha256 === null) {
    if (await lstatOrNull(targetPath)) throw new Error("Write target content is stale")
    return
  }
  if (!expectedIdentity) throw new Error("Write target content is stale")
  await readExpectedFile(targetPath, expectedIdentity, expectedSha256)
}

async function rollbackCommittedWrite(input: {
  lexicalRoot: string
  realRoot: string
  rootIdentity: FileIdentity
  parentPath: string
  parentIdentity: FileIdentity
  targetPath: string
  committedIdentity: FileIdentity
  initialContent: Buffer | null
  initialMode: number
}): Promise<void> {
  await validateRootAndParent(
    input.lexicalRoot,
    input.realRoot,
    input.rootIdentity,
    input.parentPath,
    input.parentIdentity,
  )
  await validateTargetIdentity(input.targetPath, input.committedIdentity)
  if (input.initialContent === null) {
    await removeIfStillOwned(
      input.targetPath,
      input.parentPath,
      input.parentIdentity,
      input.committedIdentity,
    )
    if (await lstatOrNull(input.targetPath)) throw new Error("Created target rollback failed")
    return
  }

  const rollbackPath = join(input.parentPath, `.flapstack-rollback-${randomUUID()}.tmp`)
  const handle = await openNoFollowExclusive(rollbackPath, input.initialMode & 0o777)
  const rollbackIdentity = identity(await handle.stat())
  let renamed = false
  try {
    await handle.writeFile(input.initialContent)
    await handle.sync()
    await handle.close()
    await chmod(rollbackPath, input.initialMode & 0o777)
    await validateRootAndParent(
      input.lexicalRoot,
      input.realRoot,
      input.rootIdentity,
      input.parentPath,
      input.parentIdentity,
    )
    await validateTargetIdentity(input.targetPath, input.committedIdentity)
    await rename(rollbackPath, input.targetPath)
    renamed = true
    await validateCommittedTarget(
      input.lexicalRoot,
      input.realRoot,
      input.rootIdentity,
      input.parentPath,
      input.parentIdentity,
      input.targetPath,
      rollbackIdentity,
    )
  } finally {
    await handle.close().catch(() => undefined)
    if (!renamed) {
      await removeIfStillOwned(
        rollbackPath,
        input.parentPath,
        input.parentIdentity,
        rollbackIdentity,
      )
    }
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

async function writeSource(
  handle: Awaited<ReturnType<typeof open>>,
  source: RootedWriteSource,
): Promise<void> {
  const data = "sourcePath" in source ? await readFile(source.sourcePath) : source.data
  await handle.writeFile(data)
}

async function validateRootAndParent(
  lexicalRoot: string,
  realRoot: string,
  expectedRoot: FileIdentity,
  parentPath: string,
  expectedParent: FileIdentity,
): Promise<void> {
  if (!sameIdentity(identity(await lstat(lexicalRoot)), expectedRoot)) {
    throw new Error("Write root inode changed during commit")
  }
  if ((await realpath(lexicalRoot)) !== realRoot)
    throw new Error("Write root changed during commit")
  const parentInfo = await lstat(parentPath)
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new Error("Write parent changed during commit")
  }
  if (!sameIdentity(identity(parentInfo), expectedParent)) {
    throw new Error("Write parent inode changed during commit")
  }
  const resolvedParent = await realpath(parentPath)
  if (resolvedParent !== realRoot && !resolvedParent.startsWith(realRoot + sep)) {
    throw new Error("Write parent escaped root during commit")
  }
}

async function validateExpectedTarget(
  targetPath: string,
  expected: FileIdentity | null,
): Promise<void> {
  const current = await lstatOrNull(targetPath)
  if (!expected && current) throw new Error("Write target appeared during commit")
  if (current?.isSymbolicLink()) {
    throw new Error("Write target changed to a symbolic link during commit")
  }
  if (expected && (!current || !sameIdentity(identity(current), expected))) {
    throw new Error("Write target changed during commit")
  }
}

async function validateCommittedTarget(
  lexicalRoot: string,
  realRoot: string,
  rootIdentity: FileIdentity,
  parentPath: string,
  parentIdentity: FileIdentity,
  targetPath: string,
  expectedTarget: FileIdentity,
): Promise<void> {
  await validateRootAndParent(lexicalRoot, realRoot, rootIdentity, parentPath, parentIdentity)
  const info = await lstat(targetPath)
  if (info.isSymbolicLink() || !info.isFile() || !sameIdentity(identity(info), expectedTarget)) {
    throw new Error("Committed target inode changed")
  }
  const resolvedTarget = await realpath(targetPath)
  if (resolvedTarget !== realRoot && !resolvedTarget.startsWith(realRoot + sep)) {
    throw new Error("Committed target escaped root")
  }
}

async function snapshotExistingPath(
  rootPath: string,
  targetRelativePath: string,
): Promise<ExistingPathSnapshot> {
  const lexicalRoot = resolve(rootPath)
  const lexicalTarget = resolveInsideRoot(lexicalRoot, targetRelativePath)
  if (lexicalTarget === lexicalRoot) throw new Error("Cannot target root")
  const rootInfo = await lstat(lexicalRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Operation root must be a real directory")
  }
  const realRoot = await realpath(lexicalRoot)
  const relativeTarget = relative(lexicalRoot, lexicalTarget)
  const parentParts = relativeTarget.split(sep).slice(0, -1)
  let parentPath = realRoot

  for (const part of parentParts) {
    parentPath = join(parentPath, part)
    const info = await lstat(parentPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Target parent must be a real directory")
    }
    const resolvedParent = await realpath(parentPath)
    if (resolvedParent !== realRoot && !resolvedParent.startsWith(realRoot + sep)) {
      throw new Error("Target parent escapes root")
    }
  }

  const targetPath = join(parentPath, basename(lexicalTarget))
  const targetInfo = await lstat(targetPath)
  if (!targetInfo.isSymbolicLink()) {
    const resolvedTarget = await realpath(targetPath)
    if (resolvedTarget !== realRoot && !resolvedTarget.startsWith(realRoot + sep)) {
      throw new Error("Target escapes root")
    }
  }

  return {
    lexicalRoot,
    realRoot,
    rootIdentity: identity(rootInfo),
    parentPath,
    parentIdentity: identity(await lstat(parentPath)),
    targetPath,
    targetIdentity: identity(targetInfo),
  }
}

async function validateExistingSnapshot(snapshot: ExistingPathSnapshot): Promise<void> {
  await validateRootAndParent(
    snapshot.lexicalRoot,
    snapshot.realRoot,
    snapshot.rootIdentity,
    snapshot.parentPath,
    snapshot.parentIdentity,
  )
  await validateTargetIdentity(snapshot.targetPath, snapshot.targetIdentity)
}

async function validateTargetIdentity(path: string, expected: FileIdentity): Promise<void> {
  const info = await lstat(path)
  if (!sameIdentity(identity(info), expected)) throw new Error("Target inode changed during commit")
}

function validateSinglePathSegment(value: string): void {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("\0") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error("Name must be one safe path segment")
  }
}

async function removeIfStillOwned(
  path: string,
  parentPath: string,
  parentIdentity: FileIdentity,
  expected: FileIdentity,
): Promise<void> {
  try {
    const parent = await lstat(parentPath)
    const item = await lstat(path)
    if (
      !parent.isSymbolicLink() &&
      sameIdentity(identity(parent), parentIdentity) &&
      !item.isSymbolicLink() &&
      sameIdentity(identity(item), expected)
    ) {
      await rm(path)
    }
  } catch {
    // Never follow an unverified cleanup path.
  }
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function identity(info: {
  dev: number | bigint
  ino: number | bigint
  mode: number
}): FileIdentity {
  return { dev: info.dev, ino: info.ino, fileType: info.mode & constants.S_IFMT }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.fileType === right.fileType
}

function existsError(): NodeJS.ErrnoException {
  const error = new Error("Target file already exists") as NodeJS.ErrnoException
  error.code = "EEXIST"
  return error
}
