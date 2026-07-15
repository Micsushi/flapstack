import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { lstat, mkdir, open, opendir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { PORTABILITY_LIMITS, safeRelativeBundlePathSchema } from "../../../shared/portability"

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function sha256File(
  path: string,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<{ sha256: string; bytes: number }> {
  const snapshot = await snapshotRegularFileNoFollow(path, { maxBytes, previewBytes: 0 })
  return { sha256: snapshot.sha256, bytes: snapshot.bytes }
}

export type RegularFileSnapshot = {
  sha256: string
  bytes: number
  deviceId: string
  inodeId: string
  preview: Buffer
}

export async function snapshotRegularFileNoFollow(
  path: string,
  options: {
    maxBytes: number
    previewBytes?: number
    useNoFollowFlag?: boolean
    afterOpen?: () => void | Promise<void>
  },
): Promise<RegularFileSnapshot> {
  const pathInfo = await lstat(path, { bigint: true })
  assertRegularPathSnapshot(path, pathInfo)
  const noFollowFlag = options.useNoFollowFlag === false ? 0 : (constants.O_NOFOLLOW ?? 0)
  const handle = await open(path, constants.O_RDONLY | noFollowFlag)
  try {
    const info = await handle.stat({ bigint: true })
    assertRegularPathSnapshot(path, info)
    if (!sameFileSnapshot(pathInfo, info))
      throw new Error(`Regular file identity changed while opening: ${path}`)
    const bytes = Number(info.size)
    if (!Number.isSafeInteger(bytes) || bytes > options.maxBytes)
      throw new Error(`Portable file exceeds the ${options.maxBytes}-byte limit: ${path}`)
    await options.afterOpen?.()
    const digest = createHash("sha256")
    const previewLimit = options.previewBytes ?? 0
    const previewChunks: Buffer[] = []
    let previewLength = 0
    let position = 0
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (position < bytes) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, bytes - position),
        position,
      )
      if (bytesRead === 0) break
      const chunk = buffer.subarray(0, bytesRead)
      digest.update(chunk)
      if (previewLength < previewLimit) {
        const previewChunk = Buffer.from(chunk.subarray(0, previewLimit - previewLength))
        previewChunks.push(previewChunk)
        previewLength += previewChunk.length
      }
      position += bytesRead
    }
    if (position !== bytes) throw new Error(`Portable file changed while reading: ${path}`)
    const finalInfo = await handle.stat({ bigint: true })
    const finalPathInfo = await lstat(path, { bigint: true })
    assertRegularPathSnapshot(path, finalPathInfo)
    if (!sameFileSnapshot(info, finalInfo) || !sameFileSnapshot(info, finalPathInfo))
      throw new Error(`Portable file changed while reading: ${path}`)
    return {
      sha256: digest.digest("hex"),
      bytes,
      deviceId: info.dev.toString(),
      inodeId: info.ino.toString(),
      preview: Buffer.concat(previewChunks),
    }
  } finally {
    await handle.close()
  }
}

export async function copyRegularFileNoFollow(
  source: string,
  target: string,
  expected?: Pick<RegularFileSnapshot, "sha256" | "bytes" | "deviceId" | "inodeId">,
  options: { useNoFollowFlag?: boolean } = {},
): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.tmp-${randomUUID()}`
  const pathInfo = await lstat(source, { bigint: true })
  assertRegularPathSnapshot(source, pathInfo)
  const noFollowFlag = options.useNoFollowFlag === false ? 0 : (constants.O_NOFOLLOW ?? 0)
  const sourceHandle = await open(source, constants.O_RDONLY | noFollowFlag)
  try {
    const info = await sourceHandle.stat({ bigint: true })
    assertRegularPathSnapshot(source, info)
    if (!sameFileSnapshot(pathInfo, info))
      throw new Error(`Regular file identity changed while opening: ${source}`)
    const bytes = Number(info.size)
    if (
      expected &&
      (expected.bytes !== bytes ||
        expected.deviceId !== info.dev.toString() ||
        expected.inodeId !== info.ino.toString())
    )
      throw new Error("Reviewed import file identity changed before read.")
    const targetHandle = await open(temporary, "wx", 0o600)
    const digest = createHash("sha256")
    try {
      let position = 0
      const buffer = Buffer.allocUnsafe(64 * 1024)
      while (position < bytes) {
        const { bytesRead } = await sourceHandle.read(
          buffer,
          0,
          Math.min(buffer.length, bytes - position),
          position,
        )
        if (bytesRead === 0) break
        const chunk = buffer.subarray(0, bytesRead)
        digest.update(chunk)
        await targetHandle.write(chunk)
        position += bytesRead
      }
      if (position !== bytes) throw new Error(`Portable file changed while copying: ${source}`)
      await targetHandle.sync()
    } finally {
      await targetHandle.close()
    }
    const finalInfo = await sourceHandle.stat({ bigint: true })
    const finalPathInfo = await lstat(source, { bigint: true })
    assertRegularPathSnapshot(source, finalPathInfo)
    if (!sameFileSnapshot(info, finalInfo) || !sameFileSnapshot(info, finalPathInfo))
      throw new Error(`Portable file changed while copying: ${source}`)
    if (expected?.sha256 && digest.digest("hex") !== expected.sha256)
      throw new Error("Reviewed import file content changed before read.")
    await rename(temporary, target)
  } finally {
    await sourceHandle.close()
    await rm(temporary, { force: true })
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, stableJson(value), { mode: 0o600 })
  await rename(temporary, path)
}

export async function readJsonFile<T>(
  path: string,
  maxBytes = 16_000_000,
  options: { useNoFollowFlag?: boolean; afterOpen?: () => void | Promise<void> } = {},
): Promise<T> {
  const snapshot = await snapshotRegularFileNoFollow(path, {
    maxBytes,
    previewBytes: maxBytes,
    ...options,
  })
  return JSON.parse(snapshot.preview.toString("utf8")) as T
}

export async function assertSafeDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Path must be absolute.")
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Expected a non-symlink directory.")
  return realpath(path)
}

export async function assertSafeNewDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error("Path must be absolute.")
  const parent = await assertSafeDirectory(dirname(path))
  if (resolve(await realpath(dirname(path)), basename(path)) !== join(parent, basename(path))) {
    throw new Error("Output directory escapes its parent.")
  }
  try {
    await lstat(path)
    throw new Error("Output path already exists.")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

export async function resolveInsideRoot(root: string, relativePath: string): Promise<string> {
  safeRelativeBundlePathSchema.parse(relativePath)
  const canonicalRoot = await realpath(root)
  const target = resolve(canonicalRoot, relativePath)
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error("Path escapes registered root.")
  }
  return target
}

export async function listFiles(
  root: string,
  maxEntries = PORTABILITY_LIMITS.checksumEntries,
): Promise<string[]> {
  const canonicalRoot = await assertSafeDirectory(root)
  const output: string[] = []
  const pending = [canonicalRoot]
  let traversedEntries = 0
  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = await opendir(directory)
    for await (const entry of entries) {
      traversedEntries += 1
      if (traversedEntries > maxEntries)
        throw new Error(`Portable directory exceeds the ${maxEntries}-entry traversal limit.`)
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not portable: ${entry.name}`)
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile()) output.push(relative(canonicalRoot, absolute).split(sep).join("/"))
      else throw new Error(`Unsupported filesystem entry: ${entry.name}`)
    }
  }
  return output.sort()
}

function assertRegularPathSnapshot(path: string, info: BigIntStats): void {
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular non-symlink file: ${path}`)
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

export async function copyFileAtomic(source: string, target: string): Promise<void> {
  await copyRegularFileNoFollow(source, target)
}

export async function copyDirectory(sourceRoot: string, targetRoot: string): Promise<void> {
  await assertSafeDirectory(sourceRoot)
  await mkdir(targetRoot, { recursive: true, mode: 0o700 })
  for (const relativePath of await listFiles(sourceRoot)) {
    await copyRegularFileNoFollow(join(sourceRoot, relativePath), join(targetRoot, relativePath))
  }
}

export async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}
