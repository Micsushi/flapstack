import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { readFileInsideRoot, removeFileInsideRoot, writeFileInsideRoot } from "../path-safety"
import { assertProjectVaultContentSafe } from "./content-safety"
import { projectVaultSectionIds, type ProjectVaultSectionId } from "./registry"

const SEED_SCHEMA_VERSION = 2
const JOURNAL_PATH = ".flapstack-migrations/seed-identities-v2.json"
const MAX_SECTION_BYTES = 4_000_000

type SeedRow = {
  sectionId: ProjectVaultSectionId
  relativePath: string
  version: number
  originalHash: string
  originalBytes: number
  migratedHash: string
  migratedBytes: number
  backupRelativePath: string
}

type SeedMigrationJournal = {
  version: 1
  projectId: string
  seeds: SeedRow[]
}

export type ProjectVaultSeedMigrationHooks = {
  /** Test seam that simulates process interruption after a durable file replace. */
  afterSeedWrite?: (sectionId: ProjectVaultSectionId) => void | Promise<void>
}

export type ProjectVaultSeedMigrationResult = {
  migrated: boolean
  resumed: boolean
  seedCount: number
}

export async function migrateProjectVaultSeedIdentities(
  database: Database.Database | object,
  projectId: string,
  hooks: ProjectVaultSeedMigrationHooks = {},
): Promise<ProjectVaultSeedMigrationResult> {
  const sqlite = rawClient(database)
  const vault = sqlite
    .prepare(
      "SELECT root_path rootPath, schema_version schemaVersion FROM project_vaults WHERE project_id = ?",
    )
    .get(projectId) as { rootPath: string; schemaVersion: number } | undefined
  if (!vault) throw new Error("Project vault is not scaffolded.")
  const root = assertRegisteredFilesystemRoot(
    vault.rootPath,
    drizzle(sqlite, { schema }),
  ).canonicalPath

  if (vault.schemaVersion >= SEED_SCHEMA_VERSION) {
    await removeFileInsideRoot(root, JOURNAL_PATH, { removeEmptyParent: true }).catch(
      () => undefined,
    )
    return { migrated: false, resumed: false, seedCount: 0 }
  }

  const existingJournal = await readJournal(root)
  const journal = existingJournal ?? (await prepareJournal(sqlite, projectId, root))
  if (journal.seeds.length === 0) return { migrated: false, resumed: false, seedCount: 0 }
  await assertJournalMatchesDatabase(sqlite, journal)

  const currentStates = await Promise.all(
    journal.seeds.map(async (seed) => {
      const current = await readFileInsideRoot(root, seed.relativePath, {
        maxBytes: MAX_SECTION_BYTES,
      })
      const currentHash = sha256(current)
      return { seed, currentHash }
    }),
  )
  const external = currentStates.find(
    ({ seed, currentHash }) =>
      currentHash !== seed.originalHash && currentHash !== seed.migratedHash,
  )
  if (external) {
    await rollbackPartialMigration(root, currentStates)
    await removeFileInsideRoot(root, JOURNAL_PATH, { removeEmptyParent: true }).catch(
      () => undefined,
    )
    throw new Error(
      `Project vault section ${external.seed.sectionId} changed outside Flapstack during seed migration.`,
    )
  }

  for (const { seed, currentHash } of currentStates) {
    if (currentHash === seed.migratedHash) continue
    const original = await verifiedBackup(root, seed)
    const migrated = addSeedFrontmatter(original.toString("utf8"), seed.sectionId)
    await writeFileInsideRoot(
      root,
      seed.relativePath,
      { data: migrated },
      { overwrite: true, expectedSha256: seed.originalHash },
    )
    await hooks.afterSeedWrite?.(seed.sectionId)
  }

  sqlite
    .transaction(() => {
      assertJournalMatchesDatabaseSync(sqlite, journal)
      const insertBackup = sqlite.prepare(
        `INSERT INTO project_vault_backups
         (id, project_id, section_id, version, relative_path, content_hash, byte_length, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const updateSection = sqlite.prepare(
        `UPDATE project_vault_sections
         SET version = ?, content_hash = ?, byte_length = ?, updated_at = ?
         WHERE project_id = ? AND section_id = ? AND version = ? AND content_hash = ?`,
      )
      const now = Math.floor(Date.now() / 1_000)
      for (const seed of journal.seeds) {
        insertBackup.run(
          randomUUID(),
          projectId,
          seed.sectionId,
          seed.version,
          seed.backupRelativePath,
          seed.originalHash,
          seed.originalBytes,
          now,
        )
        const changed = updateSection.run(
          seed.version + 1,
          seed.migratedHash,
          seed.migratedBytes,
          now,
          projectId,
          seed.sectionId,
          seed.version,
          seed.originalHash,
        )
        if (changed.changes !== 1) {
          throw new Error("Project vault seed metadata changed during migration.")
        }
      }
      sqlite
        .prepare(
          `UPDATE project_vaults SET schema_version = ?, updated_at = ?
           WHERE project_id = ? AND schema_version < ?`,
        )
        .run(SEED_SCHEMA_VERSION, now, projectId, SEED_SCHEMA_VERSION)
    })
    .immediate()

  await removeFileInsideRoot(root, JOURNAL_PATH, { removeEmptyParent: true })
  return {
    migrated: true,
    resumed: existingJournal !== null,
    seedCount: journal.seeds.length,
  }
}

export function addSeedFrontmatter(source: string, sectionId: ProjectVaultSectionId): string {
  const id = `seed:${sectionId}`
  const reserved = [
    `flapstack-id: ${id}`,
    "flapstack-kind: seed",
    `flapstack-section: ${sectionId}`,
  ]
  if (!source.startsWith("---")) return `---\n${reserved.join("\n")}\n---\n${source}`

  const opening = /^---[ \t]*(\r?\n)/.exec(source)
  const closing = opening
    ? /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source.slice(opening[0].length))
    : null
  if (!opening || !closing) {
    throw new Error(`Seed note ${sectionId} has malformed frontmatter.`)
  }
  const yaml = source.slice(opening[0].length, opening[0].length + closing.index)
  const values = reservedValues(yaml)
  assertCompatible(values.get("id"), id, "identity", sectionId)
  assertCompatible(values.get("kind") ?? values.get("type"), "seed", "kind", sectionId)
  assertCompatible(values.get("section"), sectionId, "section", sectionId)
  if (
    values.get("id") === id &&
    (values.get("kind") ?? values.get("type")) === "seed" &&
    values.get("section") === sectionId
  ) {
    return source
  }
  return `${opening[0]}${reserved.join(opening[1])}${opening[1]}${source.slice(opening[0].length)}`
}

async function prepareJournal(
  sqlite: Database.Database,
  projectId: string,
  root: string,
): Promise<SeedMigrationJournal> {
  const rows = sqlite
    .prepare(
      `SELECT section_id sectionId, relative_path relativePath, version,
              content_hash contentHash, byte_length byteLength
       FROM project_vault_sections WHERE project_id = ? ORDER BY section_id`,
    )
    .all(projectId) as Array<{
    sectionId: ProjectVaultSectionId
    relativePath: string
    version: number
    contentHash: string
    byteLength: number
  }>
  const seeds: SeedRow[] = []
  for (const row of rows) {
    if (!projectVaultSectionIds.includes(row.sectionId)) {
      throw new Error(`Unsupported project vault seed section: ${row.sectionId}`)
    }
    const original = await readFileInsideRoot(root, row.relativePath, {
      maxBytes: MAX_SECTION_BYTES,
    })
    if (original.byteLength !== row.byteLength || sha256(original) !== row.contentHash) {
      throw new Error(
        `Project vault section ${row.sectionId} changed outside Flapstack before seed migration.`,
      )
    }
    const source = original.toString("utf8")
    assertProjectVaultContentSafe(source)
    const migrated = Buffer.from(addSeedFrontmatter(source, row.sectionId), "utf8")
    assertProjectVaultContentSafe(migrated.toString("utf8"))
    const backupRelativePath = `.backups/${row.sectionId}/seed-v${row.version}-${row.contentHash}.md`
    await ensureBackup(root, backupRelativePath, original, row.contentHash)
    seeds.push({
      sectionId: row.sectionId,
      relativePath: row.relativePath,
      version: row.version,
      originalHash: row.contentHash,
      originalBytes: row.byteLength,
      migratedHash: sha256(migrated),
      migratedBytes: migrated.byteLength,
      backupRelativePath,
    })
  }
  const journal: SeedMigrationJournal = { version: 1, projectId, seeds }
  await writeFileInsideRoot(
    root,
    JOURNAL_PATH,
    { data: JSON.stringify(journal) },
    { createParents: true, expectedSha256: null },
  )
  return journal
}

async function ensureBackup(
  root: string,
  relativePath: string,
  content: Buffer,
  expectedHash: string,
): Promise<void> {
  try {
    await writeFileInsideRoot(
      root,
      relativePath,
      { data: content },
      { createParents: true, expectedSha256: null },
    )
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    const existing = await readFileInsideRoot(root, relativePath, {
      maxBytes: MAX_SECTION_BYTES,
    })
    if (sha256(existing) !== expectedHash) {
      throw new Error("Project vault seed migration backup does not match its recorded identity.")
    }
  }
}

async function verifiedBackup(root: string, seed: SeedRow): Promise<Buffer> {
  const backup = await readFileInsideRoot(root, seed.backupRelativePath, {
    maxBytes: MAX_SECTION_BYTES,
  })
  if (backup.byteLength !== seed.originalBytes || sha256(backup) !== seed.originalHash) {
    throw new Error(`Project vault seed migration backup is corrupt for ${seed.sectionId}.`)
  }
  return backup
}

async function rollbackPartialMigration(
  root: string,
  states: Array<{ seed: SeedRow; currentHash: string }>,
): Promise<void> {
  for (const { seed, currentHash } of states) {
    if (currentHash !== seed.migratedHash) continue
    const original = await verifiedBackup(root, seed)
    await writeFileInsideRoot(
      root,
      seed.relativePath,
      { data: original },
      { overwrite: true, expectedSha256: seed.migratedHash },
    )
  }
}

async function readJournal(root: string): Promise<SeedMigrationJournal | null> {
  let bytes: Buffer
  try {
    bytes = await readFileInsideRoot(root, JOURNAL_PATH, { maxBytes: 1_048_576 })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
  const value = JSON.parse(bytes.toString("utf8")) as Partial<SeedMigrationJournal>
  if (
    value.version !== 1 ||
    typeof value.projectId !== "string" ||
    !Array.isArray(value.seeds) ||
    !value.seeds.every(isSeedRow)
  ) {
    throw new Error("Project vault seed migration journal is invalid.")
  }
  return value as SeedMigrationJournal
}

function isSeedRow(value: unknown): value is SeedRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    typeof row.sectionId === "string" &&
    projectVaultSectionIds.includes(row.sectionId as ProjectVaultSectionId) &&
    typeof row.relativePath === "string" &&
    typeof row.version === "number" &&
    typeof row.originalHash === "string" &&
    typeof row.originalBytes === "number" &&
    typeof row.migratedHash === "string" &&
    typeof row.migratedBytes === "number" &&
    typeof row.backupRelativePath === "string"
  )
}

async function assertJournalMatchesDatabase(
  sqlite: Database.Database,
  journal: SeedMigrationJournal,
): Promise<void> {
  assertJournalMatchesDatabaseSync(sqlite, journal)
}

function assertJournalMatchesDatabaseSync(
  sqlite: Database.Database,
  journal: SeedMigrationJournal,
): void {
  for (const seed of journal.seeds) {
    const row = sqlite
      .prepare(
        `SELECT relative_path relativePath, version, content_hash contentHash
         FROM project_vault_sections WHERE project_id = ? AND section_id = ?`,
      )
      .get(journal.projectId, seed.sectionId) as
      { relativePath: string; version: number; contentHash: string } | undefined
    if (
      !row ||
      row.relativePath !== seed.relativePath ||
      row.version !== seed.version ||
      row.contentHash !== seed.originalHash
    ) {
      throw new Error("Project vault seed metadata changed during migration.")
    }
  }
}

function reservedValues(yaml: string): Map<"id" | "kind" | "type" | "section", string> {
  const values = new Map<"id" | "kind" | "type" | "section", string>()
  for (const line of yaml.split(/\r?\n/)) {
    const match = /^flapstack[-_](id|kind|type|section)[ \t]*:[ \t]*(.*)$/i.exec(line)
    if (!match) continue
    const key = match[1]!.toLocaleLowerCase("en-US") as "id" | "kind" | "type" | "section"
    if (values.has(key)) throw new Error(`Duplicate reserved Flapstack ${key} frontmatter.`)
    values.set(key, unquote(match[2]!.trim()))
  }
  return values
}

function assertCompatible(
  actual: string | undefined,
  expected: string,
  label: string,
  sectionId: ProjectVaultSectionId,
): void {
  if (actual !== undefined && actual !== expected) {
    throw new Error(`Seed note ${sectionId} has a conflicting reserved ${label}.`)
  }
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function rawClient(database: Database.Database | object): Database.Database {
  return "prepare" in database
    ? (database as Database.Database)
    : (database as { $client: Database.Database }).$client
}
