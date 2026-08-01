import {
  PERFORMANCE_BUILD_TYPES,
  REQUIRED_PERFORMANCE_METRICS,
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBudget,
} from "./budgets"
import {
  STAGE6_CAPABILITY_PERFORMANCE_METRICS,
  STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS,
  STAGE6_REQUIRED_PRODUCT_SEAMS,
} from "./requirements"

type RequiredMetric = PerformanceBudget["metric"]

export interface RequiredProductPerformanceWorkflow {
  metric: RequiredMetric
  productArea: "startup" | "renderer" | "storage" | "stream" | "resource" | "concurrency"
  methodologyToken: string
  evidenceClass: "core" | "capability"
  availability: "implemented" | "requires-electron" | "unavailable"
  productionSeam?: string
  unavailableReason?: string
  runPrerequisite?: string
}

const ELECTRON_PREREQUISITE =
  "Run the exact development candidate in Electron with the Stage 6 MCP test-control performance observer attached."
const CAPABILITY_PREREQUISITE =
  "Run the exact Electron candidate on a native host with trace, heap, or sleep/wake control available."

export const REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS =
  REQUIRED_PERFORMANCE_METRICS.map<RequiredProductPerformanceWorkflow>((metric) => {
    const productArea = areaFor(metric)
    if (STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(metric as never)) {
      return {
        metric,
        productArea,
        methodologyToken: methodologyFor(metric),
        evidenceClass: "core",
        availability: "implemented",
        productionSeam:
          STAGE6_REQUIRED_PRODUCT_SEAMS[metric as keyof typeof STAGE6_REQUIRED_PRODUCT_SEAMS],
        runPrerequisite: ELECTRON_PREREQUISITE,
      }
    }
    if (STAGE6_CAPABILITY_PERFORMANCE_METRICS.includes(metric as never)) {
      return {
        metric,
        productArea,
        methodologyToken: methodologyFor(metric),
        evidenceClass: "capability",
        availability: "unavailable",
        unavailableReason:
          "Native trace, heap, and sleep/wake evidence is outside the bounded development core lane.",
        runPrerequisite: CAPABILITY_PREREQUISITE,
      }
    }
    return {
      metric,
      productArea,
      methodologyToken: methodologyFor(metric),
      evidenceClass: "core",
      availability: "implemented",
      productionSeam:
        STAGE6_REQUIRED_PRODUCT_SEAMS[metric as keyof typeof STAGE6_REQUIRED_PRODUCT_SEAMS],
    }
  })

export function validateRequiredPerformanceWorkflowCoverage(): string[] {
  const errors: string[] = []
  const workflows = new Map<RequiredMetric, RequiredProductPerformanceWorkflow>()
  for (const workflow of REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS) {
    if (workflows.has(workflow.metric))
      errors.push(`duplicate required workflow ${workflow.metric}`)
    workflows.set(workflow.metric, workflow)
  }
  for (const metric of REQUIRED_PERFORMANCE_METRICS) {
    const workflow = workflows.get(metric)
    if (!workflow) {
      errors.push(`required metric ${metric} has no product workflow`)
      continue
    }
    const budgets = STAGE6_PERFORMANCE_BUDGETS.budgets.filter((budget) => budget.metric === metric)
    for (const buildType of PERFORMANCE_BUILD_TYPES) {
      if (!budgets.some((budget) => budget.buildType === buildType)) {
        errors.push(`${metric} has no ${buildType} budget`)
      }
    }
    if (!budgets.every((budget) => budget.measurementMethod.includes(workflow.methodologyToken))) {
      errors.push(`${metric} budget methodology does not match ${workflow.methodologyToken}`)
    }
    if (workflow.availability === "implemented" && !workflow.productionSeam) {
      errors.push(`${metric} has no fixed production seam`)
    }
    if (workflow.availability !== "implemented" && !workflow.runPrerequisite) {
      errors.push(`${metric} has no concrete run prerequisite`)
    }
  }
  return errors
}

function areaFor(metric: RequiredMetric): RequiredProductPerformanceWorkflow["productArea"] {
  const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find((entry) => entry.metric === metric)!
  if (budget.scenario === "storage-search") return "storage"
  if (budget.scenario === "streaming") return "stream"
  if (budget.scenario === "background") return "resource"
  return budget.scenario
}

function methodologyFor(metric: RequiredMetric): string {
  const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find((entry) => entry.metric === metric)!
  const marker = `stage6-v7:${budget.scenario}:${metric}:`
  return budget.measurementMethod.slice(marker.length).split(":")[0]!
}
