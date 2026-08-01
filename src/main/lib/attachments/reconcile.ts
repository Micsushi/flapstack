import { app } from "electron"
import { createHash } from "node:crypto"
import { lstat, opendir } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { attachments, getDatabase } from "../db"
import { readFileInsideRoot, removeFileInsideRoot, renamePathInsideRoot } from "../path-safety"
import { attachmentRootForUserData } from "./paths"

const DELETE_QUARANTINE_PREFIX = ".flapstack-delete-"
const DELETE_QUARANTINE_SUFFIX = ".quarantine"

export type AttachmentReconciliationResult = {
  scanned: number
  removed: number
  restored: number
  skipped: number
  errors: number
  truncated: boolean
}

export function attachmentDeletionQuarantineName(_originalName: string, token: string): string {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(token)) {
    throw new Error("Invalid attachment quarantine token")
  }
  return `${DELETE_QUARANTINE_PREFIX}${token}${DELETE_QUARANTINE_SUFFIX}`
}

function isDeletionQuarantine(name: string): boolean {
  return name.startsWith(DELETE_QUARANTINE_PREFIX) && name.endsWith(DELETE_QUARANTINE_SUFFIX)
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

/**
 * Bounded startup-safe reconciliation for import orphans and interrupted
 * delete quarantines. It never follows symlinks and only mutates regular files
 * in the registered two-level attachment namespace.
 */
export async function reconcileAttachmentStorage(
  options: { maxEntries?: number; minAgeMs?: number; now?: number } = {},
): Promise<AttachmentReconciliationResult> {
  const maxEntries = Math.max(1, Math.min(options.maxEntries ?? 2_000, 20_000))
  const minAgeMs = Math.max(0, options.minAgeMs ?? 60 * 60 * 1000)
  const now = options.now ?? Date.now()
  const rootPath = resolve(attachmentRootForUserData(app.getPath("userData")))
  const result: AttachmentReconciliationResult = {
    scanned: 0,
    removed: 0,
    restored: 0,
    skipped: 0,
    errors: 0,
    truncated: false,
  }
  const referencedPaths = new Set<string>()
  const referencedByDirectory = new Map<
    string,
    {
      path: string
      sourceKind: string | null
      byteLength: number | null
      sha256: string | null
    }
  >()
  for (const row of getDatabase()
    .select({
      storedPath: attachments.storedPath,
      sourceKind: attachments.sourceKind,
      byteLength: attachments.byteLength,
      sha256: attachments.sha256,
    })
    .from(attachments)
    .all()) {
    if (!row.storedPath) continue
    const storedPath = resolve(row.storedPath)
    if (!isInsideRoot(rootPath, storedPath)) continue
    referencedPaths.add(storedPath)
    referencedByDirectory.set(dirname(storedPath), {
      path: storedPath,
      sourceKind: row.sourceKind,
      byteLength: row.byteLength,
      sha256: row.sha256,
    })
  }

  let visited = 0
  let rootDirectory
  try {
    rootDirectory = await opendir(rootPath)
  } catch (error) {
    if (missing(error)) return result
    throw error
  }

  outer: for await (const directoryEntry of rootDirectory) {
    visited += 1
    if (visited > maxEntries) {
      result.truncated = true
      break
    }
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
      result.skipped += 1
      continue
    }

    const directoryPath = resolve(rootPath, directoryEntry.name)
    let attachmentDirectory
    try {
      attachmentDirectory = await opendir(directoryPath)
    } catch {
      result.errors += 1
      continue
    }
    for await (const fileEntry of attachmentDirectory) {
      visited += 1
      if (visited > maxEntries) {
        result.truncated = true
        break outer
      }
      result.scanned += 1
      if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) {
        result.skipped += 1
        continue
      }

      const filePath = resolve(directoryPath, fileEntry.name)
      const relativePath = relative(rootPath, filePath)
      try {
        if (isDeletionQuarantine(fileEntry.name)) {
          const referenced = referencedByDirectory.get(directoryPath)
          if (referenced) {
            try {
              await lstat(referenced.path)
              if (referenced.sourceKind !== "upload") {
                // Legacy rows have no trustworthy digest, so a competing
                // original/quarantine pair is ambiguous and must be retained.
                result.skipped += 1
                continue
              }
              const originalRelativePath = relative(rootPath, referenced.path)
              if (!(await matchesUploadProvenance(rootPath, originalRelativePath, referenced))) {
                // Preserve the quarantine when the visible original is a
                // replacement; deleting either copy would destroy recovery.
                result.errors += 1
                continue
              }
            } catch (error) {
              if (!missing(error)) throw error
              if (referenced.sourceKind === "upload") {
                if (!(await matchesUploadProvenance(rootPath, relativePath, referenced))) {
                  throw new Error("Attachment quarantine integrity verification failed")
                }
              } else if (
                referenced.sourceKind !== null ||
                referenced.byteLength !== null ||
                referenced.sha256 !== null
              ) {
                throw new Error("Attachment legacy quarantine provenance is inconsistent")
              }
              await renamePathInsideRoot(rootPath, relativePath, basename(referenced.path))
              result.restored += 1
              continue
            }
          }
        } else if (referencedPaths.has(filePath)) {
          continue
        }

        const info = await lstat(filePath)
        if (minAgeMs > 0 && now - info.mtimeMs < minAgeMs) {
          result.skipped += 1
          continue
        }
        await removeFileInsideRoot(rootPath, relativePath, { removeEmptyParent: true })
        result.removed += 1
      } catch {
        result.errors += 1
      }
    }
  }

  return result
}

async function matchesUploadProvenance(
  rootPath: string,
  relativePath: string,
  provenance: { byteLength: number | null; sha256: string | null },
): Promise<boolean> {
  if (
    provenance.byteLength === null ||
    provenance.byteLength < 0 ||
    provenance.sha256 === null ||
    !/^[a-f0-9]{64}$/.test(provenance.sha256)
  ) {
    return false
  }
  try {
    const data = await readFileInsideRoot(rootPath, relativePath, {
      maxBytes: provenance.byteLength,
    })
    return (
      data.byteLength === provenance.byteLength &&
      createHash("sha256").update(data).digest("hex") === provenance.sha256
    )
  } catch {
    return false
  }
}
