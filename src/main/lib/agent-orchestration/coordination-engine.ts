import Database from "better-sqlite3"
import {
  COORDINATION_ENGINES,
  COORDINATION_ENGINE_CAPABILITIES,
  COORDINATION_ENGINE_SOURCES,
  COORDINATION_ENGINE_VERSIONS,
  coordinationEngineDefaultDeleteSchema,
  coordinationEngineDefaultListSchema,
  coordinationEngineDefaultWriteSchema,
  type CoordinationEngine,
  type CoordinationEngineBlockReason,
  type CoordinationEngineCapability,
  type CoordinationEngineDefaultDto,
  type CoordinationEngineDefaultScope,
  type CoordinationEngineLaunchPreview,
  type CoordinationEngineProbe,
  type CoordinationEngineSource,
  type ResolvedCoordinationEngineSnapshot,
} from "../../../shared/coordination-engine"
import { millisecondsToEpochSeconds } from "../db/timestamps"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

const ENGINE_LABELS: Record<CoordinationEngine, string> = {
  workflow: "Workflow",
  "codex-v2": "Codex task tree (V2)",
  "codex-v1": "Codex legacy threads (V1)",
}

const ENGINE_DESCRIPTIONS: Record<CoordinationEngine, string> = {
  workflow: "Deterministic, inspectable Flapstack workflow. Recommended for mixed workers.",
  "codex-v2": "Native Codex named task tree, mailbox, follow-up, and selective context forks.",
  "codex-v1": "Advanced legacy Codex agent-ID compatibility without V2 task-tree features.",
}

const ENGINE_CAPABILITIES: Record<CoordinationEngine, CoordinationEngineCapability[]> = {
  workflow: ["durable-workflow", "checkpoints", "mixed-runtimes"],
  "codex-v2": [
    "named-task-paths",
    "selective-context-fork",
    "queued-messages",
    "follow-up",
    "mailbox",
    "interrupt-without-destroy",
    "resident-workers",
  ],
  "codex-v1": ["legacy-agent-ids", "legacy-resume", "legacy-close"],
}

export class CoordinationEngineError extends Error {
  constructor(
    readonly code: CoordinationEngineBlockReason["code"],
    message: string,
    readonly reason?: CoordinationEngineBlockReason,
  ) {
    super(message)
    this.name = "CoordinationEngineError"
  }
}

export class CoordinationEngineDefaultsService {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  list(inputValue: unknown = {}): CoordinationEngineDefaultDto[] {
    const input = coordinationEngineDefaultListSchema.parse(inputValue)
    const rows = input.scope
      ? (this.sqlite
          .prepare(
            `SELECT scope_type, scope_id, engine, version, created_at, updated_at
             FROM coordination_engine_defaults
             WHERE id = ?
             ORDER BY scope_type, scope_id`,
          )
          .all(defaultId(input.scope)) as Row[])
      : (this.sqlite
          .prepare(
            `SELECT scope_type, scope_id, engine, version, created_at, updated_at
             FROM coordination_engine_defaults
             ORDER BY scope_type, scope_id`,
          )
          .all() as Row[])
    return rows.map(rowToDefault)
  }

  get(scope: CoordinationEngineDefaultScope): CoordinationEngineDefaultDto | null {
    const row = this.sqlite
      .prepare(
        `SELECT scope_type, scope_id, engine, version, created_at, updated_at
         FROM coordination_engine_defaults WHERE id = ?`,
      )
      .get(defaultId(scope)) as Row | undefined
    return row ? rowToDefault(row) : null
  }

  write(inputValue: unknown, now = Date.now()): CoordinationEngineDefaultDto {
    const input = coordinationEngineDefaultWriteSchema.parse(inputValue)
    this.assertScope(input.scope)
    const id = defaultId(input.scope)
    const current = this.get(input.scope)
    if (!current) {
      if (input.expectedVersion !== 0) throw settingsVersionConflict(input.engine)
      try {
        this.sqlite
          .prepare(
            `INSERT INTO coordination_engine_defaults (
              id, scope_type, scope_id, engine, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            id,
            input.scope.type,
            input.scope.id,
            input.engine,
            millisecondsToEpochSeconds(now),
            millisecondsToEpochSeconds(now),
          )
      } catch (error) {
        if (isConstraintError(error)) throw settingsVersionConflict(input.engine)
        throw error
      }
    } else {
      if (current.version !== input.expectedVersion) {
        throw settingsVersionConflict(input.engine)
      }
      const result = this.sqlite
        .prepare(
          `UPDATE coordination_engine_defaults
           SET engine = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(input.engine, millisecondsToEpochSeconds(now), id, input.expectedVersion)
      if (result.changes !== 1) throw settingsVersionConflict(input.engine)
    }
    return this.get(input.scope)!
  }

  delete(inputValue: unknown): boolean {
    const input = coordinationEngineDefaultDeleteSchema.parse(inputValue)
    const result = this.sqlite
      .prepare("DELETE FROM coordination_engine_defaults WHERE id = ? AND version = ?")
      .run(defaultId(input.scope), input.expectedVersion)
    if (result.changes !== 1) throw settingsVersionConflict("workflow")
    return true
  }

  private assertScope(scope: CoordinationEngineDefaultScope): void {
    if (scope.type === "global") return
    const project = this.sqlite
      .prepare("SELECT id, archived_at FROM projects WHERE id = ?")
      .get(scope.id) as { id: string; archived_at: number | null } | undefined
    if (!project || project.archived_at !== null) {
      throw new CoordinationEngineError(
        "project-missing",
        "Coordination engine project is missing.",
      )
    }
  }
}

export type CoordinationEngineResolutionInput = {
  perLaunchEngine?: CoordinationEngine | null
  projectEngine?: CoordinationEngine | null
  globalEngine?: CoordinationEngine | null
  probes?: Partial<Record<CoordinationEngine, CoordinationEngineProbe>>
}

export type CoordinationEngineResolutionResult =
  | { ok: true; snapshot: ResolvedCoordinationEngineSnapshot }
  | { ok: false; reason: CoordinationEngineBlockReason }

export function resolveCoordinationEngine(
  input: CoordinationEngineResolutionInput,
): CoordinationEngineResolutionResult {
  const selected = selectEngine(input)
  const probes = { ...createDefaultCoordinationEngineProbes(), ...input.probes }
  const validation = validateProbe(selected.engine, probes[selected.engine])
  if (!validation.ok) return { ok: false, reason: validation.reason }
  const probe = validation.probe
  if (!probe.available) {
    return { ok: false, reason: probe.reason ?? unavailableReason(selected.engine) }
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      requestedEngine: selected.engine,
      source: selected.source,
      engine: selected.engine,
      engineVersion: probe.engineVersion,
      capabilities: probe.snapshot,
      providerIdentity: null,
    },
  }
}

export function previewCoordinationEngine(
  input: CoordinationEngineResolutionInput,
): CoordinationEngineLaunchPreview {
  const selected = selectEngine(input)
  const probes = { ...createDefaultCoordinationEngineProbes(), ...input.probes }
  const resolved = resolveCoordinationEngine({ ...input, probes })
  return {
    ok: resolved.ok,
    source: selected.source,
    requestedEngine: selected.engine,
    resolved: resolved.ok ? resolved.snapshot : null,
    blockedReason: resolved.ok ? null : resolved.reason,
    options: COORDINATION_ENGINES.map((engine) => {
      const validation = validateProbe(engine, probes[engine])
      return {
        engine,
        label: ENGINE_LABELS[engine],
        description: ENGINE_DESCRIPTIONS[engine],
        advanced: engine === "codex-v1",
        selected: engine === selected.engine,
        supported: validation.ok && validation.probe.available,
        reason: validation.ok ? validation.probe.reason : validation.reason,
      }
    }),
  }
}

export function constructCoordinationEngineSnapshot(
  database: DatabaseLike,
  input: {
    projectId: string
    perLaunchEngine?: CoordinationEngine | null
    probes?: Partial<Record<CoordinationEngine, CoordinationEngineProbe>>
  },
): ResolvedCoordinationEngineSnapshot {
  const sqlite = rawClient(database)
  const project = sqlite
    .prepare("SELECT id, archived_at FROM projects WHERE id = ?")
    .get(input.projectId) as { id: string; archived_at: number | null } | undefined
  if (!project || project.archived_at !== null) {
    throw new CoordinationEngineError("project-missing", "Coordination engine project is missing.")
  }
  const defaults = new CoordinationEngineDefaultsService(sqlite)
  const result = resolveCoordinationEngine({
    perLaunchEngine: input.perLaunchEngine,
    projectEngine: defaults.get({ type: "project", id: input.projectId })?.engine,
    globalEngine: defaults.get({ type: "global", id: null })?.engine,
    probes: input.probes,
  })
  if (!result.ok) {
    throw new CoordinationEngineError(result.reason.code, result.reason.message, result.reason)
  }
  return result.snapshot
}

export function previewCoordinationEngineForProject(
  database: DatabaseLike,
  input: {
    projectId: string
    perLaunchEngine?: CoordinationEngine | null
    probes?: Partial<Record<CoordinationEngine, CoordinationEngineProbe>>
  },
): CoordinationEngineLaunchPreview {
  const sqlite = rawClient(database)
  const project = sqlite
    .prepare("SELECT id, archived_at FROM projects WHERE id = ?")
    .get(input.projectId) as { id: string; archived_at: number | null } | undefined
  if (!project || project.archived_at !== null) {
    throw new CoordinationEngineError("project-missing", "Coordination engine project is missing.")
  }
  const defaults = new CoordinationEngineDefaultsService(sqlite)
  return previewCoordinationEngine({
    perLaunchEngine: input.perLaunchEngine,
    projectEngine: defaults.get({ type: "project", id: input.projectId })?.engine,
    globalEngine: defaults.get({ type: "global", id: null })?.engine,
    probes: input.probes,
  })
}

export function coordinationEngineSnapshotColumns(snapshot: ResolvedCoordinationEngineSnapshot): {
  engineSnapshotVersion: number
  coordinationEngine: CoordinationEngine
  coordinationEngineVersion: string
  coordinationEngineSource: CoordinationEngineSource
  coordinationEngineCapabilitySnapshot: string
  coordinationEngineProviderIdentity: string
} {
  return {
    engineSnapshotVersion: snapshot.schemaVersion,
    coordinationEngine: snapshot.engine,
    coordinationEngineVersion: snapshot.engineVersion,
    coordinationEngineSource: snapshot.source,
    coordinationEngineCapabilitySnapshot: JSON.stringify(snapshot.capabilities),
    coordinationEngineProviderIdentity: JSON.stringify(snapshot.providerIdentity),
  }
}

export function coordinationEngineSnapshotSqlValues(
  snapshot: ResolvedCoordinationEngineSnapshot,
): readonly [number, string, string, string, string, string] {
  const columns = coordinationEngineSnapshotColumns(snapshot)
  return [
    columns.engineSnapshotVersion,
    columns.coordinationEngine,
    columns.coordinationEngineVersion,
    columns.coordinationEngineSource,
    columns.coordinationEngineCapabilitySnapshot,
    columns.coordinationEngineProviderIdentity,
  ]
}

export function interpretCoordinationEngineSnapshot(row: Row): ResolvedCoordinationEngineSnapshot {
  const snapshotVersion = Number(row.engine_snapshot_version)
  const knownEngine = COORDINATION_ENGINES.includes(row.coordination_engine as CoordinationEngine)
    ? (row.coordination_engine as CoordinationEngine)
    : undefined
  if (snapshotVersion === 0) {
    if (
      row.coordination_engine !== "workflow" ||
      row.coordination_engine_version !== "workflow-legacy-graph" ||
      row.coordination_engine_source !== "legacy"
    ) {
      throw corruptSnapshot("Legacy coordination engine snapshot is mismatched.", knownEngine)
    }
    return legacyCoordinationEngineSnapshot()
  }
  if (snapshotVersion !== 1) {
    throw corruptSnapshot("Coordination engine snapshot version is invalid.", knownEngine)
  }
  const engine = String(row.coordination_engine)
  const source = String(row.coordination_engine_source)
  if (
    !COORDINATION_ENGINES.includes(engine as CoordinationEngine) ||
    !COORDINATION_ENGINE_SOURCES.includes(source as CoordinationEngineSource) ||
    source === "legacy"
  ) {
    throw corruptSnapshot("Coordination engine identity or source is invalid.", knownEngine)
  }
  let capabilities: unknown
  let providerIdentity: unknown
  try {
    capabilities = JSON.parse(String(row.coordination_engine_capability_snapshot))
    providerIdentity = JSON.parse(String(row.coordination_engine_provider_identity))
  } catch {
    throw corruptSnapshot("Coordination engine snapshot JSON is corrupt.", knownEngine)
  }
  const probe = {
    engine: engine as CoordinationEngine,
    available: true,
    engineVersion: String(row.coordination_engine_version),
    snapshot: capabilities,
    reason: null,
  } as CoordinationEngineProbe
  const validation = validateProbe(engine as CoordinationEngine, probe)
  if (!validation.ok)
    throw new CoordinationEngineError(
      validation.reason.code,
      validation.reason.message,
      validation.reason,
    )
  if (!validProviderIdentity(engine as CoordinationEngine, providerIdentity)) {
    throw corruptSnapshot(
      "Coordination engine provider identity is mismatched.",
      engine as CoordinationEngine,
    )
  }
  return {
    schemaVersion: 1,
    requestedEngine: engine as CoordinationEngine,
    source: source as CoordinationEngineSource,
    engine: engine as CoordinationEngine,
    engineVersion: validation.probe.engineVersion,
    capabilities: validation.probe.snapshot,
    providerIdentity: providerIdentity as ResolvedCoordinationEngineSnapshot["providerIdentity"],
  }
}

export function legacyCoordinationEngineSnapshot(): ResolvedCoordinationEngineSnapshot {
  return {
    schemaVersion: 1,
    requestedEngine: "workflow",
    source: "legacy",
    engine: "workflow",
    engineVersion: "workflow-legacy-graph",
    capabilities: {
      schemaVersion: 1,
      engine: "workflow",
      engineVersion: "workflow-legacy-graph",
      status: "legacy",
      capturedAt: null,
      capabilities: ["durable-workflow"],
      limitations: ["Historical Stage 3 graph orchestration; no versioned workflow program."],
      unavailableReason: null,
    },
    providerIdentity: null,
  }
}

export function createDefaultCoordinationEngineProbes(
  capturedAt = new Date().toISOString(),
): Record<CoordinationEngine, CoordinationEngineProbe> {
  const workflow = availableProbe("workflow", capturedAt)
  const v2Reason = unavailableReason(
    "codex-v2",
    ["named-task-paths", "mailbox", "follow-up"],
    "Codex V2 task-tree capability has not been registered.",
    "Install or enable a Codex Runtime that reports V2 task-tree capability.",
  )
  const v1Reason = unavailableReason(
    "codex-v1",
    ["legacy-agent-ids"],
    "Codex V1 compatibility adapter has not been registered.",
    "Enable the advanced Codex V1 adapter or choose Workflow.",
  )
  return {
    workflow,
    "codex-v2": unavailableProbe("codex-v2", capturedAt, v2Reason),
    "codex-v1": unavailableProbe("codex-v1", capturedAt, v1Reason),
  }
}

function availableProbe(engine: CoordinationEngine, capturedAt: string): CoordinationEngineProbe {
  const engineVersion = COORDINATION_ENGINE_VERSIONS[engine]
  return {
    engine,
    available: true,
    engineVersion,
    snapshot: {
      schemaVersion: 1,
      engine,
      engineVersion,
      status: "available",
      capturedAt,
      capabilities: ENGINE_CAPABILITIES[engine],
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}

function unavailableProbe(
  engine: CoordinationEngine,
  capturedAt: string,
  reason: CoordinationEngineBlockReason,
): CoordinationEngineProbe {
  const engineVersion = COORDINATION_ENGINE_VERSIONS[engine]
  return {
    engine,
    available: false,
    engineVersion,
    snapshot: {
      schemaVersion: 1,
      engine,
      engineVersion,
      status: "unavailable",
      capturedAt,
      capabilities: [],
      limitations: [reason.message],
      unavailableReason: reason,
    },
    reason,
  }
}

function selectEngine(input: CoordinationEngineResolutionInput): {
  engine: CoordinationEngine
  source: CoordinationEngineSource
} {
  if (input.perLaunchEngine) return { engine: input.perLaunchEngine, source: "per-launch" }
  if (input.projectEngine) return { engine: input.projectEngine, source: "project" }
  if (input.globalEngine) return { engine: input.globalEngine, source: "global" }
  return { engine: "workflow", source: "product" }
}

function unavailableReason(
  engine: CoordinationEngine,
  missingCapabilities: CoordinationEngineCapability[] = [],
  message = `${ENGINE_LABELS[engine]} is unavailable.`,
  repair = "Choose Workflow or repair the selected engine capability.",
): CoordinationEngineBlockReason {
  return {
    code: missingCapabilities.length > 0 ? "engine-capability-missing" : "engine-unavailable",
    engine,
    message,
    missingCapabilities,
    repair,
  }
}

function validateProbe(
  expectedEngine: CoordinationEngine,
  probe: CoordinationEngineProbe,
):
  | { ok: true; probe: CoordinationEngineProbe }
  | { ok: false; reason: CoordinationEngineBlockReason } {
  const snapshot = probe?.snapshot
  const validCapabilities =
    isRecord(snapshot) &&
    Array.isArray(snapshot.capabilities) &&
    snapshot.capabilities.length <= COORDINATION_ENGINE_CAPABILITIES.length &&
    new Set(snapshot.capabilities).size === snapshot.capabilities.length &&
    snapshot.capabilities.every(
      (capability) =>
        typeof capability === "string" &&
        COORDINATION_ENGINE_CAPABILITIES.includes(capability as CoordinationEngineCapability),
    )
  const validCapturedAt =
    isRecord(snapshot) &&
    boundedString(snapshot.capturedAt, 128) &&
    Number.isFinite(Date.parse(snapshot.capturedAt))
  const validLimitations =
    isRecord(snapshot) &&
    Array.isArray(snapshot.limitations) &&
    snapshot.limitations.length <= 32 &&
    snapshot.limitations.every((value) => boundedString(value, 1_000))
  const validUnavailablePair =
    isRecord(snapshot) &&
    ((probe.available && probe.reason === null && snapshot.unavailableReason === null) ||
      (!probe.available &&
        validBlockReason(probe.reason, expectedEngine) &&
        validBlockReason(snapshot.unavailableReason, expectedEngine) &&
        sameBlockReason(probe.reason, snapshot.unavailableReason)))
  const coherent =
    probe?.engine === expectedEngine &&
    typeof probe.engineVersion === "string" &&
    probe.engineVersion === COORDINATION_ENGINE_VERSIONS[expectedEngine] &&
    isRecord(snapshot) &&
    snapshot.schemaVersion === 1 &&
    snapshot.engine === expectedEngine &&
    snapshot.engineVersion === probe.engineVersion &&
    validCapabilities &&
    validCapturedAt &&
    validLimitations &&
    validUnavailablePair &&
    ((probe.available && snapshot.status === "available") ||
      (!probe.available && snapshot.status === "unavailable" && probe.reason !== null))
  if (!coherent) {
    return {
      ok: false,
      reason: {
        code: "engine-version-unsupported",
        engine: expectedEngine,
        message: `${ENGINE_LABELS[expectedEngine]} capability probe is corrupt or mismatched.`,
        missingCapabilities: [],
        repair: "Refresh the provider capability probe before launch.",
      },
    }
  }
  if (probe.available) {
    const supplied = new Set(probe.snapshot.capabilities)
    const missingCapabilities = ENGINE_CAPABILITIES[expectedEngine].filter(
      (capability) => !supplied.has(capability),
    )
    if (missingCapabilities.length > 0) {
      return {
        ok: false,
        reason: {
          code: "engine-capability-missing",
          engine: expectedEngine,
          message: `${ENGINE_LABELS[expectedEngine]} is missing required capabilities: ${missingCapabilities.join(", ")}.`,
          missingCapabilities,
          repair: "Refresh or upgrade the engine adapter before launch.",
        },
      }
    }
  }
  return { ok: true, probe }
}

function corruptSnapshot(
  message: string,
  engine: CoordinationEngine = "workflow",
): CoordinationEngineError {
  const reason: CoordinationEngineBlockReason = {
    code: "engine-version-unsupported",
    engine,
    message,
    missingCapabilities: [],
    repair: "Keep the orchestration blocked and inspect its durable engine snapshot.",
  }
  return new CoordinationEngineError(reason.code, reason.message, reason)
}

function validProviderIdentity(engine: CoordinationEngine, identity: unknown): boolean {
  if (identity === null) return true
  if (!isRecord(identity) || identity.schemaVersion !== 1 || identity.engine !== engine)
    return false
  if (engine === "workflow") return boundedString(identity.workflowRunId, 512)
  if (engine === "codex-v2") {
    return (
      boundedString(identity.canonicalTaskPath, 1_024) &&
      boundedString(identity.taskName, 200) &&
      nullableBoundedString(identity.providerTaskId, 512)
    )
  }
  return (
    boundedString(identity.providerAgentId, 512) && nullableBoundedString(identity.nickname, 160)
  )
}

function validBlockReason(
  value: unknown,
  engine: CoordinationEngine,
): value is CoordinationEngineBlockReason {
  if (!isRecord(value) || value.engine !== engine) return false
  if (
    ![
      "engine-unavailable",
      "engine-capability-missing",
      "engine-version-unsupported",
      "engine-settings-version-conflict",
      "project-missing",
      "active-orchestration",
    ].includes(String(value.code))
  ) {
    return false
  }
  return (
    boundedString(value.message, 1_000) &&
    boundedString(value.repair, 1_000) &&
    Array.isArray(value.missingCapabilities) &&
    value.missingCapabilities.length <= COORDINATION_ENGINE_CAPABILITIES.length &&
    new Set(value.missingCapabilities).size === value.missingCapabilities.length &&
    value.missingCapabilities.every(
      (capability) =>
        typeof capability === "string" &&
        COORDINATION_ENGINE_CAPABILITIES.includes(capability as CoordinationEngineCapability),
    ) &&
    ((value.code === "engine-capability-missing" && value.missingCapabilities.length > 0) ||
      (value.code !== "engine-capability-missing" && value.missingCapabilities.length === 0))
  )
}

function sameBlockReason(
  left: CoordinationEngineBlockReason,
  right: CoordinationEngineBlockReason,
): boolean {
  return (
    left.code === right.code &&
    left.engine === right.engine &&
    left.message === right.message &&
    left.repair === right.repair &&
    left.missingCapabilities.length === right.missingCapabilities.length &&
    left.missingCapabilities.every(
      (capability, index) => capability === right.missingCapabilities[index],
    )
  )
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
}

function nullableBoundedString(value: unknown, maxLength: number): boolean {
  return value === null || boundedString(value, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function settingsVersionConflict(engine: CoordinationEngine): CoordinationEngineError {
  return new CoordinationEngineError(
    "engine-settings-version-conflict",
    "Coordination engine settings version conflict.",
    {
      code: "engine-settings-version-conflict",
      engine,
      message: "Coordination engine settings changed in another window.",
      missingCapabilities: [],
      repair: "Refresh Settings and retry.",
    },
  )
}

function defaultId(scope: CoordinationEngineDefaultScope): string {
  return scope.type === "global" ? "global" : `project:${scope.id}`
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as unknown as { $client: Sqlite }).$client
}

function rowToDefault(row: Row): CoordinationEngineDefaultDto {
  const type = String(row.scope_type) as CoordinationEngineDefaultScope["type"]
  return {
    scope:
      type === "global"
        ? { type: "global", id: null }
        : { type: "project", id: String(row.scope_id) },
    engine: String(row.engine) as CoordinationEngine,
    version: Number(row.version),
    createdAt: epochMilliseconds(row.created_at),
    updatedAt: epochMilliseconds(row.updated_at),
  }
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message)
}

function epochMilliseconds(value: unknown): number {
  const numeric = Number(value)
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
}
