import Database from "better-sqlite3"
import { readFile, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import { readPortableDatabase } from "../src/main/lib/portability/database"
import {
  copyRegularFileNoFollow,
  readJsonFile,
  snapshotRegularFileNoFollow,
} from "../src/main/lib/portability/io"
import { PORTABILITY_LIMITS } from "../src/shared/portability"
import { tempRoot } from "./portability-test-helpers"

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
