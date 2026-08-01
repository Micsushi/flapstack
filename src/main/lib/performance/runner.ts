import {
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBudget,
  type PerformanceSampleSet,
} from "./budgets"
import {
  verifyCandidateBinding,
  verifyObservedCandidateNow,
  type CandidateBinding,
} from "./candidate"
import { canonicalJson } from "./canonical"
import { createPerformanceFixture } from "./fixtures"
import {
  builtInProductionSeamFor,
  isBuiltInProductPerformanceAdapter,
  issueBuiltInMeasurementCapability,
} from "./product-adapters"
import {
  conditionsForBudget,
  createPerformanceReport,
  type PerformanceConditions,
  type PerformanceReport,
  type PerformanceReportLane,
  type PerformanceResultInput,
} from "./report"
import type { ElectronPerformanceBuildIdentity } from "./electron-control"

export interface PerformanceMeasurementAdapter {
  id: string
  supports(
    budget: PerformanceBudget,
    candidate: CandidateBinding,
  ): { supported: true } | { supported: false; reason: string }
  measure(input: {
    budget: PerformanceBudget
    candidate: CandidateBinding
    fixtureBytes: Buffer
    fixtureSha256: string
  }): Promise<{
    fixtureSha256: string
    conditions: PerformanceConditions
    samples: PerformanceSampleSet
    runtimeBuildIdentity?: ElectronPerformanceBuildIdentity
    runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[]
    runtimeRendererProcessIds?: number[]
  }>
}

export interface RunPerformancePlanInput {
  candidate: CandidateBinding
  budgetIds: string[]
  lane?: PerformanceReportLane
  measuredAt: string
  adapters: PerformanceMeasurementAdapter[]
}

export interface RunPerformancePlanOutcome {
  report: PerformanceReport
}

export async function runPerformancePlan(
  input: RunPerformancePlanInput,
): Promise<RunPerformancePlanOutcome> {
  return runPerformancePlanInternal(input, "untrusted-adapter")
}

export async function runBuiltInProductPerformancePlan(
  input: RunPerformancePlanInput,
): Promise<RunPerformancePlanOutcome> {
  if (
    input.adapters.length === 0 ||
    input.adapters.some((adapter) => !isBuiltInProductPerformanceAdapter(adapter))
  ) {
    throw new Error("Built-in product evidence requires registered product adapters.")
  }
  return runPerformancePlanInternal(input, "built-in-product")
}

async function runPerformancePlanInternal(
  input: RunPerformancePlanInput,
  authority: "built-in-product" | "untrusted-adapter",
): Promise<RunPerformancePlanOutcome> {
  if (input.candidate.authority === "local-observed") {
    verifyObservedCandidateNow(input.candidate)
  }
  const verifiedCandidate = verifyCandidateBinding(input.candidate)
  const candidate =
    input.candidate.authority === "local-observed" ? input.candidate : verifiedCandidate
  const results: PerformanceResultInput[] = []
  const omissions: Array<{ budgetId: string; reason: string; adapterId?: string }> = []
  const seen = new Set<string>()
  for (const budgetId of input.budgetIds) {
    if (seen.has(budgetId)) throw new Error(`Duplicate requested performance budget: ${budgetId}`)
    seen.add(budgetId)
    const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find((entry) => entry.id === budgetId)
    if (!budget) throw new Error(`Unknown performance budget: ${budgetId}`)
    const evaluatedAdapters = input.adapters.map((adapter) => ({
      adapter,
      support: adapter.supports(budget, candidate),
    }))
    const supported = evaluatedAdapters.find((entry) => entry.support.supported)
    if (!supported) {
      const unavailable = evaluatedAdapters[0]
      omissions.push({
        budgetId,
        ...(unavailable ? { adapterId: unavailable.adapter.id } : {}),
        reason:
          unavailable && !unavailable.support.supported
            ? boundedReason(unavailable.support.reason)
            : "No measurement adapter supports this budget and candidate.",
      })
      continue
    }
    const fixture = createPerformanceFixture(budget.dataset)
    try {
      const measured = await supported.adapter.measure({
        budget,
        candidate,
        fixtureBytes: fixture.bytes,
        fixtureSha256: fixture.manifest.sha256,
      })
      if (measured.fixtureSha256 !== fixture.manifest.sha256) {
        throw new Error("Adapter measured a fixture that does not match fixture authority.")
      }
      if (
        canonicalJson(measured.conditions) !== canonicalJson(conditionsForBudget(budget, candidate))
      ) {
        throw new Error("Adapter measured conditions do not match budget authority.")
      }
      const productionSeam =
        authority === "built-in-product"
          ? builtInProductionSeamFor(supported.adapter, budget.metric)
          : undefined
      if (authority === "built-in-product" && !productionSeam) {
        throw new Error(`Built-in adapter has no fixed production seam for ${budget.metric}.`)
      }
      const builtInCapability =
        authority === "built-in-product"
          ? issueBuiltInMeasurementCapability({
              adapter: supported.adapter,
              budget,
              candidate,
              fixtureSha256: fixture.manifest.sha256,
              measurement: measured,
            })
          : undefined
      results.push({
        budgetId,
        fixture: fixture.manifest,
        fixtureBytes: fixture.bytes,
        conditions: measured.conditions,
        samples: measured.samples,
        ...(measured.runtimeBuildIdentity
          ? { runtimeBuildIdentity: measured.runtimeBuildIdentity }
          : {}),
        ...(measured.runtimeBuildIdentities
          ? { runtimeBuildIdentities: measured.runtimeBuildIdentities }
          : {}),
        ...(measured.runtimeRendererProcessIds
          ? { runtimeRendererProcessIds: measured.runtimeRendererProcessIds }
          : {}),
        ...(builtInCapability ? { builtInCapability } : { adapterId: supported.adapter.id }),
      })
    } catch (error) {
      omissions.push({
        budgetId,
        adapterId: supported.adapter.id,
        reason: boundedReason(error),
      })
    }
  }
  if (input.candidate.authority === "local-observed") {
    verifyObservedCandidateNow(input.candidate)
  }
  return {
    report: createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      lane: input.lane,
      measuredAt: input.measuredAt,
      candidate,
      results,
      omissions,
    }),
  }
}

export function expectedConditions(
  budget: PerformanceBudget,
  candidate: CandidateBinding,
): PerformanceConditions {
  return conditionsForBudget(budget, candidate)
}

function boundedReason(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Measurement adapter failed."
  return (
    message
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[A-Za-z]:[\\/][^\s"',;<>|]+/g, "[redacted-path]")
      .replace(/\/(?:home|Users|tmp|private\/tmp)\/[^\s"',;<>|]+/g, "[redacted-path]")
      .slice(0, 240) || "Measurement adapter failed."
  )
}
