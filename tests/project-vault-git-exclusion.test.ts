import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { projectVaultSections, projectVaults, projects } from "../src/main/lib/db/schema"
import { updateProjectVaultPolicy } from "../src/main/lib/project-vaults/policy"
import { scaffoldProjectVault } from "../src/main/lib/project-vaults/storage"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

const OWNED_BEGIN = "# BEGIN Flapstack project knowledge exclusion (owned):"

describe("project vault Git exclusion", () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  it("fails before files or metadata are written when Git exclusion cannot be proven", async () => {
    const fixture = createFixture()

    updateProjectVaultPolicy(fixture.database, {
      projectId: "project-1",
      appDataRoot: fixture.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: false,
    })

    await expect(
      scaffoldProjectVault(fixture.database, {
        projectId: "project-1",
        appDataRoot: fixture.appDataRoot,
        sections: ["index"],
      }),
    ).rejects.toThrow(/Git local exclusion/)
    expect(existsSync(join(fixture.projectRoot, ".flapstack"))).toBe(false)
    expect(fixture.database.select().from(projectVaults).all()).toEqual([])
    expect(fixture.database.select().from(projectVaultSections).all()).toEqual([])
  })

  it("tracking opt-in removes only the exact Flapstack-owned exclusion block", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const userRules = "# user-owned rules\n/.flapstack/knowledge/\n/vendor-cache/\n"
    mkdirSync(dirname(excludePath), { recursive: true })
    writeFileSync(excludePath, userRules)
    await createUntrackedVault(fixture.database, fixture.appDataRoot)
    expect(readFileSync(excludePath, "utf8")).toContain(OWNED_BEGIN)

    const policy = updateProjectVaultPolicy(fixture.database, {
      projectId: "project-1",
      appDataRoot: fixture.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })

    expect(policy.gitTrackingEnabled).toBe(true)
    expect(readFileSync(excludePath, "utf8")).toBe(userRules)
  })

  function createFixture(options: { initializeProjectRoot?: boolean } = {}): {
    directory: string
    appDataRoot: string
    projectRoot: string
    database: AppDatabase
  } {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-vault-git-"))
    const appDataRoot = join(directory, "app-data")
    const projectRoot = join(directory, "project")
    mkdirSync(appDataRoot)
    if (options.initializeProjectRoot !== false) mkdirSync(projectRoot)
    const sqlite = new Database(join(directory, "agents.db"))
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database.insert(projects).values({ id: "project-1", name: "Project", path: projectRoot }).run()
    cleanups.push(() => {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return { directory, appDataRoot, projectRoot, database }
  }
})

async function createUntrackedVault(
  database: AppDatabase,
  appDataRoot: string,
  projectId = "project-1",
) {
  updateProjectVaultPolicy(database, {
    projectId,
    appDataRoot,
    locationMode: "project-owned",
    projectOwnedOptIn: true,
    gitTrackingEnabled: false,
  })
  return scaffoldProjectVault(database, {
    projectId,
    appDataRoot,
    sections: ["index"],
  })
}

function initRepository(root: string): void {
  git(root, ["init", "-q"])
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function getCommonExcludePath(root: string): string {
  return resolve(
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "info",
    "exclude",
  )
}
