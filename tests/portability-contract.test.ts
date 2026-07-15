import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  PORTABILITY_LIMITS,
  PORTABLE_BUNDLE_LAYOUT,
  PORTABLE_SCOPE_IDS,
  portableBundleDirectoryNameSchema,
  safeRelativeBundlePathSchema,
  type PortableManifest,
  type PortableScopeId,
} from "../src/shared/portability"
import {
  PORTABLE_SCOPE_CONTRACTS,
  PortabilityContractError,
  PortableScopeRegistry,
  portableScopeRegistry,
  type PortabilityContractErrorCode,
  type PortableScopeContract,
} from "../src/main/lib/portability/scope-registry"

const FIXTURES = join(process.cwd(), "tests", "fixtures", "portability-contract")
const SHA256_ZERO = "0".repeat(64)

describe("portability contract", () => {
  it("declares history as database metadata while local artifact files are excluded", () => {
    expect(portableScopeRegistry.get("history").handler.storage).toBe("database")
    expect(portableScopeRegistry.get("history").handler.sourceContract.id).toBe(
      "chat-run-history-metadata",
    )
  })
  it("publishes the fixed layout and all seven active non-mobile scope handlers", () => {
    expect(PORTABLE_BUNDLE_LAYOUT).toEqual({
      manifest: "manifest.json",
      database: "database/flapstack.sqlite3",
      checksums: "checksums.json",
      exclusions: "exclusions.json",
      scopesRoot: "scopes",
    })
    expect(PORTABLE_SCOPE_IDS).toEqual([
      "settings",
      "projects",
      "extensions",
      "project-vaults",
      "saved-workspaces",
      "usage",
      "history",
    ])
    expect(PORTABLE_SCOPE_IDS).not.toContain("mobile")
    expect(portableScopeRegistry.list().map((entry) => entry.id)).toEqual(PORTABLE_SCOPE_IDS)
    expect(new Set(portableScopeRegistry.list().map((entry) => entry.handler.id)).size).toBe(7)
    expect(containsFunction(PORTABLE_SCOPE_CONTRACTS)).toBe(false)
  })

  it("mirrors only prerequisite schema identities in pure handler descriptors", () => {
    expect(portableScopeRegistry.get("extensions").handler.sourceContract).toEqual({
      id: "extension-enablement-policy",
      schemaVersion: 1,
    })
    expect(portableScopeRegistry.get("project-vaults").handler.sourceContract).toEqual({
      id: "project-vault",
      schemaVersion: 1,
    })
    expect(portableScopeRegistry.get("saved-workspaces").handler.sourceContract).toEqual({
      id: "saved-workspace-layout",
      schemaVersion: 1,
    })
    expect(
      portableScopeRegistry.list().every((entry) => entry.handler.importMode === "staged-preview"),
    ).toBe(true)
    expect(
      portableScopeRegistry
        .list()
        .every((entry) => entry.handler.deletePolicy === "never-implicit"),
    ).toBe(true)
  })

  it("validates a fixture and returns dependency-first import order", () => {
    const manifest = fixture<PortableManifest>("valid-manifest.json")
    expect(portableScopeRegistry.validateManifest(manifest)).toEqual(manifest)
    expect(portableScopeRegistry.importOrder(manifest)).toEqual(["projects", "project-vaults"])
  })

  it("closes dependencies and merges sorted project filters deterministically", () => {
    const first = portableScopeRegistry.resolveSelection([
      { id: "project-vaults", projectIds: ["project-b", "project-a"] },
      { id: "extensions", projectIds: ["project-c"] },
    ])
    const second = portableScopeRegistry.resolveSelection([
      { id: "extensions", projectIds: ["project-c"] },
      { id: "project-vaults", projectIds: ["project-a", "project-b"] },
    ])
    expect(first).toEqual(second)
    expect(first.map((entry) => entry.id)).toEqual(["projects", "extensions", "project-vaults"])
    expect(first[0]?.projectIds).toEqual(["project-a", "project-b", "project-c"])
  })

  it("preserves explicitly selected-all dependencies regardless of selection order", () => {
    const allThenSubset = portableScopeRegistry.resolveSelection([
      { id: "projects" },
      { id: "project-vaults", projectIds: ["project-a"] },
    ])
    const subsetThenAll = portableScopeRegistry.resolveSelection([
      { id: "project-vaults", projectIds: ["project-a"] },
      { id: "projects" },
    ])
    expect(allThenSubset).toEqual(subsetThenAll)
    expect(allThenSubset.find((entry) => entry.id === "projects")).not.toHaveProperty("projectIds")

    const childAllFirst = portableScopeRegistry.resolveSelection([
      { id: "extensions" },
      { id: "project-vaults", projectIds: ["project-a"] },
    ])
    const childAllLast = portableScopeRegistry.resolveSelection([
      { id: "project-vaults", projectIds: ["project-a"] },
      { id: "extensions" },
    ])
    expect(childAllFirst).toEqual(childAllLast)
    expect(childAllFirst.find((entry) => entry.id === "projects")).not.toHaveProperty("projectIds")
  })

  it("propagates late filter broadening through two dependency levels", () => {
    const registry = chainedProjectRegistry()
    const lateAll = registry.resolveSelection([
      { id: "saved-workspaces" },
      { id: "history", projectIds: ["project-a"] },
    ])
    const earlyAll = registry.resolveSelection([
      { id: "history", projectIds: ["project-a"] },
      { id: "saved-workspaces" },
    ])
    expect(lateAll).toEqual(earlyAll)
    expect(lateAll.find((entry) => entry.id === "usage")).not.toHaveProperty("projectIds")
    expect(lateAll.find((entry) => entry.id === "projects")).not.toHaveProperty("projectIds")
  })

  it("propagates multiple subset unions through two dependency levels", () => {
    const registry = chainedProjectRegistry()
    const first = registry.resolveSelection([
      { id: "saved-workspaces", projectIds: ["project-b"] },
      { id: "history", projectIds: ["project-a"] },
    ])
    const second = registry.resolveSelection([
      { id: "history", projectIds: ["project-a"] },
      { id: "saved-workspaces", projectIds: ["project-b"] },
    ])
    expect(first).toEqual(second)
    expect(first.find((entry) => entry.id === "usage")?.projectIds).toEqual([
      "project-a",
      "project-b",
    ])
    expect(first.find((entry) => entry.id === "projects")?.projectIds).toEqual([
      "project-a",
      "project-b",
    ])
  })

  it("fails unknown and duplicate scopes deterministically", () => {
    expectContractError(
      () => portableScopeRegistry.validateManifest(fixture("unknown-scope.json")),
      "UNKNOWN_SCOPE",
    )
    const duplicate = structuredClone(fixture<PortableManifest>("valid-manifest.json"))
    duplicate.scopes.push(structuredClone(duplicate.scopes[0]!))
    expectContractError(() => portableScopeRegistry.validateManifest(duplicate), "DUPLICATE_SCOPE")
  })

  it("fails missing manifest and registry dependencies deterministically", () => {
    expectContractError(
      () => portableScopeRegistry.validateManifest(fixture("missing-dependency.json")),
      "MISSING_DEPENDENCY",
    )
    const registryFixture = fixture<RegistryFixture>("missing-registry-dependency.json")
    expectContractError(
      () => new PortableScopeRegistry(contractsFromFixture(registryFixture)),
      "MISSING_DEPENDENCY",
    )
  })

  it("fails cyclic registries with a stable cycle path", () => {
    const registryFixture = fixture<RegistryFixture>("cyclic-registry.json")
    try {
      new PortableScopeRegistry(contractsFromFixture(registryFixture))
      throw new Error("Expected cyclic registry failure.")
    } catch (error) {
      expect(error).toBeInstanceOf(PortabilityContractError)
      expect(error).toMatchObject({
        code: "CYCLIC_DEPENDENCY",
        details: { cycle: ["settings", "history", "settings"] },
      })
    }
  })

  it("caps dependency arrays before duplicate and graph work", () => {
    const source = PORTABLE_SCOPE_CONTRACTS.find((entry) => entry.id === "settings")!
    expectContractError(
      () =>
        new PortableScopeRegistry([
          {
            ...source,
            dependencies: Array.from(
              { length: PORTABLE_SCOPE_IDS.length + 1 },
              () => "history" as const,
            ),
          },
        ]),
      "INVALID_REGISTRY",
    )
  })

  it("rejects invalid and future bundle or scope versions", () => {
    expectContractError(
      () => portableScopeRegistry.validateManifest(fixture("future-version.json")),
      "FUTURE_VERSION",
    )
    expectContractError(
      () => portableScopeRegistry.validateManifest(fixture("invalid-version.json")),
      "INVALID_VERSION",
    )
    expectContractError(() => portableScopeRegistry.compatibility("settings", 3), "FUTURE_VERSION")
    expect(portableScopeRegistry.compatibility("settings", 1)).toEqual({
      status: "migration-required",
      fromVersion: 1,
      toVersion: 2,
    })
    expect(portableScopeRegistry.compatibility("settings", 2)).toEqual({
      status: "current",
      fromVersion: 2,
      toVersion: 2,
    })
  })

  it("rejects unsafe bundle names and manifest paths", () => {
    const manifest = fixture<PortableManifest>("valid-manifest.json")
    for (const name of [
      "../backup.flapstack-export",
      ".flapstack-export",
      "backup.flapstack-export/child",
      "backup",
      "backup..flapstack-export",
      "CON.flapstack-export",
      "nul.flapstack-export",
    ]) {
      expect(portableBundleDirectoryNameSchema.safeParse(name).success).toBe(false)
      expectContractError(
        () => portableScopeRegistry.validateManifest({ ...manifest, directoryName: name }),
        "UNSAFE_BUNDLE_NAME",
      )
    }
    for (const path of [
      "../database.sqlite3",
      "/database/flapstack.sqlite3",
      "C:/database/flapstack.sqlite3",
      "database\\flapstack.sqlite3",
      "database/%2e%2e/secret",
      "database//flapstack.sqlite3",
      "database/CON",
      "database/nul.txt",
      "database/COM1/snapshot",
      "database/lpt9.json",
    ]) {
      expect(safeRelativeBundlePathSchema.safeParse(path).success).toBe(false)
      expectContractError(
        () =>
          portableScopeRegistry.validateManifest({
            ...manifest,
            layout: { ...manifest.layout, database: path },
          }),
        "UNSAFE_PATH",
      )
    }
    expect(safeRelativeBundlePathSchema.safeParse("database/com10/snapshot").success).toBe(true)
  })

  it("enforces UTF-8 byte limits for names, IDs, paths, versions, and reasons", () => {
    const manifest = fixture<PortableManifest>("valid-manifest.json")
    expect(
      portableBundleDirectoryNameSchema.safeParse(`${"界".repeat(80)}.flapstack-export`).success,
    ).toBe(false)
    expect(safeRelativeBundlePathSchema.safeParse("界".repeat(1_366)).success).toBe(false)
    expectContractError(
      () =>
        portableScopeRegistry.resolveSelection([{ id: "projects", projectIds: ["界".repeat(67)] }]),
      "INVALID_PROJECT_FILTER",
    )
    expectContractError(
      () => portableScopeRegistry.validateManifest({ ...manifest, appVersion: "界".repeat(43) }),
      "INVALID_MANIFEST",
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateExclusions({
          schemaVersion: 1,
          entries: [
            {
              scopeId: "settings",
              category: "user-excluded",
              sensitivity: "private",
              reason: "界".repeat(342),
            },
          ],
        }),
      "MALFORMED_EXCLUSIONS",
    )
  })

  it("holds safe-path properties across seeded generated paths and traversal mutations", () => {
    const next = seededRandom(0x5f8_0001)
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_"
    for (let index = 0; index < 500; index += 1) {
      const depth = 1 + Math.floor(next() * 6)
      const path = Array.from({ length: depth }, () => randomSegment(next, alphabet)).join("/")
      expect(safeRelativeBundlePathSchema.safeParse(path).success).toBe(true)
      for (const unsafe of [
        `../${path}`,
        `${path}/..`,
        `/${path}`,
        `${path}\\escape`,
        `${path}/%2f/escape`,
      ]) {
        expect(safeRelativeBundlePathSchema.safeParse(unsafe).success).toBe(false)
      }
    }
  })

  it("enforces path, project-filter, checksum, and exclusion bounds", () => {
    expect(
      safeRelativeBundlePathSchema.safeParse("a".repeat(PORTABILITY_LIMITS.relativePathBytes))
        .success,
    ).toBe(true)
    expect(
      safeRelativeBundlePathSchema.safeParse("a".repeat(PORTABILITY_LIMITS.relativePathBytes + 1))
        .success,
    ).toBe(false)
    const projectIds = Array.from(
      { length: PORTABILITY_LIMITS.projectFilterCount },
      (_, index) => `project-${index}`,
    )
    expect(() =>
      portableScopeRegistry.resolveSelection([{ id: "projects", projectIds }]),
    ).not.toThrow()
    expectContractError(
      () =>
        portableScopeRegistry.resolveSelection([
          { id: "projects", projectIds: [...projectIds, "one-too-many"] },
        ]),
      "INVALID_PROJECT_FILTER",
    )
    const tooManyChecksums = Array.from(
      { length: PORTABILITY_LIMITS.checksumEntries + 1 },
      (_, index) => ({ path: `scopes/settings/${index}`, sha256: SHA256_ZERO, bytes: 0 }),
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateChecksums({
          schemaVersion: 1,
          algorithm: "sha256",
          entries: tooManyChecksums,
        }),
      "MALFORMED_CHECKSUMS",
    )
    const tooManyExclusions = Array.from(
      { length: PORTABILITY_LIMITS.exclusionEntries + 1 },
      (_, index) => ({
        scopeId: "settings",
        category: "user-excluded",
        sensitivity: "private",
        reason: `Excluded ${index}`,
      }),
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateExclusions({
          schemaVersion: 1,
          entries: tooManyExclusions,
        }),
      "MALFORMED_EXCLUSIONS",
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateManifest({
          ...fixture<PortableManifest>("valid-manifest.json"),
          scopes: Array.from({ length: PORTABILITY_LIMITS.scopeCount + 1 }, () => ({
            id: "settings",
            schemaVersion: 1,
            contentPath: "scopes/settings",
          })),
        }),
      "INVALID_MANIFEST",
    )
    const firstHalf = Array.from({ length: 600 }, (_, index) => `project-a-${index}`)
    const secondHalf = Array.from({ length: 600 }, (_, index) => `project-b-${index}`)
    expectContractError(
      () =>
        chainedProjectRegistry().resolveSelection([
          { id: "history", projectIds: firstHalf },
          { id: "saved-workspaces", projectIds: secondHalf },
        ]),
      "INVALID_PROJECT_FILTER",
    )
  })

  it("validates checksum syntax, uniqueness, and self-exclusion", () => {
    const valid = {
      schemaVersion: 1,
      algorithm: "sha256",
      entries: [{ path: "manifest.json", sha256: SHA256_ZERO, bytes: 12 }],
    }
    expect(portableScopeRegistry.validateChecksums(valid)).toEqual(valid)
    expectContractError(
      () =>
        portableScopeRegistry.validateChecksums({
          ...valid,
          entries: [valid.entries[0], valid.entries[0]],
        }),
      "MALFORMED_CHECKSUMS",
    )
    for (const [left, right] of [
      ["scopes/settings/Readme", "scopes/settings/README"],
      ["scopes/settings/café", "scopes/settings/cafe\u0301"],
    ]) {
      expectContractError(
        () =>
          portableScopeRegistry.validateChecksums({
            ...valid,
            entries: [
              { path: left, sha256: SHA256_ZERO, bytes: 1 },
              { path: right, sha256: "1".repeat(64), bytes: 1 },
            ],
          }),
        "MALFORMED_CHECKSUMS",
      )
    }
    expectContractError(
      () =>
        portableScopeRegistry.validateChecksums({
          ...valid,
          entries: [{ ...valid.entries[0], sha256: "A".repeat(64) }],
        }),
      "MALFORMED_CHECKSUMS",
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateChecksums({
          ...valid,
          entries: [{ ...valid.entries[0], path: "checksums.json" }],
        }),
      "MALFORMED_CHECKSUMS",
    )
  })

  it("validates category-only exclusions without performing T2 secret scanning", () => {
    const valid = {
      schemaVersion: 1,
      entries: [
        {
          scopeId: "extensions",
          path: "scopes/extensions/codex/settings.json",
          category: "credential",
          sensitivity: "secret-bearing",
          reason: "Credential reference omitted.",
        },
      ],
    }
    expect(portableScopeRegistry.validateExclusions(valid)).toEqual(valid)
    expectContractError(
      () =>
        portableScopeRegistry.validateExclusions({
          ...valid,
          entries: [{ ...valid.entries[0], scopeId: "mobile" }],
        }),
      "UNKNOWN_SCOPE",
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateExclusions({
          ...valid,
          entries: [{ ...valid.entries[0], path: "scopes/settings/secret" }],
        }),
      "MALFORMED_EXCLUSIONS",
    )
    expectContractError(
      () =>
        portableScopeRegistry.validateExclusions({
          ...valid,
          entries: [{ ...valid.entries[0], category: "raw-secret-value" }],
        }),
      "MALFORMED_EXCLUSIONS",
    )
    for (const [left, right] of [
      ["scopes/extensions/Policy.json", "scopes/extensions/policy.json"],
      ["scopes/extensions/café.json", "scopes/extensions/cafe\u0301.json"],
    ]) {
      expectContractError(
        () =>
          portableScopeRegistry.validateExclusions({
            schemaVersion: 1,
            entries: [
              { ...valid.entries[0], path: left },
              { ...valid.entries[0], path: right },
            ],
          }),
        "MALFORMED_EXCLUSIONS",
      )
    }
  })

  it("rejects invalid project filters and dependency filter narrowing", () => {
    expectContractError(
      () => portableScopeRegistry.resolveSelection([{ id: "settings", projectIds: ["p1"] }]),
      "INVALID_PROJECT_FILTER",
    )
    for (const projectIds of [
      ["Project-A", "project-a"],
      ["café", "cafe\u0301"],
      [" project-a"],
      ["project/a"],
      ["project\\a"],
      ["project\u0000a"],
    ]) {
      expectContractError(
        () => portableScopeRegistry.resolveSelection([{ id: "projects", projectIds }]),
        "INVALID_PROJECT_FILTER",
      )
    }
    for (const [left, right] of [
      ["Project-A", "project-a"],
      ["café", "cafe\u0301"],
    ]) {
      expectContractError(
        () =>
          chainedProjectRegistry().resolveSelection([
            { id: "history", projectIds: [left] },
            { id: "saved-workspaces", projectIds: [right] },
          ]),
        "INVALID_PROJECT_FILTER",
      )
    }
    expectContractError(
      () => portableScopeRegistry.resolveSelection([{ id: "projects", projectIds: ["p1", "p1"] }]),
      "INVALID_PROJECT_FILTER",
    )
    expectContractError(
      () =>
        portableScopeRegistry.resolveSelection([
          { id: "projects", projectIds: "p1" as unknown as string[] },
        ]),
      "INVALID_PROJECT_FILTER",
    )
    const manifest = fixture<PortableManifest>("valid-manifest.json")
    manifest.scopes[0]!.projectIds = ["different-project"]
    expectContractError(
      () => portableScopeRegistry.validateManifest(manifest),
      "INVALID_PROJECT_FILTER",
    )
  })
})

type RegistryFixture = {
  contracts: Array<{ id: PortableScopeId; dependencies: string[] }>
}

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T
}

function contractsFromFixture(value: RegistryFixture): PortableScopeContract[] {
  return value.contracts.map(({ id, dependencies }) => {
    const source = PORTABLE_SCOPE_CONTRACTS.find((entry) => entry.id === id)
    if (!source) throw new Error(`Missing test source contract ${id}.`)
    return { ...source, dependencies: dependencies as PortableScopeId[] }
  })
}

function chainedProjectRegistry(): PortableScopeRegistry {
  const dependencyMap: Partial<Record<PortableScopeId, PortableScopeId[]>> = {
    projects: [],
    usage: ["projects"],
    history: ["usage"],
    "saved-workspaces": ["usage"],
  }
  const contracts = (["projects", "usage", "history", "saved-workspaces"] as const).map((id) => {
    const source = PORTABLE_SCOPE_CONTRACTS.find((entry) => entry.id === id)!
    return { ...source, dependencies: dependencyMap[id]! }
  })
  return new PortableScopeRegistry(contracts)
}

function expectContractError(operation: () => unknown, code: PortabilityContractErrorCode): void {
  try {
    operation()
    throw new Error(`Expected ${code}.`)
  } catch (error) {
    expect(error).toBeInstanceOf(PortabilityContractError)
    expect(error).toMatchObject({ code })
  }
}

function containsFunction(value: unknown): boolean {
  if (typeof value === "function") return true
  if (!value || typeof value !== "object") return false
  return Object.values(value).some(containsFunction)
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function randomSegment(next: () => number, alphabet: string): string {
  const length = 1 + Math.floor(next() * 20)
  return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]!).join("")
}
