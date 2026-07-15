import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"
import {
  PORTABLE_BUNDLE_FORMAT,
  PORTABLE_BUNDLE_LAYOUT,
  PORTABLE_BUNDLE_VERSION,
  PORTABLE_CHECKSUM_VERSION,
  PORTABLE_EXCLUSION_VERSION,
  PORTABILITY_LIMITS,
  portableBundleDirectoryNameSchema,
  portableCollisionKey,
  portableChecksumDocumentSchema,
  portableExclusionDocumentSchema,
  type PortableChecksumEntry,
  type PortableExclusionEntry,
  type PortableManifest,
  type PortableScopeId,
  safeRelativeBundlePathSchema,
} from "../../../shared/portability"
import { portableScopeRegistry, type PortableScopeSelection } from "./scope-registry"
import { createPortableDatabase, readPortableDatabase } from "./database"
import {
  assertSafeNewDirectory,
  listFiles,
  sha256File,
  snapshotRegularFileNoFollow,
  stableJson,
} from "./io"
import { redactText } from "./secrets"

export type PortableFileSource = {
  scopeId: Extract<PortableScopeId, "settings" | "extensions" | "project-vaults" | "history">
  root: string
  include?: readonly string[]
  target:
    | { kind: "config" }
    | { kind: "extensions" }
    | { kind: "project-vault"; projectId: string }
    | { kind: "history-files"; projectId?: string }
}

export type PortableFileIndexEntry = {
  bundlePath: string
  relativePath: string
  target: PortableFileSource["target"]
  sha256: string
  bytes: number
}

export type CreatePortableExportInput = {
  outputPath: string
  databasePath: string
  appVersion: string
  selection: readonly PortableScopeSelection[]
  fileSources?: readonly PortableFileSource[]
  approvedFalsePositiveHashes?: ReadonlySet<string>
  now?: () => Date
  signal?: AbortSignal
}

export type CreatePortableExportResult = {
  outputPath: string
  manifest: PortableManifest
  checksums: PortableChecksumEntry[]
  exclusions: PortableExclusionEntry[]
  databaseRecords: number
  fileCount: number
}

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml",
  ".csv",
])

export async function createPortableExport(
  input: CreatePortableExportInput,
): Promise<CreatePortableExportResult> {
  portableBundleDirectoryNameSchema.parse(basename(input.outputPath))
  await assertSafeNewDirectory(input.outputPath)
  const partial = join(
    dirname(input.outputPath),
    `.${basename(input.outputPath)}.partial-${randomUUID()}`,
  )
  await mkdir(partial, { recursive: false, mode: 0o700 })
  try {
    throwIfAborted(input.signal)
    const scopes = portableScopeRegistry.resolveSelection(input.selection)
    const manifest: PortableManifest = {
      format: PORTABLE_BUNDLE_FORMAT,
      bundleVersion: PORTABLE_BUNDLE_VERSION,
      directoryName: basename(input.outputPath),
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      appVersion: input.appVersion,
      layout: {
        database: PORTABLE_BUNDLE_LAYOUT.database,
        checksums: PORTABLE_BUNDLE_LAYOUT.checksums,
        exclusions: PORTABLE_BUNDLE_LAYOUT.exclusions,
        scopesRoot: PORTABLE_BUNDLE_LAYOUT.scopesRoot,
      },
      scopes,
    }
    portableScopeRegistry.validateManifest(manifest)
    await writeFile(join(partial, PORTABLE_BUNDLE_LAYOUT.manifest), stableJson(manifest), {
      mode: 0o600,
    })

    const database = await createPortableDatabase({
      sourcePath: input.databasePath,
      destinationPath: join(partial, PORTABLE_BUNDLE_LAYOUT.database),
      scopes,
      approvedFalsePositiveHashes: input.approvedFalsePositiveHashes,
      signal: input.signal,
    })
    const exclusions = [...database.exclusions]
    let fileCount = 0
    for (const scope of scopes) {
      throwIfAborted(input.signal)
      const scopeRoot = join(partial, scope.contentPath)
      await mkdir(scopeRoot, { recursive: true, mode: 0o700 })
      const sources = (input.fileSources ?? []).filter((source) => {
        if (source.scopeId !== scope.id) return false
        if (source.target.kind === "project-vault" && scope.projectIds) {
          return scope.projectIds.includes(source.target.projectId)
        }
        return true
      })
      const fileIndex: PortableFileIndexEntry[] = []
      for (const [sourceIndex, source] of sources.entries()) {
        const info = await lstat(source.root)
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Portable source root must be a non-symlink directory.")
        const allowed = source.include ? new Set(source.include) : null
        const relativePaths = (await listFiles(source.root)).filter(
          (relativePath) => !allowed || allowed.has(relativePath),
        )
        for (const relativePath of relativePaths) {
          throwIfAborted(input.signal)
          if (fileCount >= PORTABILITY_LIMITS.checksumEntries - 8)
            throw new Error("Portable file count exceeds bundle limit.")
          if (!TEXT_EXTENSIONS.has(extname(relativePath).toLowerCase())) {
            exclusions.push({
              scopeId: source.scopeId,
              category: "unsupported",
              sensitivity: "private",
              reason: "Non-text file excluded from portable scope.",
            })
            continue
          }
          const sourcePath = join(source.root, relativePath)
          const sourceSnapshot = await snapshotRegularFileNoFollow(sourcePath, {
            maxBytes: PORTABILITY_LIMITS.fileBytes,
            previewBytes: PORTABILITY_LIMITS.fileBytes,
          })
          const raw = sourceSnapshot.preview.toString("utf8")
          const redacted = redactText(raw, {
            scopeId: source.scopeId,
            path: `${scope.contentPath}/files/${sourceIndex}/${relativePath}`,
            approvedFalsePositiveHashes: input.approvedFalsePositiveHashes,
          })
          exclusions.push(...redacted.exclusions)
          const bundlePath = `${scope.contentPath}/files/${sourceIndex}/${relativePath}`
          safeRelativeBundlePathSchema.parse(bundlePath)
          const destination = join(partial, bundlePath)
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
          await writeFile(destination, redacted.value, { mode: 0o600 })
          const digest = await sha256File(destination)
          fileIndex.push({ bundlePath, relativePath, target: source.target, ...digest })
          fileCount += 1
        }
      }
      await writeFile(join(scopeRoot, "files.json"), stableJson(fileIndex), { mode: 0o600 })
      if (scope.id === "usage") {
        const usageRecords = readPortableDatabase(join(partial, PORTABLE_BUNDLE_LAYOUT.database))
          .filter((record) => record.scopeId === "usage")
          .map((record) => ({
            table: record.tableName,
            identity: record.identity,
            row: record.row,
          }))
        await writeFile(
          join(scopeRoot, "usage.json"),
          stableJson({ schemaVersion: 1, records: usageRecords }),
          { mode: 0o600 },
        )
        await writeFile(
          join(scopeRoot, "usage.csv"),
          [
            "table,identity,row",
            ...usageRecords.map((record) =>
              [record.table, stableJson(record.identity).trim(), stableJson(record.row).trim()]
                .map(csvCell)
                .join(","),
            ),
          ].join("\n") + "\n",
          { mode: 0o600 },
        )
      }
    }

    const exclusionDocument = portableExclusionDocumentSchema.parse({
      schemaVersion: PORTABLE_EXCLUSION_VERSION,
      entries: sortExclusions(exclusions),
    })
    await writeFile(
      join(partial, PORTABLE_BUNDLE_LAYOUT.exclusions),
      stableJson(exclusionDocument),
      { mode: 0o600 },
    )
    const checksums = await checksumBundleFiles(partial, input.signal)
    const checksumDocument = portableChecksumDocumentSchema.parse({
      schemaVersion: PORTABLE_CHECKSUM_VERSION,
      algorithm: "sha256",
      entries: checksums,
    })
    await writeFile(join(partial, PORTABLE_BUNDLE_LAYOUT.checksums), stableJson(checksumDocument), {
      mode: 0o600,
    })
    throwIfAborted(input.signal)
    await rename(partial, input.outputPath)
    return {
      outputPath: input.outputPath,
      manifest,
      checksums,
      exclusions: exclusionDocument.entries,
      databaseRecords: database.recordCount,
      fileCount,
    }
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    throw error
  }
}

async function checksumBundleFiles(
  root: string,
  signal?: AbortSignal,
): Promise<PortableChecksumEntry[]> {
  const paths = (await listFiles(root)).filter((path) => path !== PORTABLE_BUNDLE_LAYOUT.checksums)
  if (paths.length > PORTABILITY_LIMITS.checksumEntries)
    throw new Error("Bundle contains too many files.")
  const entries: PortableChecksumEntry[] = []
  for (const path of paths) {
    throwIfAborted(signal)
    entries.push({ path, ...(await sha256File(join(root, path))) })
  }
  return entries
}

function sortExclusions(entries: readonly PortableExclusionEntry[]): PortableExclusionEntry[] {
  const seen = new Set<string>()
  return [...entries]
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
    .filter((entry) => {
      const key = portableCollisionKey(`${entry.scopeId}\0${entry.path ?? ""}\0${entry.category}`)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Portability operation cancelled.", "AbortError")
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
