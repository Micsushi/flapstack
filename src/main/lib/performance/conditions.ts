import type { PerformanceBudget } from "./budgets"
import type { CandidateBinding } from "./candidate"

export interface PerformanceConditions {
  scenario: PerformanceBudget["scenario"]
  dataset: PerformanceBudget["dataset"]
  buildType: PerformanceBudget["buildType"]
  temperature: PerformanceBudget["temperature"]
  metric: PerformanceBudget["metric"]
  unit: PerformanceBudget["unit"]
  aggregation: PerformanceBudget["aggregation"]
  measurementMethod: string
  platform: CandidateBinding["platform"]
  hardwareClass: CandidateBinding["hardwareClass"]
}

export function conditionsForBudget(
  budget: PerformanceBudget,
  candidate: CandidateBinding,
): PerformanceConditions {
  return {
    scenario: budget.scenario,
    dataset: budget.dataset,
    buildType: budget.buildType,
    temperature: budget.temperature,
    metric: budget.metric,
    unit: budget.unit,
    aggregation: budget.aggregation,
    measurementMethod: budget.measurementMethod,
    platform: candidate.platform,
    hardwareClass: candidate.hardwareClass,
  }
}
