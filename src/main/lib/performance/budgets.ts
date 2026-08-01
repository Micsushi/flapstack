export const PERFORMANCE_SCENARIOS = [
  "startup",
  "renderer",
  "storage-search",
  "streaming",
  "background",
  "concurrency",
] as const
export const PERFORMANCE_PLATFORMS = ["darwin", "win32", "linux"] as const
export const PERFORMANCE_HARDWARE_CLASSES = [
  "minimum-supported",
  "reference-laptop",
  "reference-desktop",
] as const
export const PERFORMANCE_BUILD_TYPES = ["dev", "package"] as const
const BUILD_TYPE_THRESHOLD_OVERRIDES = new Map<string, number>([
  ["startup.shell-ready.small.dev.cold", 30_000],
  ["startup.shell-ready.small.dev.warm", 30_000],
  ["startup.first-use-ready.small.dev.cold", 35_000],
  ["renderer.search-response.large.dev.steady", 600],
])

export type PerformanceScenario = (typeof PERFORMANCE_SCENARIOS)[number]
export type PerformancePlatform = (typeof PERFORMANCE_PLATFORMS)[number]
export type PerformanceHardwareClass = (typeof PERFORMANCE_HARDWARE_CLASSES)[number]
export type PerformanceDataset = "small" | "medium" | "large" | "stress"
export type PerformanceBuildType = (typeof PERFORMANCE_BUILD_TYPES)[number]
export type PerformanceTemperature = "cold" | "warm" | "steady" | "soak"
export type PerformanceAggregation = "minimum" | "median" | "p95" | "maximum" | "mean"
export type PerformanceUnit = "milliseconds" | "percent" | "bytes" | "count"
export type PerformanceDirection = "at-most" | "at-least"

export interface PerformanceDatasetDefinition {
  id: PerformanceDataset
  version: string
  seed: number
  cardinality: Readonly<Record<string, number>>
}

export interface PerformanceHardwareDefinition {
  id: PerformanceHardwareClass
  minimumLogicalCores: number
  minimumMemoryBytes: number
  powerProfile: "balanced-ac" | "performance-ac"
}

export interface PerformanceBudget {
  id: string
  scenario: PerformanceScenario
  dataset: PerformanceDataset
  hardwareClasses: readonly PerformanceHardwareClass[]
  platforms: readonly PerformancePlatform[]
  buildType: PerformanceBuildType
  temperature: PerformanceTemperature
  metric: (typeof REQUIRED_PERFORMANCE_METRICS)[number]
  unit: PerformanceUnit
  aggregation: PerformanceAggregation
  direction: PerformanceDirection
  measurementMethod: string
  threshold: number
  allowedCoefficientVariationPercent: number
  minimumWarmups: number
  minimumRepeats: number
  requiresHostedTiming: false
}

export interface PerformanceSampleSet {
  warmupSamples: number[]
  measuredSamples: number[]
}

export interface PerformanceSummary {
  repeats: number
  minimum: number
  maximum: number
  median: number
  p95: number
  mean: number
  coefficientVariationPercent: number
}

export interface PerformanceSummaryComputation {
  raw: PerformanceSummary
  display: PerformanceSummary
}

export interface PerformanceException {
  owner: string
  rationale: string
  expiresAt: string
  reviewedEvidence: string
  reviewedEvidenceSha256: string
  reviewedEvidenceByteLength: number
}

export type PerformanceBudgetAuthority =
  | {
      status: "provisional-unreviewed"
      reviewedEvidenceSha256: null
    }
  | {
      status: "reviewed"
      reviewedEvidenceSha256: string
    }

type MetricSpec = Omit<
  PerformanceBudget,
  | "id"
  | "buildType"
  | "hardwareClasses"
  | "platforms"
  | "measurementMethod"
  | "allowedCoefficientVariationPercent"
  | "minimumWarmups"
  | "minimumRepeats"
  | "requiresHostedTiming"
>

export const REQUIRED_PERFORMANCE_METRICS = [
  "shell-ready",
  "first-use-ready",
  "warm-first-use-ready",
  "database-open",
  "migration-upgrade",
  "recovery-reopen",
  "input-response",
  "frame-stall",
  "task-stall",
  "long-chat-render",
  "search-response",
  "scoped-query",
  "database-search",
  "migration-duration",
  "recovery-duration",
  "concurrent-read-write-lock",
  "wal-checkpoint",
  "backup-duration",
  "maintenance-duration",
  "integrity-check",
  "restart-recovery",
  "stream-throughput",
  "stream-event-latency",
  "ordered-event-loss",
  "output-flood-loss",
  "output-flood-backlog",
  "steady-state-cpu",
  "steady-state-memory",
  "file-descriptor-delta",
  "listener-delta",
  "watcher-delta",
  "socket-delta",
  "deterministic-soak-memory-growth",
  "deterministic-soak-resource-delta",
  "harness-overhead",
  "trace-capture",
  "heap-snapshot",
  "sleep-wake-recovery",
  "process-delta",
  "timer-delta",
  "agent-start-latency",
  "terminal-start-latency",
  "grid-input-response",
  "cancel-latency",
  "cleanup-process-delta",
  "concurrent-agent-capacity",
  "concurrent-terminal-capacity",
  "visible-grid-pane-capacity",
] as const

const ALL_PLATFORMS = PERFORMANCE_PLATFORMS
const ALL_HARDWARE = PERFORMANCE_HARDWARE_CLASSES

const metricSpecs: readonly MetricSpec[] = [
  spec("startup", "small", "cold", "shell-ready", "milliseconds", "median", "at-most", 4_000),
  spec("startup", "small", "warm", "shell-ready", "milliseconds", "median", "at-most", 2_500),
  spec("startup", "small", "cold", "first-use-ready", "milliseconds", "p95", "at-most", 6_000),
  spec("startup", "small", "warm", "warm-first-use-ready", "milliseconds", "p95", "at-most", 4_000),
  spec("startup", "large", "cold", "database-open", "milliseconds", "p95", "at-most", 2_000),
  spec("startup", "large", "cold", "migration-upgrade", "milliseconds", "p95", "at-most", 30_000),
  spec("startup", "large", "cold", "recovery-reopen", "milliseconds", "p95", "at-most", 5_000),
  spec("renderer", "large", "steady", "input-response", "milliseconds", "p95", "at-most", 100),
  spec("renderer", "large", "steady", "frame-stall", "milliseconds", "p95", "at-most", 50),
  spec("renderer", "large", "steady", "task-stall", "milliseconds", "p95", "at-most", 100),
  spec("renderer", "large", "steady", "long-chat-render", "milliseconds", "p95", "at-most", 500),
  spec("renderer", "large", "steady", "search-response", "milliseconds", "p95", "at-most", 250),
  spec("storage-search", "large", "steady", "scoped-query", "milliseconds", "p95", "at-most", 250),
  spec(
    "storage-search",
    "large",
    "steady",
    "database-search",
    "milliseconds",
    "p95",
    "at-most",
    500,
  ),
  spec(
    "storage-search",
    "large",
    "cold",
    "migration-duration",
    "milliseconds",
    "p95",
    "at-most",
    30_000,
  ),
  spec(
    "storage-search",
    "large",
    "cold",
    "recovery-duration",
    "milliseconds",
    "maximum",
    "at-most",
    10_000,
  ),
  spec(
    "storage-search",
    "large",
    "steady",
    "concurrent-read-write-lock",
    "milliseconds",
    "p95",
    "at-most",
    1_000,
  ),
  spec(
    "storage-search",
    "large",
    "steady",
    "wal-checkpoint",
    "milliseconds",
    "p95",
    "at-most",
    2_000,
  ),
  spec(
    "storage-search",
    "large",
    "steady",
    "backup-duration",
    "milliseconds",
    "p95",
    "at-most",
    30_000,
  ),
  spec(
    "storage-search",
    "large",
    "steady",
    "maintenance-duration",
    "milliseconds",
    "p95",
    "at-most",
    10_000,
  ),
  spec(
    "storage-search",
    "large",
    "steady",
    "integrity-check",
    "milliseconds",
    "p95",
    "at-most",
    10_000,
  ),
  spec(
    "storage-search",
    "large",
    "cold",
    "restart-recovery",
    "milliseconds",
    "p95",
    "at-most",
    10_000,
  ),
  spec("streaming", "stress", "steady", "stream-throughput", "count", "mean", "at-least", 1_000),
  spec(
    "streaming",
    "stress",
    "steady",
    "stream-event-latency",
    "milliseconds",
    "p95",
    "at-most",
    100,
  ),
  spec("streaming", "stress", "steady", "ordered-event-loss", "count", "maximum", "at-most", 0),
  spec("streaming", "stress", "steady", "output-flood-loss", "count", "maximum", "at-most", 0),
  spec(
    "streaming",
    "stress",
    "steady",
    "output-flood-backlog",
    "count",
    "maximum",
    "at-most",
    1_000,
  ),
  spec("background", "medium", "steady", "steady-state-cpu", "percent", "p95", "at-most", 5),
  spec(
    "background",
    "medium",
    "steady",
    "steady-state-memory",
    "bytes",
    "maximum",
    "at-most",
    805_306_368,
  ),
  spec("background", "medium", "steady", "file-descriptor-delta", "count", "maximum", "at-most", 0),
  spec("background", "medium", "steady", "listener-delta", "count", "maximum", "at-most", 0),
  spec("background", "medium", "steady", "watcher-delta", "count", "maximum", "at-most", 0),
  spec("background", "medium", "steady", "socket-delta", "count", "maximum", "at-most", 0),
  spec(
    "background",
    "stress",
    "soak",
    "deterministic-soak-memory-growth",
    "bytes",
    "maximum",
    "at-most",
    67_108_864,
  ),
  spec(
    "background",
    "stress",
    "soak",
    "deterministic-soak-resource-delta",
    "count",
    "maximum",
    "at-most",
    0,
  ),
  spec("background", "small", "steady", "harness-overhead", "milliseconds", "p95", "at-most", 5),
  spec("background", "medium", "steady", "trace-capture", "count", "minimum", "at-least", 1),
  spec("background", "medium", "steady", "heap-snapshot", "count", "minimum", "at-least", 1),
  spec(
    "background",
    "medium",
    "steady",
    "sleep-wake-recovery",
    "milliseconds",
    "p95",
    "at-most",
    5_000,
  ),
  spec("background", "medium", "steady", "process-delta", "count", "maximum", "at-most", 0),
  spec("background", "medium", "steady", "timer-delta", "count", "maximum", "at-most", 0),
  spec(
    "concurrency",
    "stress",
    "steady",
    "agent-start-latency",
    "milliseconds",
    "p95",
    "at-most",
    2_000,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "terminal-start-latency",
    "milliseconds",
    "p95",
    "at-most",
    1_000,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "grid-input-response",
    "milliseconds",
    "p95",
    "at-most",
    100,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "cancel-latency",
    "milliseconds",
    "p95",
    "at-most",
    2_000,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "cleanup-process-delta",
    "count",
    "maximum",
    "at-most",
    0,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "concurrent-agent-capacity",
    "count",
    "minimum",
    "at-least",
    10,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "concurrent-terminal-capacity",
    "count",
    "minimum",
    "at-least",
    10,
  ),
  spec(
    "concurrency",
    "stress",
    "steady",
    "visible-grid-pane-capacity",
    "count",
    "minimum",
    "at-least",
    4,
  ),
]

export const STAGE6_PERFORMANCE_BUDGETS = {
  version: "s6-v7" as const,
  authority: {
    status: "reviewed" as const,
    reviewedEvidenceSha256: "37695ba0daa8f2d0c07d3af8813d3c56cde2c2e60c28aea5f3f70de5d02cf9b3",
  } satisfies PerformanceBudgetAuthority,
  platforms: PERFORMANCE_PLATFORMS,
  hardwareClasses: [
    hardware("minimum-supported", 4, 8 * 1024 ** 3, "balanced-ac"),
    hardware("reference-laptop", 8, 16 * 1024 ** 3, "balanced-ac"),
    hardware("reference-desktop", 8, 16 * 1024 ** 3, "performance-ac"),
  ] satisfies readonly PerformanceHardwareDefinition[],
  datasets: [
    dataset("small", 6_001, {
      projects: 2,
      chats: 5,
      messages: 20,
      agents: 1,
      terminals: 1,
      panes: 1,
    }),
    dataset("medium", 6_002, {
      projects: 5,
      chats: 20,
      messages: 100,
      agents: 2,
      terminals: 2,
      panes: 2,
    }),
    dataset("large", 6_003, {
      projects: 10,
      chats: 100,
      messages: 200,
      agents: 5,
      terminals: 5,
      panes: 4,
    }),
    dataset("stress", 6_004, {
      projects: 20,
      chats: 100,
      messages: 200,
      agents: 10,
      terminals: 10,
      panes: 4,
    }),
  ] satisfies readonly PerformanceDatasetDefinition[],
  supportLimits: {
    maxConcurrentAgents: 10,
    maxConcurrentTerminals: 10,
    maxVisibleChatPanes: 4,
    maxWorkbenchWindows: 4,
    maxMeasuredSamplesPerResult: 200,
    maxResultsPerReport: 200,
    maxOmissionsPerReport: 200,
  },
  budgets: metricSpecs.flatMap((metric) =>
    PERFORMANCE_BUILD_TYPES.map((buildType) => makeBudget(metric, buildType)),
  ) satisfies readonly PerformanceBudget[],
}

export const STAGE6_PERFORMANCE_BUDGET_REVIEW = {
  relativePath: "docs/stage6-performance-budget-review.json",
  sha256: STAGE6_PERFORMANCE_BUDGETS.authority.reviewedEvidenceSha256,
} as const

export function assertPerformanceSupportRequest(input: {
  agents?: number
  terminals?: number
  visibleChatPanes?: number
  workbenchWindows?: number
}): void {
  const checks = [
    ["agents", input.agents, STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxConcurrentAgents],
    ["terminals", input.terminals, STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxConcurrentTerminals],
    [
      "visible chat panes",
      input.visibleChatPanes,
      STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxVisibleChatPanes,
    ],
    [
      "workbench windows",
      input.workbenchWindows,
      STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxWorkbenchWindows,
    ],
  ] as const
  for (const [label, requested, maximum] of checks) {
    if (requested === undefined) continue
    if (!Number.isInteger(requested) || requested < 0) {
      throw new Error(`Requested ${label} must be a non-negative integer.`)
    }
    if (requested > maximum) {
      throw new Error(`Requested ${label} exceeds the supported limit of ${maximum}.`)
    }
  }
}

export function summarizePerformanceSamples(
  samples: PerformanceSampleSet,
): PerformanceSummaryComputation {
  validateSamples(samples.measuredSamples)
  const sorted = [...samples.measuredSamples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sorted.length
  const variance = sorted.reduce((total, sample) => total + (sample - mean) ** 2, 0) / sorted.length
  const raw: PerformanceSummary = {
    repeats: sorted.length,
    minimum: sorted[0]!,
    maximum: sorted[sorted.length - 1]!,
    median,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!,
    mean,
    coefficientVariationPercent: mean === 0 ? 0 : (Math.sqrt(variance) / mean) * 100,
  }
  return { raw, display: mapSummary(raw, roundMetric) }
}

export function evaluatePerformanceSamples(
  budget: PerformanceBudget,
  samples: PerformanceSampleSet,
  exception?: PerformanceException,
  now = new Date(),
): {
  status: "pass" | "fail" | "exception"
  reasons: string[]
  summary: PerformanceSummaryComputation
} {
  validateSamples(samples.warmupSamples, true)
  const summary = summarizePerformanceSamples(samples)
  const reasons: string[] = []
  if (samples.warmupSamples.length < budget.minimumWarmups) {
    reasons.push(
      `requires ${budget.minimumWarmups} warmup samples; received ${samples.warmupSamples.length}`,
    )
  }
  if (summary.raw.repeats < budget.minimumRepeats) {
    reasons.push(
      `requires ${budget.minimumRepeats} measured repeats; received ${summary.raw.repeats}`,
    )
  }
  const measured = aggregationValue(budget.aggregation, summary.raw)
  const thresholdFailed =
    budget.direction === "at-most" ? measured > budget.threshold : measured < budget.threshold
  if (thresholdFailed) {
    reasons.push(
      `${budget.aggregation} ${roundMetric(measured)} must be ${budget.direction} ${budget.threshold}`,
    )
  }
  if (
    thresholdFailed &&
    summary.raw.coefficientVariationPercent > budget.allowedCoefficientVariationPercent
  ) {
    reasons.push(
      `coefficient variation ${roundMetric(summary.raw.coefficientVariationPercent)}% exceeds ${budget.allowedCoefficientVariationPercent}%`,
    )
  }
  if (reasons.length === 0) return { status: "pass", reasons, summary }
  if (validException(exception, now)) return { status: "exception", reasons, summary }
  return { status: "fail", reasons, summary }
}

export function validatePerformanceBudgetCoverage(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const budget of STAGE6_PERFORMANCE_BUDGETS.budgets) {
    if (ids.has(budget.id)) errors.push(`duplicate budget id ${budget.id}`)
    ids.add(budget.id)
  }
  for (const metric of REQUIRED_PERFORMANCE_METRICS) {
    const matching = STAGE6_PERFORMANCE_BUDGETS.budgets.filter((budget) => budget.metric === metric)
    for (const buildType of PERFORMANCE_BUILD_TYPES) {
      if (!matching.some((budget) => budget.buildType === buildType)) {
        errors.push(`${metric} missing build ${buildType}`)
      }
    }
    for (const hardwareClass of PERFORMANCE_HARDWARE_CLASSES) {
      if (!matching.some((budget) => budget.hardwareClasses.includes(hardwareClass))) {
        errors.push(`${metric} missing hardware ${hardwareClass}`)
      }
    }
    for (const platform of PERFORMANCE_PLATFORMS) {
      if (!matching.some((budget) => budget.platforms.includes(platform))) {
        errors.push(`${metric} missing platform ${platform}`)
      }
    }
  }
  return errors
}

function spec(
  scenario: PerformanceScenario,
  dataset: PerformanceDataset,
  temperature: PerformanceTemperature,
  metric: (typeof REQUIRED_PERFORMANCE_METRICS)[number],
  unit: PerformanceUnit,
  aggregation: PerformanceAggregation,
  direction: PerformanceDirection,
  threshold: number,
): MetricSpec {
  return {
    scenario,
    dataset,
    temperature,
    metric,
    unit,
    aggregation,
    direction,
    threshold,
  }
}

function makeBudget(metric: MetricSpec, buildType: PerformanceBuildType): PerformanceBudget {
  const minimumRepeats = metric.aggregation === "p95" ? 20 : metric.aggregation === "mean" ? 10 : 5
  const id = `${metric.scenario}.${metric.metric}.${metric.dataset}.${buildType}.${metric.temperature}`
  return {
    ...metric,
    id,
    buildType,
    threshold: BUILD_TYPE_THRESHOLD_OVERRIDES.get(id) ?? metric.threshold,
    hardwareClasses: ALL_HARDWARE,
    platforms: ALL_PLATFORMS,
    measurementMethod: `stage6-v7:${metric.scenario}:${metric.metric}:${methodologyToken(metric.metric)}:${metric.aggregation}:cv-aggregation-aware:fixture-sha256:warmup-excluded`,
    allowedCoefficientVariationPercent: 20,
    minimumWarmups: metric.temperature === "cold" ? 1 : 3,
    minimumRepeats,
    requiresHostedTiming: false,
  }
}

function methodologyToken(metric: PerformanceBudget["metric"]): string {
  if (
    [
      "scoped-query",
      "database-search",
      "migration-duration",
      "recovery-duration",
      "concurrent-read-write-lock",
      "wal-checkpoint",
      "backup-duration",
      "maintenance-duration",
      "integrity-check",
      "restart-recovery",
      "database-open",
      "migration-upgrade",
      "recovery-reopen",
    ].includes(metric)
  ) {
    return "sqlite-observed"
  }
  if (
    [
      "stream-throughput",
      "stream-event-latency",
      "ordered-event-loss",
      "output-flood-loss",
      "output-flood-backlog",
    ].includes(metric)
  ) {
    return "stream-observed"
  }
  if (metric.startsWith("deterministic-soak")) return "bounded-soak-observed"
  if (metric === "steady-state-cpu") return "process-cpu-observed-1000ms-window"
  if (metric === "process-delta" || metric === "cleanup-process-delta") {
    return "owned-terminal-pid-liveness-observed"
  }
  if (metric === "trace-capture") return "electron-trace-required"
  if (metric === "heap-snapshot") return "electron-heap-required"
  if (metric === "sleep-wake-recovery") return "native-sleep-wake-required"
  if (
    metric.endsWith("-delta") ||
    metric.endsWith("-capacity") ||
    metric.endsWith("-loss") ||
    metric === "steady-state-memory"
  ) {
    return "resource-counter-observed"
  }
  return "monotonic-clock-observed"
}

function aggregationValue(
  aggregation: PerformanceAggregation,
  summary: PerformanceSummary,
): number {
  return summary[aggregation]
}

function validException(exception: PerformanceException | undefined, now: Date): boolean {
  return Boolean(
    exception &&
    exception.owner.trim() &&
    exception.rationale.trim() &&
    exception.reviewedEvidence.trim() &&
    /^[a-f0-9]{64}$/.test(exception.reviewedEvidenceSha256) &&
    Number.isInteger(exception.reviewedEvidenceByteLength) &&
    exception.reviewedEvidenceByteLength > 0 &&
    exception.reviewedEvidenceByteLength <= 1_000_000 &&
    Number.isFinite(Date.parse(exception.expiresAt)) &&
    Date.parse(exception.expiresAt) > now.getTime(),
  )
}

function validateSamples(samples: number[], allowEmpty = false): void {
  if (!allowEmpty && samples.length < 1) {
    throw new Error("At least one measured performance sample is required.")
  }
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error("Performance samples must be finite non-negative numbers.")
  }
}

function dataset(
  id: PerformanceDataset,
  seed: number,
  cardinality: Readonly<Record<string, number>>,
): PerformanceDatasetDefinition {
  return { id, version: "1", seed, cardinality }
}

function hardware(
  id: PerformanceHardwareClass,
  minimumLogicalCores: number,
  minimumMemoryBytes: number,
  powerProfile: PerformanceHardwareDefinition["powerProfile"],
): PerformanceHardwareDefinition {
  return { id, minimumLogicalCores, minimumMemoryBytes, powerProfile }
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3))
}

function mapSummary(
  summary: PerformanceSummary,
  map: (value: number) => number,
): PerformanceSummary {
  return {
    repeats: summary.repeats,
    minimum: map(summary.minimum),
    maximum: map(summary.maximum),
    median: map(summary.median),
    p95: map(summary.p95),
    mean: map(summary.mean),
    coefficientVariationPercent: map(summary.coefficientVariationPercent),
  }
}
