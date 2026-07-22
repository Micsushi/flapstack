import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { projectVaultPolicies, projects } from "../src/main/lib/db/schema"
import {
  getOrCreateProjectVaultPolicy,
  updateProjectVaultPolicy,
} from "../src/main/lib/project-vaults/policy"

describe("project vault location policy", () => {
  let sqlite: Database.Database
  let database: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database
      .insert(projects)
      .values({ id: "project-1", name: "Project", path: "/missing/project-root" })
      .run()
  })

  afterEach(() => sqlite.close())

  it("lazily migrates existing projects to stable central storage", () => {
    const initial = getOrCreateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot: "/app/profile-one",
    })
    const restarted = getOrCreateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot: "/app/profile-two",
    })

    expect(initial).toMatchObject({
      locationMode: "app-managed",
      vaultPath: resolve("/app/profile-one", "knowledge-vaults", "project-1"),
      gitTrackingEnabled: false,
      portabilityMode: "export-required",
      worktreeMode: "shared-across-worktrees",
      deletionMode: "retain-until-explicit-delete",
    })
    expect(restarted).toEqual(initial)
    expect(database.select().from(projectVaultPolicies).all()).toHaveLength(1)
  })

  it("requires separate explicit opt-ins for project ownership and git tracking", () => {
    expect(() =>
      updateProjectVaultPolicy(database, {
        projectId: "project-1",
        appDataRoot: "/app/profile",
        locationMode: "project-owned",
        gitTrackingEnabled: false,
      }),
    ).toThrow("requires explicit opt-in")

    expect(() =>
      updateProjectVaultPolicy(database, {
        projectId: "project-1",
        appDataRoot: "/app/profile",
        locationMode: "project-owned",
        projectOwnedOptIn: true,
        gitTrackingEnabled: true,
      }),
    ).toThrow("Git tracking requires explicit opt-in")

    expect(
      updateProjectVaultPolicy(database, {
        projectId: "project-1",
        appDataRoot: "/app/profile",
        locationMode: "project-owned",
        projectOwnedOptIn: true,
        gitTrackingEnabled: true,
        gitTrackingOptIn: true,
      }),
    ).toMatchObject({
      locationMode: "project-owned",
      vaultPath: resolve("/missing/project-root", ".flapstack", "knowledge"),
      gitTrackingEnabled: true,
      portabilityMode: "project-owned",
    })
  })

  it("keeps selected paths stable across project and worktree changes", () => {
    const owned = updateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot: "/app/profile",
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: false,
    })
    database.update(projects).set({ path: "/different/worktree" }).run()

    const afterMove = getOrCreateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot: "/different/profile",
    })
    expect(afterMove.vaultPath).toBe(owned.vaultPath)

    const central = updateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot: "/different/profile",
      locationMode: "app-managed",
      gitTrackingEnabled: false,
    })
    expect(central.vaultPath).toBe(resolve("/app/profile", "knowledge-vaults", "project-1"))
    expect(central.gitTrackingEnabled).toBe(false)
  })

  it("rejects missing projects and relative roots without writing policy", () => {
    expect(() =>
      getOrCreateProjectVaultPolicy(database, {
        projectId: "missing",
        appDataRoot: "/app/profile",
      }),
    ).toThrow("Project not found")
    expect(() =>
      getOrCreateProjectVaultPolicy(database, {
        projectId: "project-1",
        appDataRoot: "relative/profile",
      }),
    ).toThrow("must be an absolute path")
    expect(database.select().from(projectVaultPolicies).all()).toHaveLength(0)
  })
})
