import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, link, lstat, open, realpath, rename, rm, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, normalize } from "node:path"
import {
  FLAPSHOT_CAPABILITIES_URI,
  type FlapshotAuthorizedFileReference,
  type FlapshotFileReference,
} from "./contracts"

export const FLAPSHOT_ATTACHMENT_LIMITS = {
  maxImageBytes: 64 * 1024 * 1024,
  maxVideoBytes: 2 * 1024 * 1024 * 1024,
  maxCopiedVideoBytes: 128 * 1024 * 1024,
} as const

export type FlapshotIntegrityStatus = "verified" | "missing" | "tampered"
export type FlapshotIntegrityResult = { status: FlapshotIntegrityStatus; message: string }

export interface ValidatedFlapshotFile {
  canonicalPath: string
  mimeType: FlapshotFileReference["mimeType"]
  sizeBytes: number
  sha256: string
  sourceArtifactId: string | null
  copyIntoFlapstack: boolean
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function sniffMime(filePath: string): Promise<FlapshotFileReference["mimeType"] | null> {
  const handle = await open(filePath, "r")
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      return "image/png"
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg"
    }
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp"
    }
    if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
      return "video/mp4"
    }
    if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))) {
      return "video/webm"
    }
    return null
  } finally {
    await handle.close()
  }
}

export function flapshotArtifactResourceUri(artifactId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifactId)) {
    throw new Error("Flapshot artifact ID is invalid")
  }
  return `flapshot://v1/artifacts/${encodeURIComponent(artifactId)}/file-reference`
}

export function validateFlapshotResourceUri(uri: string, artifactId: string): void {
  if (uri === FLAPSHOT_CAPABILITIES_URI) return
  if (uri !== flapshotArtifactResourceUri(artifactId)) {
    throw new Error("Flapshot resource URI does not match the artifact ID")
  }
}

export async function validateFlapshotFileReference(
  reference: FlapshotAuthorizedFileReference,
  expectedClientId?: string,
): Promise<ValidatedFlapshotFile> {
  if (reference.kind === "managed-artifact" && !reference.artifactId) {
    throw new Error("Managed Flapshot reference is missing an artifact ID")
  }
  if (reference.local.expiresAt !== undefined) {
    const expiry = Date.parse(reference.local.expiresAt)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw new Error("Flapshot local path grant expired")
    }
  }
  if (expectedClientId && reference.local.grantedToClientId !== expectedClientId) {
    throw new Error("Flapshot local path grant belongs to another authenticated client")
  }
  if (
    !isAbsolute(reference.local.path) ||
    normalize(reference.local.path) !== reference.local.path
  ) {
    throw new Error("Flapshot local path is not canonical")
  }

  const linkInfo = await lstat(reference.local.path)
  if (linkInfo.isSymbolicLink()) throw new Error("Flapshot local path must not be a symlink")
  const canonicalPath = await realpath(reference.local.path)
  const fileInfo = await stat(canonicalPath)
  if (!fileInfo.isFile()) throw new Error("Flapshot local path is not a regular file")
  if (fileInfo.size !== reference.sizeBytes) throw new Error("Flapshot file size does not match")

  const mediaType = reference.mimeType.startsWith("image/") ? "image" : "video"
  const maxBytes =
    mediaType === "image"
      ? FLAPSHOT_ATTACHMENT_LIMITS.maxImageBytes
      : FLAPSHOT_ATTACHMENT_LIMITS.maxVideoBytes
  if (fileInfo.size > maxBytes)
    throw new Error(`Flapshot ${mediaType} exceeds the attachment limit`)
  const detectedMime = await sniffMime(canonicalPath)
  if (detectedMime !== reference.mimeType)
    throw new Error("Flapshot file MIME signature does not match")
  const digest = await sha256File(canonicalPath)
  if (digest !== reference.sha256.toLowerCase())
    throw new Error("Flapshot file SHA-256 does not match")

  return {
    canonicalPath,
    mimeType: reference.mimeType,
    sizeBytes: fileInfo.size,
    sha256: digest,
    sourceArtifactId: reference.artifactId ?? null,
    copyIntoFlapstack:
      mediaType === "image" || fileInfo.size <= FLAPSHOT_ATTACHMENT_LIMITS.maxCopiedVideoBytes,
  }
}

export async function verifyStoredFlapshotFile(input: {
  filePath: string | null
  sizeBytes: number | null
  sha256: string | null
  mimeType: string | null
  grantExpiresAt?: string | null
}): Promise<FlapshotIntegrityResult> {
  if (!input.filePath || input.sizeBytes === null || !input.sha256 || !input.mimeType) {
    return { status: "tampered", message: "Attachment integrity metadata is incomplete" }
  }
  if (
    input.grantExpiresAt !== undefined &&
    input.grantExpiresAt !== null &&
    (!Number.isFinite(Date.parse(input.grantExpiresAt)) ||
      Date.parse(input.grantExpiresAt) <= Date.now())
  ) {
    return { status: "tampered", message: "Flapshot local path grant expired" }
  }
  try {
    const linkInfo = await lstat(input.filePath)
    if (linkInfo.isSymbolicLink())
      return { status: "tampered", message: "Attachment became a symlink" }
    const canonical = await realpath(input.filePath)
    if (canonical !== input.filePath) {
      return { status: "tampered", message: "Attachment path is no longer canonical" }
    }
    const fileInfo = await stat(input.filePath)
    if (!fileInfo.isFile() || fileInfo.size !== input.sizeBytes) {
      return { status: "tampered", message: "Attachment size changed" }
    }
    const detectedMime = await sniffMime(input.filePath)
    if (detectedMime !== input.mimeType) {
      return { status: "tampered", message: "Attachment MIME signature changed" }
    }
    const digest = await sha256File(input.filePath)
    return digest === input.sha256.toLowerCase()
      ? { status: "verified", message: "Attachment hash verified" }
      : { status: "tampered", message: "Attachment SHA-256 changed" }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", message: "Attachment file is missing" }
    }
    throw error
  }
}

export async function copyVerifiedFlapshotFile(input: {
  sourcePath: string
  destinationPath: string
  overwrite: boolean
  sizeBytes: number | null
  sha256: string | null
  mimeType: string | null
  grantExpiresAt?: string | null
}): Promise<FlapshotIntegrityResult> {
  const expected = {
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    mimeType: input.mimeType,
  }
  const sourceResult = await verifyStoredFlapshotFile({
    filePath: input.sourcePath,
    ...expected,
    grantExpiresAt: input.grantExpiresAt,
  })
  if (sourceResult.status !== "verified") return sourceResult

  const temporaryPath = join(
    dirname(input.destinationPath),
    `.flapstack-verified-${randomUUID()}.tmp`,
  )
  try {
    await copyFile(input.sourcePath, temporaryPath)
    const copiedResult = await verifyStoredFlapshotFile({
      filePath: temporaryPath,
      ...expected,
    })
    if (copiedResult.status !== "verified") return copiedResult
    if (input.overwrite) {
      await rename(temporaryPath, input.destinationPath)
    } else {
      await link(temporaryPath, input.destinationPath)
      await rm(temporaryPath, { force: true })
    }
    return copiedResult
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", message: "Attachment file disappeared during copy" }
    }
    throw error
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
