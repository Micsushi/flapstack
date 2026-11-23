import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { opendir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "./db/schema"
import { acquireAppDatabaseOperation, hasActiveDatabaseAccess } from "./db/access"

type AppDatabase = BetterSQLite3Database<typeof schema>
const fileKey = /^[0-9a-f]{64}$/
const partialKey = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.partial$/

function databaseFile(db: AppDatabase) {
  return db.get<{ file: string }>(sql`SELECT file FROM pragma_database_list WHERE name='main'`)
    ?.file
}

// Older portable exports contain checkpoint records without copying their raw files.
// Preserve every pre-upgrade raw key. For new exports preserve the keys present
// when the portable SQLite snapshot finished, even if the bundle is moved offline.
function pinFiles(file: string, firstCapture: boolean) {
  const profile = dirname(file)
  const pins = join(profile, "checkpoint-file-retention")
  const baseline = join(pins, "baseline.json")
  if (firstCapture && existsSync(baseline)) return
  mkdirSync(pins, { recursive: true })
  if (realpathSync.native(pins) !== pins)
    throw new Error("Unrecognized checkpoint retention directory")
  const store = join(profile, "checkpoint-files")
  if (existsSync(store) && realpathSync.native(store) !== store)
    throw new Error("Unrecognized checkpoint file directory")
  const keys = existsSync(store)
    ? readdirSync(store)
        .filter((name) => fileKey.test(name))
        .sort()
    : []
  const encoded = JSON.stringify(keys)
  const digest = createHash("sha256").update(encoded).digest("hex")
  const dest = firstCapture ? baseline : join(pins, digest + ".json")
  if (existsSync(dest)) return
  const temp = join(pins, randomUUID() + ".partial")
  try {
    writeFileSync(temp, JSON.stringify({ digest, keys }), { flag: "wx", flush: true, mode: 0o600 })
    renameSync(temp, dest)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}

export async function protectCheckpointExport<T>(
  file: string,
  history: boolean,
  backup: () => Promise<T>,
) {
  if (!history || basename(file) !== "agents.db") return backup()
  const release = acquireAppDatabaseOperation(join(dirname(file), "checkpoint-files"))
  try {
    const result = await backup()
    pinFiles(file, false)
    return result
  } finally {
    release()
  }
}

// Taking the shared lease and removing files both use the database's SQLite write
// lock. A second process cannot start capturing between our liveness check and unlink.
export function leaseCheckpointFiles(db: AppDatabase) {
  const file = databaseFile(db)
  if (!file) return () => {}
  return db.transaction(
    () => {
      if (basename(file) === "agents.db") pinFiles(file, true)
      return acquireAppDatabaseOperation(join(dirname(file), "checkpoint-files"))
    },
    { behavior: "immediate" },
  )
}

export async function withCheckpointFiles<T>(
  db: AppDatabase,
  operation: () => Promise<T>,
): Promise<T> {
  const release = leaseCheckpointFiles(db)
  try {
    return await operation()
  } finally {
    release()
  }
}

function otherDatabaseMayOwnFiles(file: string) {
  const dir = dirname(file)
  if (existsSync(join(dir, "portability", "operations"))) return true
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) return true
    if (
      item.name === basename(file) ||
      item.name === basename(file) + "-shm" ||
      item.name === basename(file) + "-wal" ||
      !item.isFile()
    )
      continue
    const fd = openSync(join(dir, item.name), "r")
    try {
      const header = Buffer.alloc(16)
      if (readSync(fd, header, 0, 16, 0) === 16 && header.toString() === "SQLite format 3\0")
        return true
    } finally {
      closeSync(fd)
    }
  }
  return false
}

function dbVersion(db: AppDatabase) {
  return db.get<{ v: string }>(
    sql`SELECT data_version || ':' || total_changes() AS v FROM pragma_data_version`,
  )!.v
}

export async function reclaimCheckpointFiles(db: AppDatabase) {
  try {
    const file = databaseFile(db)
    if (!file || basename(file) !== "agents.db") return 0
    const dir = join(dirname(file), "checkpoint-files")
    if (!existsSync(dir) || realpathSync.native(dir) !== dir || otherDatabaseMayOwnFiles(file))
      return 0
    const before = lstatSync(dir, { bigint: true })
    if (!before.isDirectory()) return 0
    db.transaction(() => pinFiles(file, true), { behavior: "immediate" })
    const version = dbVersion(db)
    // Retain identities anywhere in historical or imported checkpoint JSON. Malformed
    // data throws before deletion. The snapshot survey happens outside the write lock.
    const live = new Set(
      db
        .all<{ key: string }>(
          sql`SELECT DISTINCT j.atom AS key FROM checkpoints c,
      json_tree(c.git_status_json) j WHERE j.type='text' AND length(j.atom)=64`,
        )
        .map((row) => row.key),
    )
    const pins = join(dirname(file), "checkpoint-file-retention")
    if (realpathSync.native(pins) !== pins) return 0
    const pinEntries = readdirSync(pins, { withFileTypes: true })
    const pinCount = pinEntries.filter((entry) => !entry.name.endsWith(".partial")).length
    for (const entry of pinEntries) {
      if (entry.name.endsWith(".partial")) continue
      if (!entry.isFile() || !/^(baseline|[a-f0-9]{64})\.json$/.test(entry.name)) return 0
      const { keys, digest } = JSON.parse(readFileSync(join(pins, entry.name), "utf8"))
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !fileKey.test(key)))
        return 0
      if (
        createHash("sha256").update(JSON.stringify(keys)).digest("hex") !== digest ||
        (entry.name !== "baseline.json" && entry.name !== digest + ".json")
      )
        return 0
      for (const key of keys) live.add(key)
    }
    const candidates: string[] = []
    for await (const entry of await opendir(dir)) {
      if (
        entry.isFile() &&
        (fileKey.test(entry.name) || partialKey.test(entry.name)) &&
        !live.has(entry.name)
      )
        candidates.push(entry.name)
      if (candidates.length === 128) break
    }
    if (!candidates.length) return 0
    return db.transaction(
      () => {
        if (
          dbVersion(db) !== version ||
          hasActiveDatabaseAccess(dir) ||
          otherDatabaseMayOwnFiles(file) ||
          readdirSync(pins).filter((name) => !name.endsWith(".partial")).length !== pinCount
        )
          return 0
        // Also avoid older capture clients that predate the file lease.
        if (db.get(sql`SELECT 1 FROM agent_runs WHERE completed_at IS NULL LIMIT 1`)) return 0
        const current = lstatSync(dir, { bigint: true })
        if (
          current.dev !== before.dev ||
          current.ino !== before.ino ||
          !current.isDirectory() ||
          realpathSync.native(dir) !== dir
        )
          return 0
        let removed = 0
        for (const key of candidates) {
          const path = join(dir, key)
          const stat = lstatSync(path, { throwIfNoEntry: false })
          if (stat?.isFile()) {
            unlinkSync(path)
            removed++
          }
        }
        return removed
      },
      { behavior: "immediate" },
    )
  } catch (error) {
    console.warn("[checkpoints] Deferred unused file cleanup:", error)
    return 0
  }
}
