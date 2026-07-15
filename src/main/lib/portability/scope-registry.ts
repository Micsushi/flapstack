import { z } from "zod"
import {
  PORTABILITY_LIMITS,
  PORTABLE_BUNDLE_LAYOUT,
  PORTABLE_BUNDLE_VERSION,
  PORTABLE_CHECKSUM_VERSION,
  PORTABLE_EXCLUSION_VERSION,
  PORTABLE_SCOPE_IDS,
  portableCollisionKey,
  portableChecksumDocumentSchema,
  portableExclusionDocumentSchema,
  portableManifestSchema,
  portableProjectIdSchema,
  type PortableChecksumDocument,
  type PortableExclusionDocument,
  type PortableManifest,
  type PortableManifestScope,
  type PortableProjectFilterMode,
  type PortableScopeId,
  type PortableSensitivityClass,
  type PortableStorageKind,
} from "../../../shared/portability"

export const PORTABLE_SCOPE_HANDLER_CONTRACT_VERSION = 1 as const

export type PortableScopeVersionContract = {
  current: number
  minimumImport: number
}

export type PortableScopeHandlerContract = {
  contractVersion: typeof PORTABLE_SCOPE_HANDLER_CONTRACT_VERSION
  id: string
  sourceContract: { id: string; schemaVersion: number }
  storage: PortableStorageKind
  exportMode: "snapshot" | "copy" | "derived"
  importMode: "staged-preview"
  deletePolicy: "never-implicit"
  privateSync: "not-eligible" | "eligible-after-secret-scan"
}

export type PortableScopeContract = {
  id: PortableScopeId
  label: string
  schema: PortableScopeVersionContract
  dependencies: readonly PortableScopeId[]
  sensitivity: PortableSensitivityClass
  projectFilter: PortableProjectFilterMode
  contentPath: `scopes/${PortableScopeId}`
  handler: PortableScopeHandlerContract
}

export type PortableScopeSelection = {
  id: PortableScopeId
  projectIds?: readonly string[]
}

export type PortableScopeCompatibility =
  | { status: "current"; fromVersion: number; toVersion: number }
  | { status: "migration-required"; fromVersion: number; toVersion: number }

export type PortabilityContractErrorCode =
  | "INVALID_REGISTRY"
  | "UNKNOWN_SCOPE"
  | "DUPLICATE_SCOPE"
  | "CYCLIC_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "INVALID_VERSION"
  | "FUTURE_VERSION"
  | "INVALID_MANIFEST"
  | "UNSAFE_BUNDLE_NAME"
  | "UNSAFE_PATH"
  | "MALFORMED_CHECKSUMS"
  | "MALFORMED_EXCLUSIONS"
  | "INVALID_PROJECT_FILTER"

export class PortabilityContractError extends Error {
  constructor(
    public readonly code: PortabilityContractErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = "PortabilityContractError"
  }
}

const contract = (value: Omit<PortableScopeContract, "contentPath">): PortableScopeContract => ({
  ...value,
  contentPath: `scopes/${value.id}`,
})

/**
 * Pure descriptors only. T2+ attach scanning, export, staging, and apply I/O.
 * Source versions mirror the code-ready F1-T3/F2-T2/F4-T2 contracts without
 * copying their persistence or lifecycle behavior into this task lane.
 */
export const PORTABLE_SCOPE_CONTRACTS = [
  contract({
    id: "settings",
    label: "Settings",
    schema: { current: 1, minimumImport: 1 },
    dependencies: [],
    sensitivity: "secret-bearing",
    projectFilter: "none",
    handler: {
      contractVersion: 1,
      id: "settings-v1",
      sourceContract: { id: "flapstack-settings", schemaVersion: 1 },
      storage: "hybrid",
      exportMode: "snapshot",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "eligible-after-secret-scan",
    },
  }),
  contract({
    id: "projects",
    label: "Projects",
    schema: { current: 1, minimumImport: 1 },
    dependencies: [],
    sensitivity: "private",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "projects-v1",
      sourceContract: { id: "project-metadata", schemaVersion: 1 },
      storage: "database",
      exportMode: "snapshot",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "not-eligible",
    },
  }),
  contract({
    id: "extensions",
    label: "Extensions",
    schema: { current: 1, minimumImport: 1 },
    dependencies: ["projects"],
    sensitivity: "secret-bearing",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "extensions-v1",
      sourceContract: { id: "extension-enablement-policy", schemaVersion: 1 },
      storage: "hybrid",
      exportMode: "copy",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "eligible-after-secret-scan",
    },
  }),
  contract({
    id: "project-vaults",
    label: "Project vaults",
    schema: { current: 1, minimumImport: 1 },
    dependencies: ["projects"],
    sensitivity: "secret-bearing",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "project-vaults-v1",
      sourceContract: { id: "project-vault", schemaVersion: 1 },
      storage: "hybrid",
      exportMode: "copy",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "eligible-after-secret-scan",
    },
  }),
  contract({
    id: "saved-workspaces",
    label: "Saved workspaces",
    schema: { current: 1, minimumImport: 1 },
    dependencies: ["projects"],
    sensitivity: "private",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "saved-workspaces-v1",
      sourceContract: { id: "saved-workspace-layout", schemaVersion: 1 },
      storage: "database",
      exportMode: "snapshot",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "not-eligible",
    },
  }),
  contract({
    id: "usage",
    label: "Usage",
    schema: { current: 1, minimumImport: 1 },
    dependencies: ["projects"],
    sensitivity: "private",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "usage-v1",
      sourceContract: { id: "usage-facts-and-rollups", schemaVersion: 1 },
      storage: "database",
      exportMode: "derived",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "not-eligible",
    },
  }),
  contract({
    id: "history",
    label: "History",
    schema: { current: 1, minimumImport: 1 },
    dependencies: ["projects"],
    sensitivity: "secret-bearing",
    projectFilter: "optional",
    handler: {
      contractVersion: 1,
      id: "history-v1",
      sourceContract: { id: "chat-run-history", schemaVersion: 1 },
      storage: "hybrid",
      exportMode: "snapshot",
      importMode: "staged-preview",
      deletePolicy: "never-implicit",
      privateSync: "not-eligible",
    },
  }),
] as const satisfies readonly PortableScopeContract[]

export class PortableScopeRegistry {
  private readonly contracts: readonly PortableScopeContract[]
  private readonly byId: ReadonlyMap<PortableScopeId, PortableScopeContract>
  private readonly order: ReadonlyMap<PortableScopeId, number>

  constructor(contracts: readonly PortableScopeContract[]) {
    if (contracts.length === 0 || contracts.length > PORTABLE_SCOPE_IDS.length) {
      fail("INVALID_REGISTRY", "Portable scope registry size is invalid.")
    }
    const byId = new Map<PortableScopeId, PortableScopeContract>()
    const handlerIds = new Set<string>()
    contracts.forEach((entry) => {
      if (byId.has(entry.id)) {
        fail("DUPLICATE_SCOPE", `Portable scope ${entry.id} is registered more than once.`, {
          scopeId: entry.id,
        })
      }
      if (handlerIds.has(entry.handler.id)) {
        fail("INVALID_REGISTRY", `Portable handler ${entry.handler.id} is registered twice.`)
      }
      validateContract(entry)
      byId.set(entry.id, entry)
      handlerIds.add(entry.handler.id)
    })
    for (const entry of contracts) {
      for (const dependency of entry.dependencies) {
        if (!byId.has(dependency)) {
          fail(
            "MISSING_DEPENDENCY",
            `Portable scope ${entry.id} depends on unregistered scope ${dependency}.`,
            { scopeId: entry.id, dependency },
          )
        }
      }
    }
    this.contracts = [...contracts]
    this.byId = byId
    this.order = new Map(contracts.map((entry, index) => [entry.id, index]))
    this.topologicalOrder(this.contracts.map((entry) => entry.id))
  }

  list(): readonly PortableScopeContract[] {
    return this.contracts
  }

  get(scopeId: string): PortableScopeContract {
    const entry = this.byId.get(scopeId as PortableScopeId)
    if (!entry) fail("UNKNOWN_SCOPE", `Portable scope ${scopeId} is not registered.`, { scopeId })
    return entry
  }

  compatibility(scopeId: string, version: number): PortableScopeCompatibility {
    const entry = this.get(scopeId)
    if (!Number.isSafeInteger(version) || version <= 0) {
      fail("INVALID_VERSION", `Portable scope ${scopeId} has invalid version ${version}.`, {
        scopeId,
        version,
      })
    }
    if (version > entry.schema.current) {
      fail(
        "FUTURE_VERSION",
        `Portable scope ${scopeId} version ${version} is newer than supported.`,
        {
          scopeId,
          version,
          supported: entry.schema.current,
        },
      )
    }
    if (version < entry.schema.minimumImport) {
      fail(
        "INVALID_VERSION",
        `Portable scope ${scopeId} version ${version} is no longer supported.`,
        {
          scopeId,
          version,
          minimum: entry.schema.minimumImport,
        },
      )
    }
    return {
      status: version === entry.schema.current ? "current" : "migration-required",
      fromVersion: version,
      toVersion: entry.schema.current,
    }
  }

  resolveSelection(selection: readonly PortableScopeSelection[]): PortableManifestScope[] {
    if (selection.length === 0 || selection.length > PORTABILITY_LIMITS.scopeCount) {
      fail("INVALID_MANIFEST", "Select at least one bounded portable scope.")
    }
    const selected = new Map<PortableScopeId, string[] | null>()
    for (const request of selection) {
      const entry = this.get(request.id)
      if (selected.has(entry.id)) {
        fail("DUPLICATE_SCOPE", `Portable scope ${entry.id} was selected more than once.`, {
          scopeId: entry.id,
        })
      }
      selected.set(entry.id, validateProjectIds(entry, request.projectIds) ?? null)
    }

    const pending = [...selected.keys()]
    const queued = new Set(pending)
    const convergenceLimit = PORTABLE_SCOPE_IDS.length * (PORTABILITY_LIMITS.projectFilterCount + 2)
    let iterations = 0
    while (pending.length > 0) {
      iterations += 1
      if (iterations > convergenceLimit) {
        fail("INVALID_REGISTRY", "Portable dependency filter closure did not converge.")
      }
      const childId = pending.pop()!
      queued.delete(childId)
      const child = this.get(childId)
      for (const dependencyId of child.dependencies) {
        const dependency = this.get(dependencyId)
        const childFilter = selected.get(childId)
        const dependencySelected = selected.has(dependencyId)
        const dependencyFilter = selected.get(dependencyId)
        const nextFilter = mergeDependencyFilter(
          dependency,
          dependencySelected,
          dependencyFilter,
          childFilter,
        )
        if (!sameEffectiveFilter(dependencySelected, dependencyFilter, nextFilter)) {
          selected.set(dependencyId, nextFilter)
          if (!queued.has(dependencyId)) {
            pending.push(dependencyId)
            queued.add(dependencyId)
          }
        }
      }
    }

    return this.topologicalOrder([...selected.keys()]).map((id) => {
      const entry = this.get(id)
      const projectIds = selected.get(id)
      return {
        id,
        schemaVersion: entry.schema.current,
        contentPath: entry.contentPath,
        ...(projectIds !== null ? { projectIds } : {}),
      }
    })
  }

  validateManifest(input: unknown): PortableManifest {
    assertManifestAggregateBounds(input)
    const parsed = parseManifestShape(input)
    if (parsed.bundleVersion > PORTABLE_BUNDLE_VERSION) {
      fail("FUTURE_VERSION", `Bundle version ${parsed.bundleVersion} is newer than supported.`, {
        version: parsed.bundleVersion,
        supported: PORTABLE_BUNDLE_VERSION,
      })
    }
    if (parsed.bundleVersion !== PORTABLE_BUNDLE_VERSION) {
      fail("INVALID_VERSION", `Bundle version ${parsed.bundleVersion} is unsupported.`)
    }
    if (!sameLayout(parsed.layout, PORTABLE_BUNDLE_LAYOUT)) {
      fail("UNSAFE_PATH", "Bundle manifest does not use the fixed portable directory layout.")
    }
    const scopes = new Map<PortableScopeId, PortableManifestScope>()
    for (const manifestScope of parsed.scopes) {
      const entry = this.get(manifestScope.id)
      if (scopes.has(entry.id)) {
        fail("DUPLICATE_SCOPE", `Manifest scope ${entry.id} is duplicated.`, {
          scopeId: entry.id,
        })
      }
      if (manifestScope.contentPath !== entry.contentPath) {
        fail("UNSAFE_PATH", `Manifest scope ${entry.id} has a non-canonical content path.`, {
          scopeId: entry.id,
          path: manifestScope.contentPath,
        })
      }
      this.compatibility(entry.id, manifestScope.schemaVersion)
      const projectIds = validateProjectIds(entry, manifestScope.projectIds)
      scopes.set(entry.id, { ...manifestScope, ...(projectIds ? { projectIds } : {}) })
    }
    for (const [scopeId, manifestScope] of scopes) {
      const entry = this.get(scopeId)
      for (const dependency of entry.dependencies) {
        const dependencyScope = scopes.get(dependency)
        if (!dependencyScope) {
          fail(
            "MISSING_DEPENDENCY",
            `Manifest scope ${scopeId} requires missing scope ${dependency}.`,
            { scopeId, dependency },
          )
        }
        assertDependencyProjectFilter(scopeId, manifestScope, dependencyScope)
      }
    }
    this.topologicalOrder([...scopes.keys()])
    return { ...parsed, scopes: [...scopes.values()] }
  }

  importOrder(input: unknown): PortableScopeId[] {
    const manifest = this.validateManifest(input)
    return this.topologicalOrder(manifest.scopes.map((entry) => entry.id as PortableScopeId))
  }

  validateChecksums(input: unknown): PortableChecksumDocument {
    assertDocumentEntryBound(input, PORTABILITY_LIMITS.checksumEntries, "MALFORMED_CHECKSUMS")
    const result = portableChecksumDocumentSchema.safeParse(input)
    if (!result.success) {
      fail("MALFORMED_CHECKSUMS", firstIssue("Checksum document", result.error))
    }
    if (result.data.schemaVersion > PORTABLE_CHECKSUM_VERSION) {
      fail("FUTURE_VERSION", "Checksum document version is newer than supported.")
    }
    if (result.data.schemaVersion !== PORTABLE_CHECKSUM_VERSION) {
      fail("MALFORMED_CHECKSUMS", "Checksum document version is unsupported.")
    }
    const paths = new Map<string, string>()
    for (const entry of result.data.entries) {
      const collisionKey = portableCollisionKey(entry.path)
      const existing = paths.get(collisionKey)
      if (existing) {
        fail(
          "MALFORMED_CHECKSUMS",
          `Checksum paths ${existing} and ${entry.path} collide across portable filesystems.`,
        )
      }
      if (entry.path === PORTABLE_BUNDLE_LAYOUT.checksums) {
        fail("MALFORMED_CHECKSUMS", "The checksum document cannot checksum itself.")
      }
      paths.set(collisionKey, entry.path)
    }
    return result.data
  }

  validateExclusions(input: unknown): PortableExclusionDocument {
    assertDocumentEntryBound(input, PORTABILITY_LIMITS.exclusionEntries, "MALFORMED_EXCLUSIONS")
    const result = portableExclusionDocumentSchema.safeParse(input)
    if (!result.success) {
      fail("MALFORMED_EXCLUSIONS", firstIssue("Exclusion document", result.error))
    }
    if (result.data.schemaVersion > PORTABLE_EXCLUSION_VERSION) {
      fail("FUTURE_VERSION", "Exclusion document version is newer than supported.")
    }
    if (result.data.schemaVersion !== PORTABLE_EXCLUSION_VERSION) {
      fail("MALFORMED_EXCLUSIONS", "Exclusion document version is unsupported.")
    }
    const keys = new Map<string, string>()
    for (const entry of result.data.entries) {
      const scope = this.get(entry.scopeId)
      if (entry.path && !entry.path.startsWith(`${scope.contentPath}/`)) {
        fail(
          "MALFORMED_EXCLUSIONS",
          `Exclusion path ${entry.path} is outside scope ${entry.scopeId}.`,
        )
      }
      const rawKey = `${entry.scopeId}\0${entry.path ?? ""}\0${entry.category}`
      const collisionKey = portableCollisionKey(rawKey)
      const existing = keys.get(collisionKey)
      if (existing) {
        fail(
          "MALFORMED_EXCLUSIONS",
          `Exclusion keys ${existing} and ${rawKey} collide across portable filesystems.`,
        )
      }
      keys.set(collisionKey, rawKey)
    }
    return result.data
  }

  private topologicalOrder(scopeIds: readonly PortableScopeId[]): PortableScopeId[] {
    const included = new Set(scopeIds)
    const state = new Map<PortableScopeId, "visiting" | "visited">()
    const ordered: PortableScopeId[] = []
    const visit = (scopeId: PortableScopeId, lineage: PortableScopeId[]): void => {
      if (state.get(scopeId) === "visited") return
      if (state.get(scopeId) === "visiting") {
        const cycleStart = lineage.indexOf(scopeId)
        const cycle = [...lineage.slice(cycleStart), scopeId]
        fail("CYCLIC_DEPENDENCY", `Portable scope dependency cycle: ${cycle.join(" -> ")}.`, {
          cycle,
        })
      }
      state.set(scopeId, "visiting")
      const entry = this.get(scopeId)
      const dependencies = [...entry.dependencies]
        .filter((dependency) => included.has(dependency))
        .sort((left, right) => this.registryIndex(left) - this.registryIndex(right))
      dependencies.forEach((dependency) => visit(dependency, [...lineage, scopeId]))
      state.set(scopeId, "visited")
      ordered.push(scopeId)
    }
    ;[...included]
      .sort((left, right) => this.registryIndex(left) - this.registryIndex(right))
      .forEach((scopeId) => visit(scopeId, []))
    return ordered
  }

  private registryIndex(scopeId: PortableScopeId): number {
    return this.order?.get(scopeId) ?? this.contracts.findIndex((entry) => entry.id === scopeId)
  }
}

export const portableScopeRegistry = new PortableScopeRegistry(PORTABLE_SCOPE_CONTRACTS)

function validateContract(entry: PortableScopeContract): void {
  if (!PORTABLE_SCOPE_IDS.includes(entry.id)) {
    fail("UNKNOWN_SCOPE", `Portable scope ${entry.id} is not a stable scope ID.`)
  }
  if (
    !Number.isSafeInteger(entry.schema.current) ||
    !Number.isSafeInteger(entry.schema.minimumImport) ||
    entry.schema.current <= 0 ||
    entry.schema.minimumImport <= 0 ||
    entry.schema.minimumImport > entry.schema.current
  ) {
    fail("INVALID_VERSION", `Portable scope ${entry.id} has an invalid schema policy.`)
  }
  if (entry.contentPath !== `scopes/${entry.id}`) {
    fail("UNSAFE_PATH", `Portable scope ${entry.id} has a non-canonical content path.`)
  }
  if (entry.dependencies.length > PORTABLE_SCOPE_IDS.length) {
    fail("INVALID_REGISTRY", `Portable scope ${entry.id} declares too many dependencies.`)
  }
  if (new Set(entry.dependencies).size !== entry.dependencies.length) {
    fail("DUPLICATE_SCOPE", `Portable scope ${entry.id} repeats a dependency.`)
  }
  if (entry.dependencies.includes(entry.id)) {
    fail("CYCLIC_DEPENDENCY", `Portable scope ${entry.id} depends on itself.`)
  }
  if (
    entry.handler.contractVersion !== PORTABLE_SCOPE_HANDLER_CONTRACT_VERSION ||
    !Number.isSafeInteger(entry.handler.sourceContract.schemaVersion) ||
    entry.handler.sourceContract.schemaVersion <= 0
  ) {
    fail("INVALID_REGISTRY", `Portable scope ${entry.id} has an invalid handler contract.`)
  }
}

function parseManifestShape(input: unknown): PortableManifest {
  const result = portableManifestSchema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path.join(".") ?? "manifest"
  if (path === "directoryName") {
    fail("UNSAFE_BUNDLE_NAME", firstIssue("Bundle manifest", result.error))
  }
  if (path.includes("contentPath") || path.startsWith("layout.")) {
    fail("UNSAFE_PATH", firstIssue("Bundle manifest", result.error))
  }
  if (path.includes("schemaVersion") || path === "bundleVersion") {
    fail("INVALID_VERSION", firstIssue("Bundle manifest", result.error))
  }
  fail("INVALID_MANIFEST", firstIssue("Bundle manifest", result.error))
}

function validateProjectIds(
  entry: PortableScopeContract,
  projectIds?: readonly string[],
): string[] | undefined {
  if (!projectIds) return undefined
  if (!Array.isArray(projectIds)) {
    fail("INVALID_PROJECT_FILTER", `Portable scope ${entry.id} has a malformed project filter.`)
  }
  if (entry.projectFilter !== "optional") {
    fail("INVALID_PROJECT_FILTER", `Portable scope ${entry.id} does not accept project filters.`)
  }
  if (projectIds.length === 0 || projectIds.length > PORTABILITY_LIMITS.projectFilterCount) {
    fail("INVALID_PROJECT_FILTER", `Portable scope ${entry.id} has an invalid project filter size.`)
  }
  const seen = new Set<string>()
  const validated: string[] = []
  for (const projectId of projectIds) {
    if (!portableProjectIdSchema.safeParse(projectId).success) {
      fail("INVALID_PROJECT_FILTER", `Portable scope ${entry.id} has an invalid project ID.`)
    }
    const collisionKey = portableCollisionKey(projectId)
    if (seen.has(collisionKey)) {
      fail(
        "INVALID_PROJECT_FILTER",
        `Portable scope ${entry.id} repeats or collides with project ${projectId}.`,
      )
    }
    seen.add(collisionKey)
    validated.push(projectId)
  }
  return validated.sort((left, right) => left.localeCompare(right, "en"))
}

function mergeDependencyFilter(
  dependency: PortableScopeContract,
  dependencySelected: boolean,
  current: string[] | null | undefined,
  child: string[] | null | undefined,
): string[] | null {
  if (dependency.projectFilter === "none" || child === null) return null
  if (dependencySelected && current === null) return null
  if (!child) return current ?? null
  if (!dependencySelected || !current) return [...child]
  const merged = new Map(current.map((projectId) => [portableCollisionKey(projectId), projectId]))
  for (const projectId of child) {
    const collisionKey = portableCollisionKey(projectId)
    const existing = merged.get(collisionKey)
    if (existing && existing !== projectId) {
      fail(
        "INVALID_PROJECT_FILTER",
        `Portable dependency projects ${existing} and ${projectId} collide across filesystems.`,
      )
    }
    merged.set(collisionKey, projectId)
    if (merged.size > PORTABILITY_LIMITS.projectFilterCount) {
      fail("INVALID_PROJECT_FILTER", "Portable dependency project filter is too large.")
    }
  }
  return [...merged.values()].sort((left, right) => left.localeCompare(right, "en"))
}

function sameEffectiveFilter(
  previouslySelected: boolean,
  current: string[] | null | undefined,
  next: string[] | null,
): boolean {
  if (!previouslySelected) return false
  if (current === null || next === null) return current === next
  if (!current || current.length !== next.length) return false
  return current.every((projectId, index) => projectId === next[index])
}

function assertManifestAggregateBounds(input: unknown): void {
  if (!input || typeof input !== "object") return
  const scopes = (input as { scopes?: unknown }).scopes
  if (!Array.isArray(scopes)) return
  if (scopes.length > PORTABILITY_LIMITS.scopeCount) {
    fail("INVALID_MANIFEST", "Bundle manifest contains too many scopes.")
  }
  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") continue
    const projectIds = (scope as { projectIds?: unknown }).projectIds
    if (Array.isArray(projectIds) && projectIds.length > PORTABILITY_LIMITS.projectFilterCount) {
      fail("INVALID_PROJECT_FILTER", "Bundle manifest project filter is too large.")
    }
  }
}

function assertDocumentEntryBound(
  input: unknown,
  maximum: number,
  code: "MALFORMED_CHECKSUMS" | "MALFORMED_EXCLUSIONS",
): void {
  if (!input || typeof input !== "object") return
  const entries = (input as { entries?: unknown }).entries
  if (Array.isArray(entries) && entries.length > maximum) {
    fail(code, `Portable document exceeds the ${maximum}-entry limit.`)
  }
}

function assertDependencyProjectFilter(
  scopeId: PortableScopeId,
  child: PortableManifestScope,
  dependency: PortableManifestScope,
): void {
  if (!child.projectIds || !dependency.projectIds) return
  const allowed = new Set(dependency.projectIds)
  const missing = child.projectIds.filter((projectId) => !allowed.has(projectId))
  if (missing.length > 0) {
    fail(
      "INVALID_PROJECT_FILTER",
      `Manifest dependency ${dependency.id} omits projects required by ${scopeId}.`,
      { scopeId, dependency: dependency.id, missing },
    )
  }
}

function sameLayout(
  actual: PortableManifest["layout"],
  expected: typeof PORTABLE_BUNDLE_LAYOUT,
): boolean {
  return (
    actual.database === expected.database &&
    actual.checksums === expected.checksums &&
    actual.exclusions === expected.exclusions &&
    actual.scopesRoot === expected.scopesRoot
  )
}

function firstIssue(label: string, error: z.ZodError): string {
  const issue = error.issues[0]
  return `${label} is invalid at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "unknown error"}`
}

function fail(
  code: PortabilityContractErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new PortabilityContractError(code, message, details)
}
