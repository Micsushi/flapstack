import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { createAgentActivityStore } from "../agent-runtime/activity-store"
import { migrateDatabase } from "../db/migrate"
import { createPortableDatabase } from "../portability/database"
import { portableScopeRegistry } from "../portability/scope-registry"
import {
  assertPerformanceSupportRequest,
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBudget,
  type PerformanceSampleSet,
} from "./budgets"
import {
  collectChatGroups,
  createChatWorkbenchLayout,
  reduceChatWorkbench,
} from "../../../shared/chat-workbench"
import { STAGE6_REQUIRED_PRODUCT_SEAMS } from "./requirements"
import { observedCandidateRepositoryRoot, type CandidateBinding } from "./candidate"
import { sha256Bytes } from "./canonical"
import { canonicalJson } from "./canonical"
import { conditionsForBudget, type PerformanceConditions } from "./conditions"
import type { PerformanceMeasurementAdapter } from "./runner"
import { REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS } from "./workflows"
import { STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS } from "./requirements"
import { observeLiveElectronSamples } from "./electron-live-adapter"
import type { ElectronPerformanceBuildIdentity } from "./electron-control"
import {
  exerciseProductShutdown,
  observeProductAgentCapacity,
  observeProductTerminalCapacity,
  runBoundedProductControlCycle,
  runProductAgentLifecycle,
  runProductTerminalLifecycle,
} from "./product-controls"

export interface ProductPerformanceAdapterOptions {
  allowTestCandidate?: boolean
  testRecordLimit?: number
  testStreamEventLimit?: number
  testSoakIterations?: number
  testMigrationsFolder?: string
}

export interface RuntimeResourceSnapshot {
  total: number
  filesystem: number
  listeners: number
  watchers: number
  sockets: number
  processes: number
  timers: number
}

interface FixturePlan {
  seed: number
  cardinality: Record<string, number>
}

interface ObservationContext {
  budget: PerformanceBudget
  candidate: CandidateBinding
  rootPath: string
  migrationsFolder: string
  fixture: FixturePlan
  fixtureSha256: string
  recordLimit: number
  streamEventLimit: number
  soakIterations: number
}

const IMPLEMENTED_METRICS = new Set<PerformanceBudget["metric"]>(
  Object.keys(STAGE6_REQUIRED_PRODUCT_SEAMS) as PerformanceBudget["metric"][],
)
const BUILT_IN_REPOSITORY_ROOT = resolve(process.cwd())
const builtInProductAdapters = new WeakMap<
  PerformanceMeasurementAdapter,
  ReadonlyMap<PerformanceBudget["metric"], string>
>()
const builtInMeasurements = new WeakMap<
  object,
  {
    adapter: PerformanceMeasurementAdapter
    metric: PerformanceBudget["metric"]
    adapterId: string
    productionSeam: string
    candidateBindingSha256: string
    fixtureSha256: string
    measurementSha256: string
  }
>()
const builtInCapabilities = new WeakMap<
  object,
  {
    budgetId: string
    adapterId: string
    productionSeam: string
    candidateBindingSha256: string
    fixtureSha256: string
    measurementSha256: string
  }
>()

export type BuiltInMeasurementCapability = object & {
  readonly __builtInMeasurementCapability?: never
}

export function createProductPerformanceAdapters(
  options: ProductPerformanceAdapterOptions = {},
): PerformanceMeasurementAdapter[] {
  if ("repositoryRoot" in options) {
    throw new Error(
      "A caller-selected repository root is not accepted by the built-in product adapter.",
    )
  }
  const adapter: PerformanceMeasurementAdapter = Object.freeze({
    id: "stage6-windows-product-seams",
    supports: (budget: PerformanceBudget, candidate: CandidateBinding) =>
      supportReason(budget, candidate, options),
    measure: async ({
      budget,
      candidate,
      fixtureBytes,
      fixtureSha256,
    }: Parameters<PerformanceMeasurementAdapter["measure"]>[0]) => {
      if (sha256Bytes(fixtureBytes) !== fixtureSha256) {
        throw new Error("Product adapter fixture bytes do not match the authoritative digest.")
      }
      const support = supportReason(budget, candidate, options)
      if (!support.supported) throw new Error(support.reason)
      const fixture = parseFixturePlan(fixtureBytes)
      const rootPath = mkdtempSync(join(tmpdir(), "flapstack-performance-"))
      const removeRoot = () =>
        rmSync(rootPath, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50,
        })
      let measurement: Awaited<ReturnType<PerformanceMeasurementAdapter["measure"]>>
      try {
        const context: ObservationContext = {
          budget,
          candidate,
          rootPath,
          fixture,
          fixtureSha256,
          migrationsFolder:
            candidate.authority === "test-fixture" && options.testMigrationsFolder
              ? resolve(options.testMigrationsFolder)
              : resolve(BUILT_IN_REPOSITORY_ROOT, "drizzle"),
          recordLimit: boundedFixtureCount(candidate, fixture, options),
          streamEventLimit: boundedStreamCount(candidate, fixture, options),
          soakIterations:
            candidate.authority === "test-fixture"
              ? Math.max(1, Math.min(options.testSoakIterations ?? 5, 25))
              : 100,
        }
        const samples: PerformanceSampleSet = {
          warmupSamples: await observeSamples(budget.minimumWarmups, 0, context),
          measuredSamples: await observeSamples(
            budget.minimumRepeats,
            budget.minimumWarmups,
            context,
          ),
        }
        measurement = {
          fixtureSha256,
          conditions: conditionsForBudget(budget, candidate),
          samples,
        }
        const productionSeam =
          STAGE6_REQUIRED_PRODUCT_SEAMS[budget.metric as keyof typeof STAGE6_REQUIRED_PRODUCT_SEAMS]
        if (!productionSeam) {
          throw new Error(`No fixed production seam exists for ${budget.metric}.`)
        }
        builtInMeasurements.set(measurement, {
          adapter,
          metric: budget.metric,
          adapterId: adapter.id,
          productionSeam,
          candidateBindingSha256: candidate.binding.digest,
          fixtureSha256,
          measurementSha256: measurementDigest(measurement),
        })
      } catch (error) {
        try {
          removeRoot()
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Performance measurement and temporary root cleanup both failed for ${budget.metric}.`,
          )
        }
        throw error
      }
      removeRoot()
      return measurement
    },
  })
  builtInProductAdapters.set(
    adapter,
    new Map(
      Object.entries(STAGE6_REQUIRED_PRODUCT_SEAMS) as Array<[PerformanceBudget["metric"], string]>,
    ),
  )
  const electronAdapter: PerformanceMeasurementAdapter = Object.freeze({
    id: "stage6-electron-test-control",
    supports: (budget: PerformanceBudget, candidate: CandidateBinding) =>
      electronSupportReason(budget, candidate, options),
    measure: async ({
      budget,
      candidate,
      fixtureBytes,
      fixtureSha256,
    }: Parameters<PerformanceMeasurementAdapter["measure"]>[0]) => {
      if (sha256Bytes(fixtureBytes) !== fixtureSha256) {
        throw new Error("Electron adapter fixture bytes do not match the authoritative digest.")
      }
      const support = electronSupportReason(budget, candidate, options)
      if (!support.supported) throw new Error(support.reason)
      const observed = await observeLiveElectronSamples({
        budget,
        candidate,
        repositoryRoot: BUILT_IN_REPOSITORY_ROOT,
      })
      const measurement = {
        fixtureSha256,
        conditions: conditionsForBudget(budget, candidate),
        samples: observed.samples,
        runtimeBuildIdentity: observed.buildIdentity,
        runtimeBuildIdentities: observed.buildIdentities,
        runtimeRendererProcessIds: observed.sampleRendererProcessIds,
      }
      const productionSeam =
        STAGE6_REQUIRED_PRODUCT_SEAMS[budget.metric as keyof typeof STAGE6_REQUIRED_PRODUCT_SEAMS]
      if (!productionSeam) throw new Error(`No Electron seam exists for ${budget.metric}.`)
      builtInMeasurements.set(measurement, {
        adapter: electronAdapter,
        metric: budget.metric,
        adapterId: electronAdapter.id,
        productionSeam,
        candidateBindingSha256: candidate.binding.digest,
        fixtureSha256,
        measurementSha256: measurementDigest(measurement),
      })
      return measurement
    },
  })
  builtInProductAdapters.set(
    electronAdapter,
    new Map(
      STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.map((metric) => [
        metric,
        STAGE6_REQUIRED_PRODUCT_SEAMS[metric],
      ]),
    ),
  )
  return [adapter, electronAdapter]
}

export function issueBuiltInMeasurementCapability(input: {
  adapter: PerformanceMeasurementAdapter
  budget: PerformanceBudget
  candidate: CandidateBinding
  fixtureSha256: string
  measurement: {
    fixtureSha256: string
    conditions: PerformanceConditions
    samples: PerformanceSampleSet
    runtimeBuildIdentity?: ElectronPerformanceBuildIdentity
    runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[]
    runtimeRendererProcessIds?: number[]
  }
}): BuiltInMeasurementCapability {
  const registered = builtInMeasurements.get(input.measurement)
  if (
    !registered ||
    registered.adapter !== input.adapter ||
    registered.metric !== input.budget.metric ||
    registered.candidateBindingSha256 !== input.candidate.binding.digest ||
    registered.fixtureSha256 !== input.fixtureSha256 ||
    registered.measurementSha256 !== measurementDigest(input.measurement)
  ) {
    throw new Error("Built-in provenance requires the exact registered measurement result.")
  }
  builtInMeasurements.delete(input.measurement)
  const capability = Object.freeze({}) as BuiltInMeasurementCapability
  builtInCapabilities.set(capability, {
    budgetId: input.budget.id,
    adapterId: registered.adapterId,
    productionSeam: registered.productionSeam,
    candidateBindingSha256: registered.candidateBindingSha256,
    fixtureSha256: registered.fixtureSha256,
    measurementSha256: registered.measurementSha256,
  })
  return capability
}

export function consumeBuiltInMeasurementCapability(input: {
  capability: BuiltInMeasurementCapability
  budget: PerformanceBudget
  candidate: CandidateBinding
  fixtureSha256: string
  conditions: PerformanceConditions
  samples: PerformanceSampleSet
  runtimeBuildIdentity?: ElectronPerformanceBuildIdentity
  runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[]
  runtimeRendererProcessIds?: number[]
}): { adapterId: string; productionSeam: string } {
  const registered = builtInCapabilities.get(input.capability)
  if (!registered) {
    throw new Error("Built-in product provenance requires an opaque process capability.")
  }
  builtInCapabilities.delete(input.capability)
  if (
    registered.budgetId !== input.budget.id ||
    registered.candidateBindingSha256 !== input.candidate.binding.digest ||
    registered.fixtureSha256 !== input.fixtureSha256 ||
    registered.measurementSha256 !==
      measurementDigest({
        fixtureSha256: input.fixtureSha256,
        conditions: input.conditions,
        samples: input.samples,
        runtimeBuildIdentity: input.runtimeBuildIdentity,
        runtimeBuildIdentities: input.runtimeBuildIdentities,
        runtimeRendererProcessIds: input.runtimeRendererProcessIds,
      })
  ) {
    throw new Error("Built-in product provenance capability does not match the report result.")
  }
  return {
    adapterId: registered.adapterId,
    productionSeam: registered.productionSeam,
  }
}

function measurementDigest(input: {
  fixtureSha256: string
  conditions: PerformanceConditions
  samples: PerformanceSampleSet
  runtimeBuildIdentity?: ElectronPerformanceBuildIdentity
  runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[]
  runtimeRendererProcessIds?: number[]
}): string {
  return sha256Bytes(
    canonicalJson({
      fixtureSha256: input.fixtureSha256,
      conditions: input.conditions,
      samples: input.samples,
      runtimeBuildIdentity: input.runtimeBuildIdentity,
      runtimeBuildIdentities: input.runtimeBuildIdentities,
      runtimeRendererProcessIds: input.runtimeRendererProcessIds,
    }),
  )
}

export function builtInProductionSeamFor(
  adapter: PerformanceMeasurementAdapter,
  metric: PerformanceBudget["metric"],
): string | undefined {
  return builtInProductAdapters.get(adapter)?.get(metric)
}

export function isBuiltInProductPerformanceAdapter(
  adapter: PerformanceMeasurementAdapter,
): boolean {
  return builtInProductAdapters.has(adapter)
}

export function builtInProductRepositoryRoot(): string {
  return BUILT_IN_REPOSITORY_ROOT
}

export function validateProductPerformanceAdapterCoverage(
  adapters: PerformanceMeasurementAdapter[],
  candidate: CandidateBinding,
): string[] {
  const errors: string[] = []
  for (const metric of Object.keys(
    STAGE6_REQUIRED_PRODUCT_SEAMS,
  ) as PerformanceBudget["metric"][]) {
    const budget = performanceBudgetFor(candidate, metric)
    const registeredForTestCandidate =
      candidate.authority === "test-fixture" &&
      STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(metric as never) &&
      adapters.some((adapter) => builtInProductionSeamFor(adapter, metric))
    if (
      !budget ||
      (!registeredForTestCandidate &&
        !adapters.some((adapter) => adapter.supports(budget, candidate).supported))
    ) {
      errors.push(`${metric} has no required production-seam adapter`)
    }
  }
  for (const workflow of REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS.filter(
    (entry) => entry.availability === "unavailable",
  )) {
    const budget = performanceBudgetFor(candidate, workflow.metric)
    if (budget && adapters.some((adapter) => adapter.supports(budget, candidate).supported)) {
      errors.push(`${workflow.metric} must remain unavailable without product evidence`)
    }
  }
  return errors
}

async function observeSamples(
  count: number,
  offset: number,
  context: ObservationContext,
): Promise<number[]> {
  const samples: number[] = []
  for (let index = 0; index < count; index += 1) {
    samples.push(await observeProductionSeam(context, offset + index))
  }
  return samples
}

async function observeProductionSeam(
  context: ObservationContext,
  sampleIndex: number,
): Promise<number> {
  switch (context.budget.metric) {
    case "database-open":
      return observeDatabaseOpen(context, sampleIndex)
    case "migration-upgrade":
    case "migration-duration":
      return observePriorReleaseMigration(context, sampleIndex)
    case "recovery-reopen":
    case "recovery-duration":
      return observeWalRecovery(context, sampleIndex)
    case "scoped-query":
      return observeActivityQuery(context, sampleIndex)
    case "database-search":
      return observeDatabaseSearch(context, sampleIndex)
    case "concurrent-read-write-lock":
      return observeConcurrentReaderWriter(context, sampleIndex)
    case "wal-checkpoint":
      return observeWalCheckpoint(context, sampleIndex)
    case "backup-duration":
      return observePortableBackup(context, sampleIndex)
    case "maintenance-duration":
      return observeMaintenance(context, sampleIndex)
    case "integrity-check":
      return observeIntegrityCheck(context, sampleIndex)
    case "restart-recovery":
      return observeRestartRecovery(context, sampleIndex)
    case "stream-throughput":
    case "stream-event-latency":
    case "ordered-event-loss":
    case "output-flood-loss":
    case "output-flood-backlog":
      return observeActivityStream(context, sampleIndex)
    case "steady-state-cpu":
    case "steady-state-memory":
    case "file-descriptor-delta":
    case "listener-delta":
    case "watcher-delta":
    case "socket-delta":
    case "deterministic-soak-memory-growth":
    case "deterministic-soak-resource-delta":
    case "harness-overhead":
    case "process-delta":
    case "timer-delta":
      return observeRuntimeResource(context, sampleIndex)
    case "agent-start-latency":
    case "terminal-start-latency":
    case "cancel-latency":
    case "cleanup-process-delta":
      return observeChildLifecycle(context, sampleIndex)
    case "concurrent-agent-capacity":
    case "concurrent-terminal-capacity":
    case "visible-grid-pane-capacity":
      return observeSupportedCapacity(context)
    default:
      throw new Error(`No production seam is authorized for ${context.budget.metric}.`)
  }
}

function observeDatabaseOpen(context: ObservationContext, sampleIndex: number): number {
  const templatePath = join(context.rootPath, "open-current.sqlite")
  if (!fileExists(templatePath)) {
    prepareCurrentDatabase(templatePath, context.migrationsFolder)
    withOpenedDatabase(templatePath, (database) => {
      seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
      database.pragma("wal_checkpoint(TRUNCATE)")
    })
  }
  const path = join(context.rootPath, `open-${sampleIndex}.sqlite`)
  copyFileSync(templatePath, path)
  const startedAt = performance.now()
  const database = new Database(path)
  try {
    database.pragma("journal_mode = WAL")
    migrateDatabase(drizzle(database), database, context.migrationsFolder)
    const elapsed = performance.now() - startedAt
    if (database.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("Opened database failed integrity verification.")
    }
    return elapsed
  } finally {
    database.close()
    rmSqliteFamily(path)
  }
}

function observeWalRecovery(context: ObservationContext, sampleIndex: number): number {
  const path = join(context.rootPath, `recovery-${sampleIndex}.sqlite`)
  prepareCurrentDatabase(path, context.migrationsFolder)
  withOpenedDatabase(path, (database) => {
    database.pragma("journal_mode = WAL")
    database
      .prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)")
      .run(`recovery-${sampleIndex}`, "Recovery", `C:/recovery-${sampleIndex}`)
  })
  const startedAt = performance.now()
  try {
    return withOpenedDatabase(path, (database) => {
      database.pragma("journal_mode = WAL")
      const row = database
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get(`recovery-${sampleIndex}`) as { id?: unknown } | undefined
      if (row?.id !== `recovery-${sampleIndex}`) {
        throw new Error("WAL recovery did not preserve committed product state.")
      }
      return performance.now() - startedAt
    })
  } finally {
    rmSqliteFamily(path)
  }
}

function observeDatabaseSearch(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
    const needle = `deterministic fixture ${context.fixture.seed}-`
    const expectedGroups = databaseSearchResultLimit(context.recordLimit)
    const startedAt = performance.now()
    const rows = database
      .prepare(
        `SELECT id FROM sub_chats
         WHERE messages LIKE ? ESCAPE '\\'
         ORDER BY id LIMIT ?`,
      )
      .all(`%${needle}%`, expectedGroups)
    const elapsed = performance.now() - startedAt
    if (rows.length !== expectedGroups) {
      throw new Error("Database history search returned incomplete fixture groups.")
    }
    return elapsed
  })
}

function observeConcurrentReaderWriter(context: ObservationContext, sampleIndex: number): number {
  const path = join(context.rootPath, `reader-writer-${sampleIndex}.sqlite`)
  prepareCurrentDatabase(path, context.migrationsFolder)
  const writer = new Database(path)
  const reader = new Database(path, { readonly: true })
  try {
    writer.pragma("journal_mode = WAL")
    writer.pragma("busy_timeout = 1000")
    reader.pragma("busy_timeout = 1000")
    const startedAt = performance.now()
    writer.transaction(() => {
      writer
        .prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)")
        .run(`rw-${sampleIndex}`, "Reader writer", `C:/reader-writer-${sampleIndex}`)
    })()
    const observed = reader
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(`rw-${sampleIndex}`) as { id?: unknown } | undefined
    if (observed?.id !== `rw-${sampleIndex}`) {
      throw new Error("Concurrent reader did not observe the committed writer row.")
    }
    return performance.now() - startedAt
  } finally {
    reader.close()
    writer.close()
    rmSqliteFamily(path)
  }
}

function observeWalCheckpoint(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
    const startedAt = performance.now()
    const checkpoint = database.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy?: number
      log?: number
      checkpointed?: number
    }>
    const elapsed = performance.now() - startedAt
    if (checkpoint.some((row) => Number(row.busy ?? 0) !== 0)) {
      throw new Error("WAL checkpoint remained busy.")
    }
    return elapsed
  })
}

function observeMaintenance(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
    const startedAt = performance.now()
    database.pragma("optimize")
    return performance.now() - startedAt
  })
}

function observeIntegrityCheck(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
    const startedAt = performance.now()
    const result = database.pragma("integrity_check", { simple: true })
    const elapsed = performance.now() - startedAt
    if (result !== "ok") throw new Error("Product database integrity check failed.")
    return elapsed
  })
}

function observeRestartRecovery(context: ObservationContext, sampleIndex: number): number {
  const path = join(context.rootPath, `restart-${sampleIndex}.sqlite`)
  prepareCurrentDatabase(path, context.migrationsFolder)
  withOpenedDatabase(path, (database) => {
    seedCoreProductRows(database, context.fixture.seed + sampleIndex)
    database.pragma("wal_checkpoint(TRUNCATE)")
  })
  const startedAt = performance.now()
  try {
    return withOpenedDatabase(path, (database) => {
      migrateDatabase(drizzle(database), database, context.migrationsFolder)
      if (database.pragma("integrity_check", { simple: true }) !== "ok") {
        throw new Error("Restarted product database failed recovery.")
      }
      return performance.now() - startedAt
    })
  } finally {
    rmSqliteFamily(path)
  }
}

function observePriorReleaseMigration(context: ObservationContext, sampleIndex: number): number {
  const priorTemplate = join(context.rootPath, "prior-release.sqlite")
  if (!fileExists(priorTemplate)) {
    const priorMigrations = createPriorMigrationFolder(context.rootPath, context.migrationsFolder)
    withOpenedDatabase(priorTemplate, (database) => {
      database.pragma("journal_mode = WAL")
      database.pragma("foreign_keys = ON")
      migrateDatabase(drizzle(database), database, priorMigrations)
      seedCoreProductRows(database, context.fixture.seed)
      database.pragma("wal_checkpoint(TRUNCATE)")
    })
  }
  const samplePath = join(context.rootPath, `migration-${sampleIndex}.sqlite`)
  copyFileSync(priorTemplate, samplePath)
  try {
    return withOpenedDatabase(samplePath, (database) => {
      database.pragma("foreign_keys = ON")
      const startedAt = performance.now()
      migrateDatabase(drizzle(database), database, context.migrationsFolder)
      const elapsed = performance.now() - startedAt
      proveMigratedDatabaseComplete(database, context.migrationsFolder)
      return elapsed
    })
  } finally {
    rmSqliteFamily(samplePath)
  }
}

function observeActivityQuery(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    const runId = `query-run-${sampleIndex}`
    seedRuntimeRun(database, runId)
    const store = createAgentActivityStore(database, {
      createEventId: eventIdFactory(`query-${sampleIndex}`),
    })
    appendActivityFixture(store, runId, context.recordLimit)
    const startedAt = performance.now()
    for (let observation = 0; observation < SCOPED_QUERY_OBSERVATIONS; observation += 1) {
      const page = store.query({ runId, limit: Math.min(500, context.recordLimit) })
      if (page.events.length !== Math.min(500, context.recordLimit)) {
        throw new Error("AgentActivityStore scoped query returned incomplete fixture data.")
      }
    }
    return (performance.now() - startedAt) / SCOPED_QUERY_OBSERVATIONS
  })
}

function observeActivityStream(context: ObservationContext, sampleIndex: number): number {
  return withCurrentSampleDatabase(context, sampleIndex, (database) => {
    const runId = `stream-run-${sampleIndex}`
    seedRuntimeRun(database, runId)
    const store = createAgentActivityStore(database, {
      createEventId: eventIdFactory(`stream-${sampleIndex}`),
    })
    let maximumDurabilityLatency = 0
    const startedAt = performance.now()
    const batchSize = activityStreamBatchSize(context.budget.metric)
    for (let offset = 0; offset < context.streamEventLimit; offset += batchSize) {
      const batch = activityBatch(offset, Math.min(batchSize, context.streamEventLimit - offset))
      const batchStartedAt = performance.now()
      store.appendBatch(runId, batch)
      maximumDurabilityLatency = Math.max(
        maximumDurabilityLatency,
        durableAppendLatency(batchStartedAt, performance.now()),
      )
    }
    const appendMilliseconds = Math.max(Number.EPSILON, performance.now() - startedAt)
    const replay = replayAllActivity(store, runId, context.streamEventLimit)
    const lost = context.streamEventLimit - replay.length
    if (replay.some((event, index) => event.sequence !== index + 1)) {
      throw new Error("AgentActivityStore replay lost persisted event ordering.")
    }
    switch (context.budget.metric) {
      case "stream-throughput":
        return context.streamEventLimit / (appendMilliseconds / 1_000)
      case "stream-event-latency":
        return maximumDurabilityLatency
      case "ordered-event-loss":
      case "output-flood-loss":
        return lost
      case "output-flood-backlog":
        return Math.max(0, context.streamEventLimit - replay.length)
      default:
        throw new Error("Unexpected activity stream metric.")
    }
  })
}

const SCOPED_QUERY_OBSERVATIONS = 25

export function databaseSearchResultLimit(recordLimit: number): number {
  if (!Number.isSafeInteger(recordLimit) || recordLimit < 1) {
    throw new Error("Database search result limit requires a positive record count.")
  }
  return Math.ceil(recordLimit / 100)
}

export function activityStreamBatchSize(metric: PerformanceBudget["metric"]): number {
  return metric === "stream-event-latency" ? 250 : 1_000
}

async function observeRuntimeResource(
  context: ObservationContext,
  sampleIndex: number,
): Promise<number> {
  const metric = context.budget.metric
  if (metric === "harness-overhead") {
    return measureMonotonicClockHarnessOverhead()
  }
  if (metric === "steady-state-memory") {
    await runBoundedProductWork(context, sampleIndex, 1)
    return process.memoryUsage().rss
  }
  if (metric === "steady-state-cpu") {
    return measureSteadyStateCpu({
      prepare: () =>
        runBoundedProductControlCycle({
          rootPath: context.rootPath,
          id: `steady-cpu-${sampleIndex}`,
          includeTerminal: true,
        }),
    })
  }
  if (metric === "deterministic-soak-memory-growth") {
    const before = process.memoryUsage().rss
    await runBoundedProductWork(context, sampleIndex, context.soakIterations)
    return Math.max(0, process.memoryUsage().rss - before)
  }
  if (metric === "process-delta") {
    return (await exerciseShutdownSeam(context)).survivingTerminalProcesses
  }

  const resourceBefore = resourceSnapshot()
  if (metric === "deterministic-soak-resource-delta") {
    await runBoundedProductWork(context, sampleIndex, context.soakIterations)
  } else {
    await exerciseShutdownSeam(context)
  }
  const resourceAfter = await waitForResourceSettlement(resourceBefore)
  switch (metric) {
    case "file-descriptor-delta":
      return positiveDelta(resourceAfter.filesystem, resourceBefore.filesystem)
    case "listener-delta":
      return positiveDelta(resourceAfter.listeners, resourceBefore.listeners)
    case "watcher-delta":
      return positiveDelta(resourceAfter.watchers, resourceBefore.watchers)
    case "socket-delta":
      return positiveDelta(resourceAfter.sockets, resourceBefore.sockets)
    case "timer-delta":
      return positiveDelta(resourceAfter.timers, resourceBefore.timers)
    case "deterministic-soak-resource-delta":
      return positiveDelta(resourceAfter.total, resourceBefore.total)
    default:
      throw new Error(`Unexpected runtime resource metric ${metric}.`)
  }
}

export async function measureSteadyStateCpu(options: {
  prepare: () => Promise<void>
  observationWindowMs?: number
  cpuUsage?: (previousValue?: NodeJS.CpuUsage) => NodeJS.CpuUsage
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}): Promise<number> {
  const observationWindowMs = options.observationWindowMs ?? 1_000
  const cpuUsage = options.cpuUsage ?? process.cpuUsage
  const now = options.now ?? performance.now.bind(performance)
  const wait = options.wait ?? delay
  await options.prepare()
  const cpuBefore = cpuUsage()
  const startedAt = now()
  await wait(observationWindowMs)
  const elapsedMicros = Math.max(1, (now() - startedAt) * 1_000)
  const cpu = cpuUsage(cpuBefore)
  return ((cpu.user + cpu.system) / elapsedMicros) * 100
}

export async function waitForResourceSettlement(
  baseline: RuntimeResourceSnapshot,
  options?: {
    maximumAttempts?: number
    snapshot?: () => RuntimeResourceSnapshot
    wait?: (milliseconds: number) => Promise<void>
  },
): Promise<RuntimeResourceSnapshot> {
  // Windows PTY worker resources can release more than 500 ms after their process exits.
  const maximumAttempts = options?.maximumAttempts ?? 60
  const snapshot = options?.snapshot ?? resourceSnapshot
  const wait = options?.wait ?? delay
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Resource settlement requires at least one bounded observation.")
  }
  let observed = snapshot()
  for (
    let attempt = 1;
    attempt < maximumAttempts && hasPositiveResourceDelta(observed, baseline);
    attempt += 1
  ) {
    await wait(25)
    observed = snapshot()
  }
  return observed
}

function hasPositiveResourceDelta(
  observed: RuntimeResourceSnapshot,
  baseline: RuntimeResourceSnapshot,
): boolean {
  return (Object.keys(baseline) as (keyof RuntimeResourceSnapshot)[]).some(
    (key) => observed[key] > baseline[key],
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveReady) => setTimeout(resolveReady, milliseconds))
}

export function measureMonotonicClockHarnessOverhead(options?: {
  now?: () => number
  batchCount?: number
  callsPerBatch?: number
}): number {
  const now = options?.now ?? performance.now.bind(performance)
  const batchCount = options?.batchCount ?? 11
  const callsPerBatch = options?.callsPerBatch ?? 10_000
  if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount % 2 === 0) {
    throw new Error("Harness-overhead measurement requires a positive odd batch count.")
  }
  if (!Number.isInteger(callsPerBatch) || callsPerBatch < 1) {
    throw new Error("Harness-overhead measurement requires at least one clock call per batch.")
  }
  const durations: number[] = []
  for (let batch = 0; batch < batchCount; batch += 1) {
    const startedAt = now()
    for (let call = 0; call < callsPerBatch; call += 1) now()
    durations.push(Math.max(0, now() - startedAt))
  }
  durations.sort((left, right) => left - right)
  return durations[Math.floor(durations.length / 2)]!
}

async function runBoundedProductWork(
  context: ObservationContext,
  sampleIndex: number,
  iterations: number,
): Promise<void> {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    await Promise.resolve()
    const path = join(context.rootPath, `soak-${sampleIndex}-${iteration}.sqlite`)
    prepareCurrentDatabase(path, context.migrationsFolder)
    withOpenedDatabase(path, (database) => {
      seedRuntimeRun(database, `soak-run-${sampleIndex}-${iteration}`)
      const store = createAgentActivityStore(database, {
        createEventId: eventIdFactory(`soak-${sampleIndex}-${iteration}`),
      })
      appendActivityFixture(
        store,
        `soak-run-${sampleIndex}-${iteration}`,
        Math.min(context.streamEventLimit, 32),
      )
      if (store.replayRun(`soak-run-${sampleIndex}-${iteration}`).length === 0) {
        throw new Error("Bounded product soak failed to replay persisted activity.")
      }
    })
    rmSqliteFamily(path)
  }
  const controlCycles = Math.min(iterations, 3)
  for (let cycle = 0; cycle < controlCycles; cycle += 1) {
    await runBoundedProductControlCycle({
      rootPath: context.rootPath,
      id: `${sampleIndex}-${cycle}`,
      includeTerminal: true,
    })
  }
}

async function exerciseShutdownSeam(
  context: ObservationContext,
): ReturnType<typeof exerciseProductShutdown> {
  const result = await exerciseProductShutdown(context.rootPath)
  await new Promise<void>((resolveReady) => setImmediate(resolveReady))
  return result
}

async function observeChildLifecycle(
  context: ObservationContext,
  sampleIndex: number,
): Promise<number> {
  if (context.budget.metric === "cleanup-process-delta") {
    return (await exerciseProductShutdown(context.rootPath)).survivingTerminalProcesses
  }
  if (context.budget.metric === "cancel-latency") {
    const result = await runProductAgentLifecycle({ cancel: true })
    return result.cancelMilliseconds ?? Number.POSITIVE_INFINITY
  }
  if (context.budget.metric === "terminal-start-latency") {
    return (
      await runProductTerminalLifecycle({
        rootPath: context.rootPath,
        id: `start-${sampleIndex}`,
      })
    ).readyMilliseconds
  }
  return (await runProductAgentLifecycle({ cancel: false })).readyMilliseconds
}

async function observeSupportedCapacity(context: ObservationContext): Promise<number> {
  const limits = STAGE6_PERFORMANCE_BUDGETS.supportLimits
  if (context.budget.metric === "concurrent-agent-capacity") {
    assertPerformanceSupportRequest({ agents: limits.maxConcurrentAgents })
    try {
      assertPerformanceSupportRequest({ agents: limits.maxConcurrentAgents + 1 })
      throw new Error("Agent support limit did not reject excess work.")
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("supported limit")) throw error
    }
    const observed = await observeProductAgentCapacity(limits.maxConcurrentAgents)
    if (observed !== limits.maxConcurrentAgents) {
      throw new Error(`Product Runtime owned ${observed} of ${limits.maxConcurrentAgents} agents.`)
    }
    return observed
  }
  if (context.budget.metric === "concurrent-terminal-capacity") {
    assertPerformanceSupportRequest({ terminals: limits.maxConcurrentTerminals })
    try {
      assertPerformanceSupportRequest({ terminals: limits.maxConcurrentTerminals + 1 })
      throw new Error("Terminal support limit did not reject excess work.")
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("supported limit")) throw error
    }
    const observed = await observeProductTerminalCapacity({
      limit: limits.maxConcurrentTerminals,
      rootPath: context.rootPath,
      id: "supported",
    })
    if (observed !== limits.maxConcurrentTerminals) {
      throw new Error(
        `Product TerminalManager owned ${observed} of ${limits.maxConcurrentTerminals} PTYs.`,
      )
    }
    return observed
  }
  const initial = createChatWorkbenchLayout(
    Array.from({ length: limits.maxVisibleChatPanes }, (_, index) => `chat-${index}`),
  )
  const result = reduceChatWorkbench(initial, { type: "apply-preset", preset: "grid-2x2" })
  if (!result.accepted) throw new Error("Production grid layout rejected its supported preset.")
  const layout = result.layout
  const visible = collectChatGroups(layout.root).length
  assertPerformanceSupportRequest({ visibleChatPanes: visible })
  try {
    assertPerformanceSupportRequest({ visibleChatPanes: visible + 1 })
    throw new Error("Visible pane support limit did not reject excess work.")
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("supported limit")) throw error
  }
  return visible
}

function resourceSnapshot(): RuntimeResourceSnapshot {
  const resources = process.getActiveResourcesInfo()
  const listeners = process
    .eventNames()
    .reduce((total, eventName) => total + process.listenerCount(eventName), 0)
  return classifyRuntimeResources(resources, listeners)
}

export function classifyRuntimeResources(
  resources: readonly string[],
  listeners: number,
): RuntimeResourceSnapshot {
  const count = (pattern: RegExp) => resources.filter((resource) => pattern.test(resource)).length
  const nonProcessResources = resources.filter(
    (resource) => !/ChildProcess|Process/i.test(resource),
  )
  const filesystem = count(/FSReq|FileHandle/i)
  const watchers = count(/Watcher/i)
  const sockets = count(/TCP|UDP/i)
  const processes = count(/ChildProcess|Process/i)
  const timers = count(/Timeout|Immediate|Timer/i)
  return {
    total: nonProcessResources.length + listeners,
    filesystem,
    listeners,
    watchers,
    sockets,
    processes,
    timers,
  }
}

function positiveDelta(after: number, before: number): number {
  return Math.max(0, after - before)
}

async function observePortableBackup(
  context: ObservationContext,
  sampleIndex: number,
): Promise<number> {
  const sourcePath = join(context.rootPath, `backup-source-${sampleIndex}.sqlite`)
  const destinationPath = join(context.rootPath, `backup-output-${sampleIndex}.sqlite`)
  prepareCurrentDatabase(sourcePath, context.migrationsFolder)
  try {
    withOpenedDatabase(sourcePath, (database) => {
      seedHistoryFixture(database, context.recordLimit, context.fixture.seed)
      database.pragma("wal_checkpoint(TRUNCATE)")
    })
    const startedAt = performance.now()
    const result = await createPortableDatabase({
      sourcePath,
      destinationPath,
      scopes: portableScopeRegistry.resolveSelection([{ id: "projects" }, { id: "history" }]),
    })
    const elapsed = performance.now() - startedAt
    const expectedHistoryGroups = Math.ceil(context.recordLimit / 100)
    const expectedRecordCount = 1 + expectedHistoryGroups * 2
    if (result.recordCount !== expectedRecordCount) {
      throw new Error(
        `Production portability backup record count ${result.recordCount} did not match ${expectedRecordCount}.`,
      )
    }
    verifyPortableBackupContents(destinationPath, {
      expectedRecordCount,
      expectedHistoryGroups,
      expectedMessageCount: context.recordLimit,
      fixtureSeed: context.fixture.seed,
    })
    return elapsed
  } finally {
    rmSqliteFamily(sourcePath)
    rmSqliteFamily(destinationPath)
  }
}

function withCurrentSampleDatabase<T>(
  context: ObservationContext,
  sampleIndex: number,
  operation: (database: Database.Database) => T,
): T {
  const templatePath = join(context.rootPath, `current-${context.fixtureSha256}.sqlite`)
  if (!fileExists(templatePath)) {
    prepareCurrentDatabase(templatePath, context.migrationsFolder)
  }
  const samplePath = join(context.rootPath, `sample-${context.budget.metric}-${sampleIndex}.sqlite`)
  copyFileSync(templatePath, samplePath)
  try {
    return withOpenedDatabase(samplePath, operation)
  } finally {
    rmSqliteFamily(samplePath)
  }
}

function prepareCurrentDatabase(path: string, migrationsFolder: string): void {
  withOpenedDatabase(path, (database) => {
    database.pragma("journal_mode = WAL")
    database.pragma("foreign_keys = ON")
    migrateDatabase(drizzle(database), database, migrationsFolder)
    database.pragma("wal_checkpoint(TRUNCATE)")
  })
}

function withOpenedDatabase<T>(path: string, operation: (database: Database.Database) => T): T {
  let database: Database.Database | null = null
  try {
    database = new Database(path)
    return operation(database)
  } finally {
    database?.close()
  }
}

function createPriorMigrationFolder(rootPath: string, currentFolder: string): string {
  const journalPath = join(currentFolder, "meta", "_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ tag?: unknown }>
  }
  if (!Array.isArray(journal.entries) || journal.entries.length < 2) {
    throw new Error("Performance migration fixture requires at least two canonical migrations.")
  }
  const priorEntries = journal.entries.slice(0, -1)
  if (priorEntries.some((entry) => typeof entry.tag !== "string")) {
    throw new Error("Performance migration journal contains an invalid prior migration tag.")
  }
  const priorFolder = join(rootPath, "prior-migrations")
  mkdirSync(join(priorFolder, "meta"), { recursive: true })
  for (const entry of priorEntries) {
    copyFileSync(
      join(currentFolder, `${entry.tag as string}.sql`),
      join(priorFolder, `${entry.tag as string}.sql`),
    )
  }
  writeFileSync(
    join(priorFolder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: priorEntries }),
  )
  return priorFolder
}

function proveMigratedDatabaseComplete(
  database: Database.Database,
  migrationsFolder: string,
): void {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as {
    entries?: unknown[]
  }
  const recorded = database.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get() as {
    count: number
  }
  if (!journal.entries || recorded.count !== journal.entries.length) {
    throw new Error("Migrated database did not record the complete canonical migration chain.")
  }
  const project = database.prepare("SELECT id FROM projects WHERE id = 'performance-project'").get()
  if (!project) throw new Error("Migrated database lost prior-release product rows.")
  if (database.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("Migrated database failed its post-upgrade integrity check.")
  }
}

function seedCoreProductRows(database: Database.Database, seed: number): void {
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("performance-project", "Performance Project", `C:/flapstack-fixture-${seed}`)
}

function seedRuntimeRun(database: Database.Database, runId: string): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path) VALUES ('performance-project', 'Performance Project', 'C:/flapstack-performance')",
    )
    .run()
  database
    .prepare(
      `INSERT OR IGNORE INTO chats
       (id, name, project_id, permission_mode, harness, model, runtime_preference)
       VALUES ('performance-chat', 'Performance Chat', 'performance-project',
         'read-only', 'codex', 'gpt-test', 'codex')`,
    )
    .run()
  database
    .prepare(
      `INSERT OR IGNORE INTO sub_chats
       (id, name, chat_id, session_id, messages)
       VALUES ('performance-subchat', 'Performance', 'performance-chat', NULL, '[]')`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO agent_runs (
         id, chat_id, sub_chat_id, harness, model, permission_mode, status,
         runtime_snapshot_version, runtime_preference, runtime_preference_source,
         resolved_runtime, runtime_adapter_version, runtime_protocol_version,
         runtime_capability_snapshot, runtime_control_snapshot
       ) VALUES (?, 'performance-chat', 'performance-subchat', 'codex', 'gpt-test',
         'read-only', 'running', 1, 'codex', 'chat', 'codex',
         'performance-adapter', 'performance-protocol',
         '{"schemaVersion":1}', '{"schemaVersion":1}')`,
    )
    .run(runId)
}

function appendActivityFixture(
  store: ReturnType<typeof createAgentActivityStore>,
  runId: string,
  count: number,
): void {
  for (let offset = 0; offset < count; offset += 1_000) {
    store.appendBatch(runId, activityBatch(offset, Math.min(1_000, count - offset)))
  }
}

function activityBatch(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const sequence = offset + index
    return {
      kind: "status" as const,
      phase: "updated" as const,
      displayClass: "status" as const,
      privacyClass: "public" as const,
      provider: "performance-fixture",
      providerEventId: `provider-${sequence}`,
      payload: { message: `event-${sequence}` },
    }
  })
}

function replayAllActivity(
  store: ReturnType<typeof createAgentActivityStore>,
  runId: string,
  expectedCount: number,
) {
  const events = []
  let afterSequence = 0
  while (events.length < expectedCount) {
    const page = store.replayRun(
      runId,
      afterSequence,
      Math.min(10_000, expectedCount - events.length),
    )
    if (page.length === 0) break
    events.push(...page)
    afterSequence = page.at(-1)!.sequence
  }
  return events
}

function seedHistoryFixture(database: Database.Database, count: number, seed: number): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path) VALUES ('performance-project', 'Performance Project', ?)",
    )
    .run(`C:/flapstack-history-${seed}`)
  const insertChat = database.prepare(
    `INSERT INTO chats (id, name, project_id, permission_mode, harness, model, runtime_preference)
     VALUES (?, ?, 'performance-project', 'read-only', 'codex', 'gpt-test', 'codex')`,
  )
  const insertSubChat = database.prepare(
    `INSERT INTO sub_chats (id, name, chat_id, session_id, messages)
     VALUES (?, ?, ?, NULL, ?)`,
  )
  database.transaction(() => {
    for (let offset = 0; offset < count; offset += 100) {
      const chatId = `history-chat-${offset}`
      insertChat.run(chatId, `History ${offset}`)
      const messages = Array.from({ length: Math.min(100, count - offset) }, (_, index) => ({
        id: `message-${offset + index}`,
        role: "user",
        content: `deterministic fixture ${seed}-${offset + index}`,
      }))
      insertSubChat.run(
        `history-subchat-${offset}`,
        `History ${offset}`,
        chatId,
        JSON.stringify(messages),
      )
    }
  })()
}

function eventIdFactory(prefix: string): () => string {
  let next = 0
  return () => `${prefix}-event-${next++}`
}

function supportReason(
  budget: PerformanceBudget,
  candidate: CandidateBinding,
  options: ProductPerformanceAdapterOptions,
): { supported: true } | { supported: false; reason: string } {
  if (STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(budget.metric as never)) {
    return {
      supported: false,
      reason: "Electron renderer metrics require the authenticated live test-control adapter.",
    }
  }
  if (!IMPLEMENTED_METRICS.has(budget.metric)) {
    const workflow = REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS.find(
      (entry) => entry.metric === budget.metric,
    )
    return {
      supported: false,
      reason: workflow?.unavailableReason ?? "No production seam owns this performance metric.",
    }
  }
  if (candidate.buildType !== "dev") {
    return {
      supported: false,
      reason: "Package performance requires launching the exact captured package.",
    }
  }
  if (candidate.authority === "test-fixture" && !options.allowTestCandidate) {
    return { supported: false, reason: "Test candidates require explicit untrusted test mode." }
  }
  if (candidate.authority === "local-observed" && options.testMigrationsFolder) {
    return {
      supported: false,
      reason: "Local product evidence cannot override the repository migration authority.",
    }
  }
  if (
    candidate.authority === "local-observed" &&
    resolve(observedCandidateRepositoryRoot(candidate)) !== BUILT_IN_REPOSITORY_ROOT
  ) {
    return {
      supported: false,
      reason: "Local product evidence does not match the canonical process repository root.",
    }
  }
  return { supported: true }
}

function electronSupportReason(
  budget: PerformanceBudget,
  candidate: CandidateBinding,
  options: ProductPerformanceAdapterOptions,
): { supported: true } | { supported: false; reason: string } {
  if (!STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(budget.metric as never)) {
    return { supported: false, reason: "This adapter measures Electron renderer metrics only." }
  }
  if (candidate.buildType !== "dev") {
    return { supported: false, reason: "Live Electron core measurement requires a dev build." }
  }
  if (candidate.authority === "test-fixture") {
    return options.allowTestCandidate
      ? { supported: false, reason: "Test candidates do not own a live Electron process." }
      : { supported: false, reason: "Test candidates require explicit untrusted test mode." }
  }
  if (resolve(observedCandidateRepositoryRoot(candidate)) !== BUILT_IN_REPOSITORY_ROOT) {
    return { supported: false, reason: "Live Electron checkout does not match the candidate." }
  }
  return { supported: true }
}

export function durableAppendLatency(startedAt: number, committedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(committedAt) || committedAt < startedAt) {
    throw new Error("Append durability latency requires a monotonic clock interval.")
  }
  return committedAt - startedAt
}

export function verifyPortableBackupContents(
  destinationPath: string,
  expected: {
    expectedRecordCount: number
    expectedHistoryGroups: number
    expectedMessageCount: number
    fixtureSeed: number
  },
): void {
  withOpenedDatabase(destinationPath, (database) => {
    if (database.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("Portable backup destination failed its integrity check.")
    }
    const schemaVersion = database
      .prepare("SELECT value FROM portable_metadata WHERE key = 'schema_version'")
      .get() as { value?: unknown } | undefined
    if (schemaVersion?.value !== "1") {
      throw new Error("Portable backup destination has an invalid schema version.")
    }
    const records = database
      .prepare(
        "SELECT scope_id, table_name, identity_json, row_json FROM portable_records ORDER BY table_name, identity_json",
      )
      .all() as Array<{
      scope_id: string
      table_name: string
      identity_json: string
      row_json: string
    }>
    if (records.length !== expected.expectedRecordCount) {
      throw new Error(
        `Portable backup record count ${records.length} did not match ${expected.expectedRecordCount}.`,
      )
    }
    const projects = records.filter(
      (record) => record.scope_id === "projects" && record.table_name === "projects",
    )
    const chats = records.filter(
      (record) => record.scope_id === "history" && record.table_name === "chats",
    )
    const subChats = records.filter(
      (record) => record.scope_id === "history" && record.table_name === "sub_chats",
    )
    if (
      projects.length !== 1 ||
      chats.length !== expected.expectedHistoryGroups ||
      subChats.length !== expected.expectedHistoryGroups ||
      projects.length + chats.length + subChats.length !== records.length
    ) {
      throw new Error("Portable backup content is incomplete or contains unexpected records.")
    }
    const projectIdentity = JSON.parse(projects[0]!.identity_json) as { id?: unknown }
    const projectRow = JSON.parse(projects[0]!.row_json) as {
      id?: unknown
      name?: unknown
    }
    if (
      projectIdentity.id !== "performance-project" ||
      projectRow.id !== "performance-project" ||
      projectRow.name !== "Performance Project"
    ) {
      throw new Error("Portable backup project content does not match the fixture.")
    }
    let observedMessages = 0
    for (let group = 0; group < expected.expectedHistoryGroups; group += 1) {
      const offset = group * 100
      const chatId = `history-chat-${offset}`
      const chat = chats.find(
        (record) => (JSON.parse(record.identity_json) as { id?: unknown }).id === chatId,
      )
      const subChat = subChats.find(
        (record) =>
          (JSON.parse(record.identity_json) as { id?: unknown }).id === `history-subchat-${offset}`,
      )
      if (!chat || !subChat) {
        throw new Error("Portable backup history identities are incomplete.")
      }
      const chatRow = JSON.parse(chat.row_json) as {
        id?: unknown
        project_id?: unknown
      }
      const subChatRow = JSON.parse(subChat.row_json) as {
        id?: unknown
        chat_id?: unknown
        messages?: unknown
      }
      if (
        chatRow.id !== chatId ||
        chatRow.project_id !== "performance-project" ||
        subChatRow.id !== `history-subchat-${offset}` ||
        subChatRow.chat_id !== chatId ||
        typeof subChatRow.messages !== "string"
      ) {
        throw new Error("Portable backup history relations do not match the fixture.")
      }
      const messages = JSON.parse(subChatRow.messages) as Array<{
        id?: unknown
        role?: unknown
        content?: unknown
      }>
      const expectedInGroup = Math.min(100, expected.expectedMessageCount - offset)
      if (
        !Array.isArray(messages) ||
        messages.length !== expectedInGroup ||
        messages.some(
          (message, index) =>
            message.id !== `message-${offset + index}` ||
            message.role !== "user" ||
            message.content !== `deterministic fixture ${expected.fixtureSeed}-${offset + index}`,
        )
      ) {
        throw new Error("Portable backup message content does not match the fixture.")
      }
      observedMessages += messages.length
    }
    if (observedMessages !== expected.expectedMessageCount) {
      throw new Error("Portable backup message count is incomplete.")
    }
  })
}

function parseFixturePlan(bytes: Buffer): FixturePlan {
  const parsed = JSON.parse(bytes.toString("utf8")) as {
    seed?: unknown
    cardinality?: unknown
  }
  if (
    !Number.isSafeInteger(parsed.seed) ||
    typeof parsed.cardinality !== "object" ||
    parsed.cardinality === null
  ) {
    throw new Error("Product adapter fixture plan is invalid.")
  }
  const cardinality: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed.cardinality)) {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error("Product adapter fixture cardinality is invalid.")
    }
    cardinality[key] = value as number
  }
  return { seed: parsed.seed as number, cardinality }
}

function boundedFixtureCount(
  candidate: CandidateBinding,
  fixture: FixturePlan,
  options: ProductPerformanceAdapterOptions,
): number {
  const declared = Math.max(1, fixture.cardinality.messages ?? 1)
  if (candidate.authority !== "test-fixture") return declared
  return Math.max(1, Math.min(declared, options.testRecordLimit ?? 1_000))
}

function boundedStreamCount(
  candidate: CandidateBinding,
  fixture: FixturePlan,
  options: ProductPerformanceAdapterOptions,
): number {
  const declared = Math.max(1, fixture.cardinality.messages ?? 1)
  if (candidate.authority !== "test-fixture") return declared
  return Math.max(1, Math.min(declared, options.testStreamEventLimit ?? 10_000))
}

function performanceBudgetFor(
  candidate: CandidateBinding,
  metric: PerformanceBudget["metric"],
): PerformanceBudget | undefined {
  return STAGE6_PERFORMANCE_BUDGETS.budgets.find(
    (budget) =>
      budget.metric === metric &&
      budget.buildType === candidate.buildType &&
      budget.platforms.includes(candidate.platform) &&
      budget.hardwareClasses.includes(candidate.hardwareClass),
  )
}

function rmSqliteFamily(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

function fileExists(path: string): boolean {
  return existsSync(path)
}
