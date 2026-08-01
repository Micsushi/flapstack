import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  buildObsidianOpenUri,
  openProjectVaultInObsidian,
} from "../src/main/lib/project-vaults/obsidian-open"

describe("safe Obsidian vault opening", () => {
  let directory: string
  let vaultRoot: string
  let sqlite: Database.Database

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-obsidian-open-"))
    vaultRoot = join(directory, "vault & calc.exe (safe) # %")
    mkdirSync(vaultRoot)
    sqlite = new Database(join(directory, "agents.db"))
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite.pragma("foreign_keys = ON")
    sqlite
      .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
      .run("project-1", "Project", directory)
    sqlite
      .prepare(
        `INSERT INTO project_vaults
         (project_id, root_path, schema_version, created_at, updated_at)
         VALUES (?, ?, 2, 1, 1)`,
      )
      .run("project-1", vaultRoot)
    bindFilesystemRootIdentity(vaultRoot, drizzle(sqlite, { schema }))
  })

  afterEach(() => {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("encodes the validated absolute path into one official Obsidian URI", async () => {
    const openUri = vi.fn(async () => undefined)

    await expect(openProjectVaultInObsidian(sqlite, "project-1", openUri)).resolves.toMatchObject({
      status: "opened",
      path: vaultRoot,
    })
    expect(openUri).toHaveBeenCalledOnce()
    const uri = openUri.mock.calls[0]![0]
    expect(uri.startsWith("obsidian://open?")).toBe(true)
    expect(new URL(uri).searchParams.get("path")).toBe(vaultRoot)
    expect(uri).not.toContain(" & ")
  })

  it("reports an unavailable handler truthfully and exposes safe fallback state", async () => {
    const unavailable = await openProjectVaultInObsidian(sqlite, "project-1", async () => {
      throw new Error("No application is registered for obsidian")
    })

    expect(unavailable).toEqual({
      status: "unavailable",
      path: vaultRoot,
      canReveal: true,
      canCopyPath: true,
    })
  })

  it("rejects relative, non-canonical, and control-character paths", () => {
    expect(() => buildObsidianOpenUri("relative/vault")).toThrow(/absolute/)
    expect(() => buildObsidianOpenUri(`${vaultRoot}\nother`)).toThrow(/control/)
    expect(() =>
      buildObsidianOpenUri(
        `${vaultRoot}${process.platform === "win32" ? "\\" : "/"}..${
          process.platform === "win32" ? "\\" : "/"
        }vault & calc.exe (safe) # %`,
      ),
    ).toThrow(/canonical/)
  })
})
