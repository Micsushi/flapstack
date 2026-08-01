export const STAGE6_ELECTRON_MEASUREMENT_OPERATIONS = [
  "begin",
  "finish",
  "read",
  "reset",
  "sample",
] as const

export type Stage6ElectronMeasurementOperation =
  (typeof STAGE6_ELECTRON_MEASUREMENT_OPERATIONS)[number]
export type Stage6ElectronBuildType = "dev" | "package"

export const STAGE6_ELECTRON_MEASUREMENT_ROWS = [
  row("startup", "shell-ready", "small", "cold", "observe-cold-shell-ready"),
  row("startup", "shell-ready", "small", "warm", "observe-warm-shell-ready"),
  row("startup", "first-use-ready", "small", "cold", "open-first-use"),
  row("startup", "warm-first-use-ready", "small", "warm", "open-warm-first-use"),
  row("renderer", "input-response", "large", "steady", "dispatch-input-probe"),
  row("renderer", "frame-stall", "large", "steady", "observe-animation-frames"),
  row("renderer", "task-stall", "large", "steady", "observe-long-tasks"),
  row("renderer", "long-chat-render", "large", "steady", "render-long-chat-fixture"),
  row("renderer", "search-response", "large", "steady", "search-large-fixture"),
  row("concurrency", "grid-input-response", "stress", "steady", "dispatch-grid-input-probe"),
] as const

export type Stage6ElectronMeasurementRow = (typeof STAGE6_ELECTRON_MEASUREMENT_ROWS)[number]
export type Stage6ElectronMeasurementAction = Stage6ElectronMeasurementRow["action"]

export type Stage6ElectronMeasurementContract = Stage6ElectronMeasurementRow & {
  budgetId: string
  buildType: Stage6ElectronBuildType
  startMarker: string
  endMarker: string
  measureName: string
}

export function stage6ElectronBudgetIds(buildType: Stage6ElectronBuildType): string[] {
  return STAGE6_ELECTRON_MEASUREMENT_ROWS.map(
    (entry) =>
      `${entry.scenario}.${entry.metric}.${entry.dataset}.${buildType}.${entry.temperature}`,
  )
}

export function getStage6ElectronMeasurementContract(
  budgetId: string,
): Stage6ElectronMeasurementContract {
  const parsed = /^([^.]+)\.([^.]+)\.([^.]+)\.(dev|package)\.([^.]+)$/.exec(budgetId)
  if (!parsed) throw new Error(`Unknown Stage 6 Electron performance budget: ${budgetId}`)
  const [, scenario, metric, dataset, buildType, temperature] = parsed
  const entry = STAGE6_ELECTRON_MEASUREMENT_ROWS.find(
    (candidate) =>
      candidate.scenario === scenario &&
      candidate.metric === metric &&
      candidate.dataset === dataset &&
      candidate.temperature === temperature,
  )
  if (!entry) throw new Error(`Unknown Stage 6 Electron performance budget: ${budgetId}`)
  const markerBase = `stage6-electron:${budgetId}`
  return {
    ...entry,
    budgetId,
    buildType: buildType as Stage6ElectronBuildType,
    startMarker: `${markerBase}:start`,
    endMarker: `${markerBase}:end`,
    measureName: `${markerBase}:duration`,
  }
}

export function parseStage6ElectronMeasurementControl(raw: {
  budgetId?: unknown
  action?: unknown
  operation?: unknown
}): {
  budgetId: string
  action: Stage6ElectronMeasurementAction
  operation: Stage6ElectronMeasurementOperation
} | null {
  if (
    typeof raw.budgetId !== "string" ||
    typeof raw.action !== "string" ||
    typeof raw.operation !== "string" ||
    !STAGE6_ELECTRON_MEASUREMENT_OPERATIONS.includes(
      raw.operation as Stage6ElectronMeasurementOperation,
    )
  ) {
    return null
  }
  try {
    const contract = getStage6ElectronMeasurementContract(raw.budgetId)
    if (raw.action !== contract.action) return null
    return {
      budgetId: contract.budgetId,
      action: contract.action,
      operation: raw.operation as Stage6ElectronMeasurementOperation,
    }
  } catch {
    return null
  }
}

function row<
  const Scenario extends "startup" | "renderer" | "concurrency",
  const Metric extends
    | "shell-ready"
    | "first-use-ready"
    | "warm-first-use-ready"
    | "input-response"
    | "frame-stall"
    | "task-stall"
    | "long-chat-render"
    | "search-response"
    | "grid-input-response",
  const Dataset extends "small" | "large" | "stress",
  const Temperature extends "cold" | "warm" | "steady",
  const Action extends string,
>(scenario: Scenario, metric: Metric, dataset: Dataset, temperature: Temperature, action: Action) {
  return { scenario, metric, dataset, temperature, action } as const
}
