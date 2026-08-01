import { performance } from "node:perf_hooks"
import type { PerformanceBudget } from "./budgets"
import type { CandidateBinding } from "./candidate"
import { conditionsForBudget } from "./report"
import type { PerformanceMeasurementAdapter } from "./runner"

interface AdapterObservation {
  budget: PerformanceBudget
  candidate: CandidateBinding
  fixtureBytes: Buffer
  fixtureSha256: string
  phase: "warmup" | "measured"
  index: number
}

interface AdapterConfig {
  id: string
  budgetIds: string[]
}

export function createObservedValueAdapter(
  config: AdapterConfig & {
    observe(input: AdapterObservation): number | Promise<number>
  },
): PerformanceMeasurementAdapter {
  const budgetIds = exactBudgetIds(config.budgetIds)
  return {
    id: config.id,
    supports: (budget, candidate) => {
      if (candidate.authority !== "test-fixture") {
        return { supported: false, reason: "Generic observed-value adapters are test-only." }
      }
      return budgetIds.has(budget.id)
        ? { supported: true }
        : { supported: false, reason: "Budget is not bound to this observed-value adapter." }
    },
    measure: async ({ budget, candidate, fixtureBytes, fixtureSha256 }) => ({
      fixtureSha256,
      conditions: conditionsForBudget(budget, candidate),
      samples: {
        warmupSamples: await observePhase(
          budget.minimumWarmups,
          "warmup",
          config.observe,
          budget,
          candidate,
          fixtureBytes,
          fixtureSha256,
        ),
        measuredSamples: await observePhase(
          budget.minimumRepeats,
          "measured",
          config.observe,
          budget,
          candidate,
          fixtureBytes,
          fixtureSha256,
        ),
      },
    }),
  }
}

export function createMonotonicDurationAdapter(
  config: AdapterConfig & {
    operation(
      input: Omit<AdapterObservation, "phase" | "index"> & {
        phase: "warmup" | "measured"
        index: number
      },
    ): void | Promise<void>
  },
): PerformanceMeasurementAdapter {
  const budgetIds = exactBudgetIds(config.budgetIds)
  return {
    id: config.id,
    supports: (budget, candidate) => {
      if (candidate.authority !== "test-fixture") {
        return { supported: false, reason: "Generic duration adapters are test-only." }
      }
      if (!budgetIds.has(budget.id)) {
        return { supported: false, reason: "Budget is not bound to this duration adapter." }
      }
      if (budget.unit !== "milliseconds") {
        return { supported: false, reason: "Duration adapters require millisecond budgets." }
      }
      return { supported: true }
    },
    measure: async ({ budget, candidate, fixtureBytes, fixtureSha256 }) => {
      const observe = async (input: AdapterObservation) => {
        const startedAt = performance.now()
        await config.operation(input)
        return performance.now() - startedAt
      }
      return {
        fixtureSha256,
        conditions: conditionsForBudget(budget, candidate),
        samples: {
          warmupSamples: await observePhase(
            budget.minimumWarmups,
            "warmup",
            observe,
            budget,
            candidate,
            fixtureBytes,
            fixtureSha256,
          ),
          measuredSamples: await observePhase(
            budget.minimumRepeats,
            "measured",
            observe,
            budget,
            candidate,
            fixtureBytes,
            fixtureSha256,
          ),
        },
      }
    },
  }
}

async function observePhase(
  count: number,
  phase: AdapterObservation["phase"],
  observe: (input: AdapterObservation) => number | Promise<number>,
  budget: PerformanceBudget,
  candidate: CandidateBinding,
  fixtureBytes: Buffer,
  fixtureSha256: string,
): Promise<number[]> {
  const samples: number[] = []
  for (let index = 0; index < count; index += 1) {
    const sample = await observe({
      budget,
      candidate,
      fixtureBytes,
      fixtureSha256,
      phase,
      index,
    })
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error("Measurement adapters must return finite non-negative samples.")
    }
    samples.push(sample)
  }
  return samples
}

function exactBudgetIds(ids: string[]): Set<string> {
  if (ids.length < 1) throw new Error("Measurement adapters require at least one budget ID.")
  const unique = new Set(ids)
  if (unique.size !== ids.length) throw new Error("Measurement adapter budget IDs must be unique.")
  return unique
}
