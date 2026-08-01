import { eq } from "drizzle-orm"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { getDatabase } from "../db"
import { projects, projectVaultPolicies, projectVaults } from "../db/schema"
import { ensureProjectVaultGitExclusion, removeProjectVaultGitExclusion } from "./git-exclusion"

export const vaultLocationModes = ["app-managed", "project-owned"] as const
export type VaultLocationMode = (typeof vaultLocationModes)[number]

export const VAULT_WORKTREE_MODE = "shared-across-worktrees" as const
export const VAULT_DELETION_MODE = "retain-until-explicit-delete" as const

type Database = ReturnType<typeof getDatabase>

export type ProjectVaultPolicy = {
  projectId: string
  locationMode: VaultLocationMode
  vaultPath: string
  centralPath: string
  projectOwnedPath: string | null
  gitTrackingEnabled: boolean
  portabilityMode: "export-required" | "project-owned"
  worktreeMode: typeof VAULT_WORKTREE_MODE
  deletionMode: typeof VAULT_DELETION_MODE
  createdAt: Date | null
  updatedAt: Date | null
}

type PersistedPolicy = typeof projectVaultPolicies.$inferSelect

function assertAbsoluteRoot(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`)
  }
  return resolve(path)
}

function safeProjectDirectoryName(projectId: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(projectId)) return projectId
  return Buffer.from(projectId, "utf8").toString("base64url")
}

export function getDefaultCentralVaultPath(appDataRoot: string, projectId: string): string {
  const root = assertAbsoluteRoot(appDataRoot, "App data root")
  return join(root, "knowledge-vaults", safeProjectDirectoryName(projectId))
}

export function getDefaultProjectOwnedVaultPath(projectRoot: string): string {
  return join(assertAbsoluteRoot(projectRoot, "Project root"), ".flapstack", "knowledge")
}

function toPolicy(row: PersistedPolicy): ProjectVaultPolicy {
  const locationMode = row.locationMode as VaultLocationMode
  const projectOwnedPath = row.projectOwnedPath ?? null
  if (locationMode !== "app-managed" && locationMode !== "project-owned") {
    throw new Error(`Unsupported vault location mode: ${row.locationMode}`)
  }
  if (locationMode === "project-owned" && !projectOwnedPath) {
    throw new Error("Project-owned vault policy is missing its stable path.")
  }

  return {
    projectId: row.projectId,
    locationMode,
    vaultPath: locationMode === "app-managed" ? row.centralPath : projectOwnedPath!,
    centralPath: row.centralPath,
    projectOwnedPath,
    gitTrackingEnabled: row.gitTrackingEnabled,
    portabilityMode: row.portabilityMode as ProjectVaultPolicy["portabilityMode"],
    worktreeMode: row.worktreeMode as ProjectVaultPolicy["worktreeMode"],
    deletionMode: row.deletionMode as ProjectVaultPolicy["deletionMode"],
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  }
}

/**
 * Lazily migrates an existing project to the deterministic central default.
 * This records policy only; vault directories and content belong to S4-F2-T2.
 */
export function getOrCreateProjectVaultPolicy(
  database: Database,
  input: { projectId: string; appDataRoot: string },
): ProjectVaultPolicy {
  const project = database.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error("Project not found.")

  const existing = database
    .select()
    .from(projectVaultPolicies)
    .where(eq(projectVaultPolicies.projectId, input.projectId))
    .get()
  if (existing) return toPolicy(existing)

  const centralPath = getDefaultCentralVaultPath(input.appDataRoot, project.id)
  database
    .insert(projectVaultPolicies)
    .values({
      projectId: project.id,
      locationMode: "app-managed",
      centralPath,
      projectOwnedPath: null,
      gitTrackingEnabled: false,
      portabilityMode: "export-required",
      worktreeMode: VAULT_WORKTREE_MODE,
      deletionMode: VAULT_DELETION_MODE,
    })
    .onConflictDoNothing()
    .run()

  const created = database
    .select()
    .from(projectVaultPolicies)
    .where(eq(projectVaultPolicies.projectId, input.projectId))
    .get()
  if (!created) throw new Error("Failed to persist project vault policy.")
  return toPolicy(created)
}

export function getProjectVaultPolicy(database: Database, projectId: string): ProjectVaultPolicy {
  const row = database
    .select()
    .from(projectVaultPolicies)
    .where(eq(projectVaultPolicies.projectId, projectId))
    .get()
  if (!row) throw new Error("Project vault policy is missing.")
  return toPolicy(row)
}

export function updateProjectVaultPolicy(
  database: Database,
  input: {
    projectId: string
    appDataRoot: string
    locationMode: VaultLocationMode
    projectOwnedOptIn?: true
    gitTrackingEnabled: boolean
    gitTrackingOptIn?: true
  },
): ProjectVaultPolicy {
  const current = getOrCreateProjectVaultPolicy(database, input)
  const project = database.select().from(projects).where(eq(projects.id, input.projectId)).get()!
  const scaffolded = database
    .select({ rootPath: projectVaults.rootPath })
    .from(projectVaults)
    .where(eq(projectVaults.projectId, input.projectId))
    .get()

  if (scaffolded && input.locationMode !== current.locationMode) {
    throw new Error("Delete the existing project vault before changing its location mode.")
  }

  if (input.locationMode === "project-owned" && input.projectOwnedOptIn !== true) {
    throw new Error("Project-owned vault storage requires explicit opt-in.")
  }
  if (input.gitTrackingEnabled && input.locationMode !== "project-owned") {
    throw new Error("Git tracking is available only for project-owned vault storage.")
  }
  if (input.gitTrackingEnabled && input.gitTrackingOptIn !== true) {
    throw new Error("Git tracking requires explicit opt-in.")
  }

  const projectOwnedPath =
    input.locationMode === "project-owned"
      ? (current.projectOwnedPath ?? getDefaultProjectOwnedVaultPath(project.path))
      : current.projectOwnedPath
  const changesTracking =
    scaffolded &&
    input.locationMode === "project-owned" &&
    current.gitTrackingEnabled !== input.gitTrackingEnabled
  const projectRoot = changesTracking ? dirname(dirname(projectOwnedPath!)) : null
  const disablingTracking = changesTracking && !input.gitTrackingEnabled
  if (disablingTracking) ensureProjectVaultGitExclusion(projectRoot!)

  let updated: PersistedPolicy | undefined
  try {
    updated = database
      .update(projectVaultPolicies)
      .set({
        locationMode: input.locationMode,
        projectOwnedPath,
        gitTrackingEnabled:
          input.locationMode === "project-owned" ? input.gitTrackingEnabled : false,
        portabilityMode:
          input.locationMode === "project-owned" ? "project-owned" : "export-required",
        updatedAt: new Date(),
      })
      .where(eq(projectVaultPolicies.projectId, input.projectId))
      .returning()
      .get()
  } catch (error) {
    if (disablingTracking) removeProjectVaultGitExclusion(projectRoot!)
    throw error
  }
  if (!updated) {
    if (disablingTracking) removeProjectVaultGitExclusion(projectRoot!)
    throw new Error("Failed to update project vault policy.")
  }

  if (changesTracking && input.gitTrackingEnabled) {
    try {
      removeProjectVaultGitExclusion(projectRoot!)
    } catch (error) {
      database
        .update(projectVaultPolicies)
        .set({ gitTrackingEnabled: false, updatedAt: current.updatedAt })
        .where(eq(projectVaultPolicies.projectId, input.projectId))
        .run()
      try {
        ensureProjectVaultGitExclusion(projectRoot!)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Git tracking opt-in failed and the local exclusion rollback also failed.",
        )
      }
      throw error
    }
  }
  return toPolicy(updated)
}
