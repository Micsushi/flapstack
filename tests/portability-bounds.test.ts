import Database from "better-sqlite3"
import { renameSync, symlinkSync } from "node:fs"
import { appendFile, mkdir, readFile, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import { readPortableDatabase } from "../src/main/lib/portability/database"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  copyRegularFileNoFollow,
  listFiles,
  readJsonFile,
  sha256File,
  snapshotRegularFileNoFollow,
} from "../src/main/lib/portability/io"
import { PORTABILITY_LIMITS } from "../src/shared/portability"
import { createTestDatabase, tempRoot } from "./portability-test-helpers"

describe("portability resource bounds", () => {
  it.skipIf(!fileSymlinksSupported)(
    "rejects leaf symlinks when the platform no-follow flag is disabled",
    async () => {
      const root = await tempRoot()
      const outside = join(root, "outside.json")
      const linked = join(root, "linked.json")
      const copied = join(root, "copied.json")
      await writeFile(outside, '{"outside":"must-not-be-read"}')
      await symlink(outside, linked)

      await expect(
        snapshotRegularFileNoFollow(linked, {
          maxBytes: 1_024,
          useNoFollowFlag: false,
        }),
      ).rejects.toThrow(/non-symlink/i)
      await expect(
        copyRegularFileNoFollow(linked, copied, undefined, { useNoFollowFlag: false }),
      ).rejects.toThrow(/non-symlink/i)
      await expect(readJsonFile(linked, 1_024, { useNoFollowFlag: false })).rejects.toThrow(
        /non-symlink/i,
      )
      await expect(readFile(copied)).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it("rejects JSON that exceeds or grows beyond its single-handle bound", async () => {
    const root = await tempRoot()
    const oversized = join(root, "oversized.json")
    await writeFile(oversized, '{"value":"too-large"}')
    await expect(readJsonFile(oversized, 8)).rejects.toThrow(/limit/i)

    const growing = join(root, "growing.json")
    await writeFile(growing, '{"ok":true}')
    await expect(
      readJsonFile(growing, 1_024, {
        afterOpen: () => appendFile(growing, " "),
      }),
    ).rejects.toThrow(/changed while reading/i)
  })

  it("stops directory traversal at the explicit entry cap", async () => {
    const root = await tempRoot()
    for (let index = 0; index < 4; index += 1) {
      await writeFile(join(root, `${index}.txt`), String(index))
    }
    await expect(listFiles(root, 3)).rejects.toThrow(/3-entry traversal limit/i)
  })

  it("rejects an oversized file before streaming its contents", async () => {
    const path = join(await tempRoot(), "oversized.txt")
    await writeFile(path, "")
    await truncate(path, PORTABILITY_LIMITS.fileBytes + 1)
    await expect(sha256File(path, PORTABILITY_LIMITS.fileBytes)).rejects.toThrow(/limit/i)
  })

  it("rejects an oversized export source before allocating its text", async () => {
    const root = await tempRoot()
    const sourceRoot = join(root, "settings")
    await mkdir(sourceRoot)
    const source = join(sourceRoot, "oversized.txt")
    await writeFile(source, "")
    await truncate(source, PORTABILITY_LIMITS.fileBytes + 1)
    const databasePath = join(root, "agents.db")
    createTestDatabase(databasePath)
    await expect(
      createPortableExport({
        outputPath: join(root, "oversized.flapstack-export"),
        databasePath,
        appVersion: "test",
        selection: [{ id: "settings" }],
        fileSources: [{ scopeId: "settings", root: sourceRoot, target: { kind: "config" } }],
      }),
    ).rejects.toThrow(/limit/i)
  })

  it("rejects an oversized portable database before opening it", async () => {
    const path = join(await tempRoot(), "oversized.sqlite3")
    createPortableDatabaseFixture(path).close()
    await truncate(path, PORTABILITY_LIMITS.databaseBytes + 1)
    expect(() => readPortableDatabase(path)).toThrow(/size limit/i)
  })

  it.skipIf(!fileSymlinksSupported)(
    "rejects portable database symlinks with no platform no-follow flag",
    async () => {
      const root = await tempRoot()
      const outside = join(root, "outside.sqlite3")
      createPortableDatabaseFixture(outside).close()
      const linked = join(root, "linked.sqlite3")
      await symlink(outside, linked)
      expect(() => readPortableDatabase(linked, { useNoFollowFlag: false })).toThrow(/non-symlink/i)
    },
  )

  it.skipIf(!fileSymlinksSupported)(
    "rejects a portable database leaf swap before outside rows can return",
    async () => {
      const root = await tempRoot()
      const source = join(root, "source.sqlite3")
      createPortableDatabaseFixture(source).close()
      const outside = join(root, "outside.sqlite3")
      const outsideDatabase = createPortableDatabaseFixture(outside)
      outsideDatabase
        .prepare(
          "INSERT INTO portable_records (scope_id, table_name, identity_json, row_json) VALUES (?, ?, ?, ?)",
        )
        .run("settings", "settings", '{"id":"outside"}', '{"value":"outside"}')
      outsideDatabase.close()
      const moved = join(root, "source-moved.sqlite3")
      expect(() =>
        readPortableDatabase(source, {
          useNoFollowFlag: false,
          afterOpen: () => {
            renameSync(source, moved)
            symlinkSync(outside, source)
          },
        }),
      ).toThrow(/non-symlink|changed while copying/i)
    },
  )

  it("ignores portable database WAL and SHM sidecars", async () => {
    const path = join(await tempRoot(), "sidecars.sqlite3")
    createPortableDatabaseFixture(path).close()
    const writer = new Database(path)
    writer.pragma("journal_mode = WAL")
    writer.pragma("wal_autocheckpoint = 0")
    writer
      .prepare(
        "INSERT INTO portable_records (scope_id, table_name, identity_json, row_json) VALUES (?, ?, ?, ?)",
      )
      .run("settings", "settings", '{"id":"wal-only"}', '{"value":"wal-only"}')
    expect(readPortableDatabase(path)).toEqual([])
    writer.close()
  })

  it("rejects an oversized record before parsing its JSON", async () => {
    const path = join(await tempRoot(), "oversized-record.sqlite3")
    const database = createPortableDatabaseFixture(path)
    database
      .prepare(
        "INSERT INTO portable_records (scope_id, table_name, identity_json, row_json) VALUES (?, ?, ?, ?)",
      )
      .run(
        "settings",
        "settings",
        '{"id":"one"}',
        JSON.stringify({ value: "x".repeat(PORTABILITY_LIMITS.recordJsonBytes + 1) }),
      )
    database.close()
    expect(() => readPortableDatabase(path)).toThrow(/record.*size limit/i)
  })
})

function createPortableDatabaseFixture(path: string): Database.Database {
  const database = new Database(path)
  database.exec(`
    CREATE TABLE portable_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE portable_records (
      scope_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      row_json TEXT NOT NULL,
      PRIMARY KEY (scope_id, table_name, identity_json)
    );
    INSERT INTO portable_metadata (key, value) VALUES ('schema_version', '1');
  `)
  return database
}
