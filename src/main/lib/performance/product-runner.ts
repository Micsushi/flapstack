import {
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBuildType,
  type PerformanceHardwareClass,
  type PerformancePlatform,
} from "./budgets"
import { resolve } from "node:path"
import {
  captureLocalCandidate,
  localCandidateCaptureSupport,
  observedCandidateRepositoryRoot,
  type CandidateBinding,
} from "./candidate"
import { builtInProductRepositoryRoot, createProductPerformanceAdapters } from "./product-adapters"
import type { PerformanceReport, PerformanceReportLane } from "./report"
import { runBuiltInProductPerformancePlan } from "./runner"

export interface LocalProductPerformanceRunInput {
  buildType: PerformanceBuildType
  hardwareClass: PerformanceHardwareClass
  lane?: PerformanceReportLane
  cwd?: string
  budgetIds?: string[]
  measuredAt?: string
}

export type LocalProductPerformanceRunOutcome =
  { status: "unsupported"; reason: string } | { status: "completed"; report: PerformanceReport }

export function localProductPerformanceSupport(input: {
  platform: PerformancePlatform
  buildType: PerformanceBuildType
}): { supported: true } | { supported: false; reason: string } {
  const capture = localCandidateCaptureSupport(input.platform)
  if (!capture.supported) return capture
  if (input.buildType === "package") {
    return {
      supported: false,
      reason:
        "Package performance capture is unavailable without executing and observing the exact package.",
    }
  }
  return { supported: true }
}

/**
 * Non-interactive product benchmark call site. It captures the executing
 * worktree, hardware, and power profile internally, then re-verifies that
 * observation before and after adapter execution. Because this headless runner
 * executes no Electron binary, it deliberately omits build and Electron labels.
 */
export async function runLocalProductPerformancePlan(
  input: LocalProductPerformanceRunInput,
): Promise<LocalProductPerformanceRunOutcome> {
  rejectCallerBuildIdentity(input)
  const support = localProductPerformanceSupport({
    platform: process.platform as PerformancePlatform,
    buildType: input.buildType,
  })
  if (!support.supported) {
    return { status: "unsupported", reason: support.reason }
  }
  const candidate = captureLocalCandidate({
    buildType: input.buildType,
    hardwareClass: input.hardwareClass,
    cwd: input.cwd,
  })
  const budgetIds = input.budgetIds ?? applicableBudgetIds(candidate)
  const repositoryRoot = observedCandidateRepositoryRoot(candidate)
  if (resolve(repositoryRoot) !== builtInProductRepositoryRoot()) {
    throw new Error("Built-in product evidence is locked to the current process repository root.")
  }
  const outcome = await runBuiltInProductPerformancePlan({
    candidate,
    budgetIds,
    lane: input.lane,
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    adapters: createProductPerformanceAdapters(),
  })
  return { status: "completed", report: outcome.report }
}

function rejectCallerBuildIdentity(input: object): void {
  if (
    "buildId" in input ||
    "electronVersion" in input ||
    "artifactPath" in input ||
    "adapters" in input ||
    "adapterOptions" in input ||
    "migrationsFolder" in input
  ) {
    throw new Error(
      "Caller-supplied build, Electron, artifact, adapter, or migration authority is not accepted as observed evidence.",
    )
  }
}

function applicableBudgetIds(candidate: CandidateBinding): string[] {
  return STAGE6_PERFORMANCE_BUDGETS.budgets
    .filter(
      (budget) =>
        budget.buildType === candidate.buildType &&
        budget.platforms.includes(candidate.platform) &&
        budget.hardwareClasses.includes(candidate.hardwareClass),
    )
    .map((budget) => budget.id)
}
