import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { mkdir, rm } from "node:fs/promises"
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
  type BigIntStats,
} from "node:fs"
import { tmpdir } from "node:os"
import type {
  PortableExclusionEntry,
  PortableManifestScope,
  PortableScopeId,
} from "../../../shared/portability"
import { PORTABILITY_LIMITS } from "../../../shared/portability"
import { sanitizeStructuredValue } from "./secrets"
import { stableJson } from "./io"

export const PORTABLE_RECORDS_SCHEMA_VERSION = 1
export const PORTABLE_LOCAL_PATH_PREFIX = "__FLAPSTACK_LOCAL_PATH__/"

export type PortableDatabaseRecord = {
  scopeId: PortableScopeId
  tableName: string
  identity: Record<string, unknown>
  row: Record<string, unknown>
}

export type PortableDatabaseExport = {
  recordCount: number
  exclusions: PortableExclusionEntry[]
}

const NEVER_EXPORT_TABLES = new Set([
  "claude_code_credentials",
  "anthropic_accounts",
  "mobile_pairing_tokens",
  "mobile_auth_challenges",
  "mobile_device_sessions",
  "mobile_session_nonces",
  "mcp_approval_requests",
])

export function scopeForTable(tableName: string): PortableScopeId | null {
  if (
    tableName === "projects" ||
    tableName === "tasks" ||
    tableName === "plan_source_registrations"
  )
    return "projects"
  if (tableName === "extension_enablement_policies") return "extensions"
  if (tableName.startsWith("project_vault")) return "project-vaults"
  if (tableName.startsWith("saved_workspace")) return "saved-workspaces"
  if (tableName.startsWith("usage_")) return "usage"
  if (
    [
      "chats",
      "sub_chats",
      "agent_runs",
      "checkpoints",
      "file_change_manifests",
      "attachments",
      "voice_artifacts",
      "task_orchestrations",
      "orchestration_agents",
    ].includes(tableName)
  )
    return "history"
  return null
}

export async function createPortableDatabase(input: {
  sourcePath: string
  destinationPath: string
  scopes: readonly PortableManifestScope[]
  approvedFalsePositiveHashes?: ReadonlySet<string>
  signal?: AbortSignal
}): Promise<PortableDatabaseExport> {
  await mkdir(dirname(input.destinationPath), { recursive: true, mode: 0o700 })
  const snapshotPath = join(dirname(input.destinationPath), `.source-${randomUUID()}.sqlite3`)
  const source = new Database(input.sourcePath, { readonly: true, fileMustExist: true })
  source.pragma("busy_timeout = 5000")
  try {
    await source.backup(snapshotPath)
  } finally {
    source.close()
  }

  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
  const portable = new Database(input.destinationPath)
  const exclusions: PortableExclusionEntry[] = []
  let recordCount = 0
  let recordJsonBytes = 0
  try {
    portable.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA foreign_keys = ON;
      CREATE TABLE portable_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE portable_records (
        scope_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        identity_json TEXT NOT NULL,
        row_json TEXT NOT NULL,
        PRIMARY KEY (scope_id, table_name, identity_json)
      );
    `)
    portable
      .prepare("INSERT INTO portable_metadata (key, value) VALUES (?, ?)")
      .run("schema_version", String(PORTABLE_RECORDS_SCHEMA_VERSION))
    const insert = portable.prepare(
      "INSERT INTO portable_records (scope_id, table_name, identity_json, row_json) VALUES (?, ?, ?, ?)",
    )
    const selected = new Map(input.scopes.map((scope) => [scope.id, scope]))
    const tables = snapshot
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
    const exportTransaction = portable.transaction(() => {
      for (const { name: tableName } of tables) {
        throwIfAborted(input.signal)
        const scopeId = scopeForTable(tableName)
        if (
          !scopeId ||
          !selected.has(scopeId) ||
          NEVER_EXPORT_TABLES.has(tableName) ||
          tableName === "__drizzle_migrations"
        ) {
          if (rowCount(snapshot, tableName) > 0 && scopeId && selected.has(scopeId)) {
            exclusions.push({
              scopeId,
              category: "credential",
              sensitivity: "secret-bearing",
              reason: `Sensitive table ${tableName} excluded.`,
            })
          }
          continue
        }
        const scope = selected.get(scopeId)!
        const columns = tableColumns(snapshot, tableName)
        const projectFilter = scope.projectIds
          ? projectFilterForTable(snapshot, tableName, columns, scope.projectIds)
          : null
        if (scope.projectIds && !projectFilter) {
          exclusions.push({
            scopeId,
            category: "unsupported",
            sensitivity: "private",
            reason: `Table ${tableName} has no direct project filter and was excluded from a filtered export.`,
          })
          continue
        }
        const primaryKeys = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk)
        if (primaryKeys.length === 0) {
          exclusions.push({
            scopeId,
            category: "unsupported",
            sensitivity: "private",
            reason: `Table ${tableName} has no stable primary key and was excluded.`,
          })
          continue
        }
        const query = projectFilter
          ? `SELECT * FROM ${quoteIdentifier(tableName)} WHERE ${projectFilter.sql} ORDER BY ${primaryKeys.map((column) => quoteIdentifier(column.name)).join(",")}`
          : `SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY ${primaryKeys.map((column) => quoteIdentifier(column.name)).join(",")}`
        const rows = snapshot
          .prepare(query)
          .iterate(...(projectFilter?.parameters ?? [])) as Iterable<Record<string, unknown>>
        for (const rawRow of rows) {
          throwIfAborted(input.signal)
          const encoded = encodePortableRow(rawRow)
          const localPaths = sanitizeLocalPaths(tableName, scopeId, encoded)
          exclusions.push(...localPaths.exclusions)
          const sanitized = sanitizeStructuredValue(localPaths.row, {
            scopeId,
            path: `scopes/${scopeId}/database/${tableName}`,
            approvedFalsePositiveHashes: input.approvedFalsePositiveHashes,
          })
          exclusions.push(...sanitized.exclusions)
          const identity = Object.fromEntries(
            primaryKeys.map((column) => [column.name, encoded[column.name]]),
          )
          const identityJson = stableJson(identity)
          const rowJson = stableJson(sanitized.value)
          if (
            Buffer.byteLength(identityJson) > PORTABILITY_LIMITS.recordJsonBytes ||
            Buffer.byteLength(rowJson) > PORTABILITY_LIMITS.recordJsonBytes
          )
            throw new Error("Portable database record exceeds the JSON size limit.")
          recordCount += 1
          if (recordCount > PORTABILITY_LIMITS.databaseRecords)
            throw new Error("Portable database record count exceeds the supported limit.")
          recordJsonBytes += Buffer.byteLength(identityJson) + Buffer.byteLength(rowJson)
          if (recordJsonBytes > PORTABILITY_LIMITS.totalRecordJsonBytes)
            throw new Error("Portable database JSON exceeds the supported total size limit.")
          insert.run(scopeId, tableName, identityJson, rowJson)
        }
      }
    })
    exportTransaction.immediate()
    portable.pragma("wal_checkpoint(TRUNCATE)")
    return { recordCount, exclusions }
  } finally {
    portable.close()
    snapshot.close()
    await rm(snapshotPath, { force: true })
    await rm(`${snapshotPath}-wal`, { force: true })
    await rm(`${snapshotPath}-shm`, { force: true })
  }
}

type ProjectFilter = { sql: string; parameters: string[] }

function projectFilterForTable(
  database: Database.Database,
  tableName: string,
  columns: readonly { name: string }[],
  projectIds: readonly string[],
): ProjectFilter | null {
  const placeholders = projectIds.map(() => "?").join(",")
  const directColumn = directProjectFilterColumn(tableName, columns)
  if (directColumn) {
    return {
      sql: `${quoteIdentifier(directColumn)} IN (${placeholders})`,
      parameters: [...projectIds],
    }
  }
  const relation = PROJECT_FILTER_RELATIONS[tableName]
  if (!relation || relation.requiredTables.some((name) => !tableExists(database, name))) return null
  return {
    sql: relation.sql(placeholders),
    parameters: [...projectIds],
  }
}

function directProjectFilterColumn(
  tableName: string,
  columns: readonly { name: string }[],
): string | null {
  const declared: Readonly<Record<string, string>> = {
    projects: "id",
    tasks: "project_id",
    plan_source_registrations: "project_id",
    extension_enablement_policies: "project_id",
    chats: "project_id",
  }
  const configured = declared[tableName]
  if (configured) return columns.some((column) => column.name === configured) ? configured : null
  if (tableName.startsWith("project_vault") || tableName.startsWith("saved_workspace"))
    return columns.some((column) => column.name === "project_id") ? "project_id" : null
  if (tableName.startsWith("usage_")) {
    if (columns.some((column) => column.name === "project_id")) return "project_id"
    if (columns.some((column) => column.name === "attribution_project_id"))
      return "attribution_project_id"
  }
  return null
}

const PROJECT_FILTER_RELATIONS: Readonly<
  Record<string, { requiredTables: readonly string[]; sql(placeholders: string): string }>
> = {
  sub_chats: {
    requiredTables: ["chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM chats WHERE chats.id = sub_chats.chat_id AND chats.project_id IN (${ids}))`,
  },
  agent_runs: {
    requiredTables: ["chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM chats WHERE chats.id = agent_runs.chat_id AND chats.project_id IN (${ids}))`,
  },
  checkpoints: {
    requiredTables: ["agent_runs", "chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM agent_runs JOIN chats ON chats.id = agent_runs.chat_id WHERE agent_runs.id = checkpoints.run_id AND chats.project_id IN (${ids}))`,
  },
  file_change_manifests: {
    requiredTables: ["agent_runs", "chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM agent_runs JOIN chats ON chats.id = agent_runs.chat_id WHERE agent_runs.id = file_change_manifests.run_id AND chats.project_id IN (${ids}))`,
  },
  attachments: {
    requiredTables: ["chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM chats WHERE chats.id = attachments.chat_id AND chats.project_id IN (${ids}))`,
  },
  voice_artifacts: {
    requiredTables: ["chats"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM chats WHERE chats.id = voice_artifacts.chat_id AND chats.project_id IN (${ids}))`,
  },
  task_orchestrations: {
    requiredTables: ["tasks"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_orchestrations.task_id AND tasks.project_id IN (${ids}))`,
  },
  orchestration_agents: {
    requiredTables: ["tasks"],
    sql: (ids) =>
      `EXISTS (SELECT 1 FROM tasks WHERE tasks.id = orchestration_agents.task_id AND tasks.project_id IN (${ids}))`,
  },
}

function sanitizeLocalPaths(
  tableName: string,
  scopeId: PortableScopeId,
  row: Record<string, unknown>,
): { row: Record<string, unknown>; exclusions: PortableExclusionEntry[] } {
  const output = { ...row }
  const exclusions: PortableExclusionEntry[] = []
  const rules = LOCAL_PATH_RULES[tableName]
  if (!rules) return { row: output, exclusions }
  for (const [column, mode] of Object.entries(rules)) {
    if (!(column in output) || output[column] === null || output[column] === "") continue
    const identity = String(output.project_id ?? output.id ?? "record")
    output[column] =
      mode === "project-root"
        ? `${PORTABLE_LOCAL_PATH_PREFIX}projects/${encodeURIComponent(identity)}`
        : mode === "vault-root"
          ? `${PORTABLE_LOCAL_PATH_PREFIX}project-vaults/${encodeURIComponent(identity)}`
          : null
    exclusions.push({
      scopeId,
      path: `scopes/${scopeId}/database/${tableName}/${column}`,
      category: "local-path",
      sensitivity: "private",
      reason: "Machine-local path excluded; import requires a reviewed target mapping when needed.",
    })
  }
  return { row: output, exclusions }
}

const LOCAL_PATH_RULES: Readonly<
  Record<string, Readonly<Record<string, "project-root" | "vault-root" | "exclude">>>
> = {
  projects: { path: "project-root", icon_path: "exclude" },
  project_vault_policies: { central_path: "vault-root", project_owned_path: "exclude" },
  project_vaults: { root_path: "vault-root" },
  tasks: { source_path: "exclude", primary_worktree_path: "exclude" },
  task_proposals: { source_path: "exclude" },
  chats: { worktree_path: "exclude" },
  sub_chats: { worktree_path: "exclude" },
  agent_runs: { worktree_path: "exclude" },
  checkpoints: { worktree_path: "exclude" },
  attachments: { source_path: "exclude", stored_path: "exclude" },
  voice_artifacts: { audio_path: "exclude" },
}

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName),
  )
}

export function readPortableDatabase(
  path: string,
  options: { useNoFollowFlag?: boolean; afterOpen?: () => void } = {},
): PortableDatabaseRecord[] {
  const snapshot = createPortableDatabaseSnapshot(path, options)
  let database: Database.Database | undefined
  try {
    database = new Database(snapshot.path, { readonly: true, fileMustExist: true })
    const version = database
      .prepare("SELECT value FROM portable_metadata WHERE key = 'schema_version'")
      .pluck()
      .get()
    if (Number(version) !== PORTABLE_RECORDS_SCHEMA_VERSION)
      throw new Error("Unsupported portable database schema.")
    const bounds = database
      .prepare(
        `SELECT COUNT(*) AS record_count,
                COALESCE(MAX(length(CAST(identity_json AS BLOB))), 0) AS max_identity_bytes,
                COALESCE(MAX(length(CAST(row_json AS BLOB))), 0) AS max_row_bytes,
                COALESCE(SUM(length(CAST(identity_json AS BLOB)) + length(CAST(row_json AS BLOB))), 0) AS total_json_bytes
         FROM portable_records`,
      )
      .get() as {
      record_count: number
      max_identity_bytes: number
      max_row_bytes: number
      total_json_bytes: number
    }
    if (bounds.record_count > PORTABILITY_LIMITS.databaseRecords)
      throw new Error("Portable database record count exceeds the supported limit.")
    if (
      bounds.max_identity_bytes > PORTABILITY_LIMITS.recordJsonBytes ||
      bounds.max_row_bytes > PORTABILITY_LIMITS.recordJsonBytes
    )
      throw new Error("Portable database record exceeds the JSON size limit.")
    if (bounds.total_json_bytes > PORTABILITY_LIMITS.totalRecordJsonBytes)
      throw new Error("Portable database JSON exceeds the supported total size limit.")
    const rows = database
      .prepare(
        "SELECT scope_id, table_name, identity_json, row_json FROM portable_records ORDER BY scope_id, table_name, identity_json",
      )
      .iterate() as Iterable<{
      scope_id: PortableScopeId
      table_name: string
      identity_json: string
      row_json: string
    }>
    const output: PortableDatabaseRecord[] = []
    for (const row of rows) {
      output.push({
        scopeId: row.scope_id,
        tableName: row.table_name,
        identity: JSON.parse(row.identity_json) as Record<string, unknown>,
        row: JSON.parse(row.row_json) as Record<string, unknown>,
      })
    }
    return output
  } finally {
    database?.close()
    rmSync(snapshot.root, { recursive: true, force: true })
  }
}

function createPortableDatabaseSnapshot(
  path: string,
  options: { useNoFollowFlag?: boolean; afterOpen?: () => void },
): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "flapstack-portable-db-"))
  const destinationPath = join(root, "portable.sqlite3")
  let sourceDescriptor: number | undefined
  let destinationDescriptor: number | undefined
  try {
    const pathInfo = lstatSync(path, { bigint: true })
    assertPortableDatabaseFile(pathInfo)
    const noFollowFlag = options.useNoFollowFlag === false ? 0 : (constants.O_NOFOLLOW ?? 0)
    sourceDescriptor = openSync(path, constants.O_RDONLY | noFollowFlag)
    const openedInfo = fstatSync(sourceDescriptor, { bigint: true })
    assertPortableDatabaseFile(openedInfo)
    if (!samePortableDatabaseFile(pathInfo, openedInfo))
      throw new Error("Portable database identity changed while opening.")
    const bytes = Number(openedInfo.size)
    if (!Number.isSafeInteger(bytes) || bytes > PORTABILITY_LIMITS.databaseBytes)
      throw new Error("Portable database exceeds the supported size limit.")
    options.afterOpen?.()
    destinationDescriptor = openSync(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    )
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < bytes) {
      const bytesRead = readSync(
        sourceDescriptor,
        buffer,
        0,
        Math.min(buffer.length, bytes - position),
        position,
      )
      if (bytesRead === 0) break
      let written = 0
      while (written < bytesRead) {
        written += writeSync(destinationDescriptor, buffer, written, bytesRead - written)
      }
      position += bytesRead
    }
    if (position !== bytes) throw new Error("Portable database changed while copying.")
    const finalOpenedInfo = fstatSync(sourceDescriptor, { bigint: true })
    const finalPathInfo = lstatSync(path, { bigint: true })
    assertPortableDatabaseFile(finalPathInfo)
    if (
      !samePortableDatabaseFile(openedInfo, finalOpenedInfo) ||
      !samePortableDatabaseFile(openedInfo, finalPathInfo)
    )
      throw new Error("Portable database changed while copying.")
    closeSync(destinationDescriptor)
    destinationDescriptor = undefined
    closeSync(sourceDescriptor)
    sourceDescriptor = undefined
    return { root, path: destinationPath }
  } catch (error) {
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor)
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor)
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function assertPortableDatabaseFile(info: BigIntStats): void {
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Portable database must be a regular non-symlink file.")
}

function samePortableDatabaseFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

export function decodePortableRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value)]))
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function tableColumns(
  database: Database.Database,
  tableName: string,
): Array<{ name: string; pk: number }> {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{
    name: string
    pk: number
  }>
}

function rowCount(database: Database.Database, tableName: string): number {
  return Number(
    database
      .prepare(`SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`)
      .pluck()
      .get() ?? 0,
  )
}

export function encodePortableRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)]))
}

function encodeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $flapstack: "bytes", base64: value.toString("base64") }
  if (typeof value === "bigint") return { $flapstack: "bigint", value: value.toString() }
  return value
}

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const tagged = value as Record<string, unknown>
  if (tagged.$flapstack === "bytes" && typeof tagged.base64 === "string")
    return Buffer.from(tagged.base64, "base64")
  if (tagged.$flapstack === "bigint" && typeof tagged.value === "string")
    return BigInt(tagged.value)
  return value
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Portability operation cancelled.", "AbortError")
}
