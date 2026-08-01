import { isAbsolute, normalize, relative, resolve } from "node:path"
import {
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBuildType,
  type PerformanceHardwareClass,
} from "./budgets"
import {
  STAGE6_CAPABILITY_PERFORMANCE_METRICS,
  STAGE6_CORE_DEV_PERFORMANCE_METRICS,
} from "./requirements"

export type PerformanceCliLane = "core" | "capability"

export interface PerformanceCliArguments {
  lane: PerformanceCliLane
  buildType: PerformanceBuildType
  hardwareClass: PerformanceHardwareClass
  outputDirectory: string
  boundedCi: boolean
  acceptance: boolean
}

const DEFAULT_OUTPUT = ".local-evidence/stage6-performance"

export function parsePerformanceCliArguments(args: readonly string[]): PerformanceCliArguments {
  let lane: PerformanceCliLane = "core"
  let buildType: PerformanceBuildType = "dev"
  let hardwareClass: PerformanceHardwareClass = "reference-laptop"
  let outputDirectory = DEFAULT_OUTPUT
  let boundedCi = false
  let acceptance = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === "--core") lane = "core"
    else if (argument === "--capability") lane = "capability"
    else if (argument === "--package") buildType = "package"
    else if (argument === "--ci") boundedCi = true
    else if (argument === "--acceptance") acceptance = true
    else if (argument === "--hardware") {
      const value = args[++index]
      if (
        value !== "minimum-supported" &&
        value !== "reference-laptop" &&
        value !== "reference-desktop"
      ) {
        throw new Error("Unknown performance hardware class.")
      }
      hardwareClass = value
    } else if (argument === "--output") {
      outputDirectory = args[++index] ?? ""
    } else {
      throw new Error(`Unknown Stage 6 performance argument: ${argument}`)
    }
  }
  if (lane === "core" && buildType === "package") {
    throw new Error(
      "Package timing is a separate release lane; the bounded core CLI measures development candidates only.",
    )
  }
  if (boundedCi && acceptance) {
    throw new Error("Full acceptance and bounded CI are separate performance lanes.")
  }
  validateRelativeEvidenceDirectory(outputDirectory)
  return { lane, buildType, hardwareClass, outputDirectory, boundedCi, acceptance }
}

export function resolvePerformanceEvidenceDirectory(
  repositoryRoot: string,
  outputDirectory: string,
): string {
  validateRelativeEvidenceDirectory(outputDirectory)
  const root = resolve(repositoryRoot)
  const destination = resolve(root, outputDirectory)
  const fromRoot = relative(root, destination)
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Performance evidence output must be a child directory of the repository.")
  }
  return destination
}

export function performanceCliBudgetIds(
  lane: PerformanceCliLane,
  buildType: PerformanceBuildType,
  boundedCi = false,
): string[] {
  const metrics =
    lane === "core" ? STAGE6_CORE_DEV_PERFORMANCE_METRICS : STAGE6_CAPABILITY_PERFORMANCE_METRICS
  const selected = STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
    (budget) => budget.buildType === buildType && metrics.includes(budget.metric as never),
  )
  if (!boundedCi) {
    return selected
      .toSorted(
        (left, right) =>
          performanceMetricPriority(left.metric) - performanceMetricPriority(right.metric),
      )
      .map((budget) => budget.id)
  }
  const ciMetrics = new Set([
    "database-open",
    "harness-overhead",
    "listener-delta",
    "agent-start-latency",
    "concurrent-agent-capacity",
    "concurrent-terminal-capacity",
    "visible-grid-pane-capacity",
  ])
  return selected.filter((budget) => ciMetrics.has(budget.metric)).map((budget) => budget.id)
}

function performanceMetricPriority(metric: string): number {
  if (
    metric === "steady-state-memory" ||
    metric === "deterministic-soak-memory-growth" ||
    metric === "deterministic-soak-resource-delta"
  ) {
    return 0
  }
  return 1
}

export function performanceCiFailureReasons(report: {
  results: readonly {
    budgetId: string
    evaluation: { status: "pass" | "fail" | "exception" }
  }[]
  omissions: readonly { budgetId: string }[]
  coverage: { complete: boolean; missingBudgetIds: readonly string[] }
}): string[] {
  const failed = report.results
    .filter((result) => result.evaluation.status === "fail")
    .map((result) => result.budgetId)
  const omitted = report.omissions.map((omission) => omission.budgetId)
  return [
    ...(failed.length > 0 ? [`failed performance budgets: ${failed.join(", ")}`] : []),
    ...(omitted.length > 0 ? [`omitted requested performance budgets: ${omitted.join(", ")}`] : []),
  ]
}

export function performanceAcceptanceFailureReasons(report: {
  evidenceStatus: "pass" | "fail" | "exception" | "incomplete" | "untrusted"
  candidate: { dirty: boolean }
  results: readonly {
    budgetId: string
    evaluation: { status: "pass" | "fail" | "exception" }
  }[]
  omissions: readonly { budgetId: string }[]
  coverage: { complete: boolean; missingBudgetIds: readonly string[] }
}): string[] {
  const reasons = performanceCiFailureReasons(report)
  if (report.candidate.dirty) reasons.push("performance candidate is dirty")
  if (!report.coverage.complete) {
    reasons.push(
      report.coverage.missingBudgetIds.length > 0
        ? `performance coverage is incomplete: ${report.coverage.missingBudgetIds.join(", ")}`
        : "performance coverage is incomplete",
    )
  }
  if (report.evidenceStatus !== "pass" && report.evidenceStatus !== "exception") {
    reasons.push(`performance evidence status is ${report.evidenceStatus}`)
  }
  return reasons
}

function validateRelativeEvidenceDirectory(value: string): void {
  const normalized = normalize(value.trim())
  if (
    !value.trim() ||
    isAbsolute(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..\\`) ||
    normalized.startsWith("../")
  ) {
    throw new Error("Performance evidence output must stay inside the repository.")
  }
}
