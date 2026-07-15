import type { UsageInsightResult } from "../../../main/lib/usage/insights"
import type { UsageRollupQuery, UsageRollupQuality } from "../../../shared/advanced-usage"
import type {
  UsageExplorerMetric,
  UsageExplorerView,
} from "../../../shared/advanced-usage-explorer"

export const ADVANCED_USAGE_A11Y = {
  explorer: "Advanced usage explorer",
  filters: "Advanced usage filters",
  chart: "Usage aggregates chart",
  table: "Usage aggregates table",
  facts: "Supporting usage facts and provenance",
  insights: "Usage insight quality and provenance",
  budgets: "Scoped usage budget editor",
  exports: "Redacted usage export",
} as const

export type AdvancedUsageExplorerState = {
  query: UsageRollupQuery
  metric: UsageExplorerMetric
  selectedAggregateKey: "totals" | string
  selectedViewId: string | null
  statusMessage: string | null
}

export type AdvancedUsageExplorerAction =
  | { type: "query"; query: UsageRollupQuery }
  | { type: "metric"; metric: UsageExplorerMetric }
  | { type: "aggregate"; key: "totals" | string }
  | { type: "load-view"; view: UsageExplorerView }
  | { type: "saved"; view: UsageExplorerView }
  | { type: "new-view" }
  | { type: "deleted-view" }
  | { type: "message"; message: string | null }

export function initialAdvancedUsageExplorerState(
  nowMs = Date.now(),
  timezone = "UTC",
): AdvancedUsageExplorerState {
  return {
    query: {
      scope: { type: "global" },
      fromMs: nowMs - 30 * 24 * 60 * 60 * 1_000,
      toMs: nowMs,
      timezone,
      bucket: "day",
      groupBy: "provider-account",
      limit: 200,
      cursor: null,
    },
    metric: "cost-usd-micros",
    selectedAggregateKey: "totals",
    selectedViewId: null,
    statusMessage: null,
  }
}

export function advancedUsageExplorerReducer(
  state: AdvancedUsageExplorerState,
  action: AdvancedUsageExplorerAction,
): AdvancedUsageExplorerState {
  if (action.type === "query") {
    return { ...state, query: action.query, selectedAggregateKey: "totals", statusMessage: null }
  }
  if (action.type === "metric") return { ...state, metric: action.metric }
  if (action.type === "aggregate") return { ...state, selectedAggregateKey: action.key }
  if (action.type === "load-view") {
    return {
      ...state,
      query: action.view.query,
      metric: action.view.metric,
      selectedAggregateKey: "totals",
      selectedViewId: action.view.id,
      statusMessage: `Loaded saved view ${action.view.name}.`,
    }
  }
  if (action.type === "saved") {
    return {
      ...state,
      selectedViewId: action.view.id,
      statusMessage: `Saved view ${action.view.name}.`,
    }
  }
  if (action.type === "new-view") {
    return {
      ...state,
      selectedViewId: null,
      statusMessage: "Started a new view.",
    }
  }
  if (action.type === "deleted-view") {
    return {
      ...state,
      selectedViewId: null,
      statusMessage: "Saved view deleted.",
    }
  }
  return { ...state, statusMessage: action.message }
}

export function splitUsageFilter(value: string): string[] | undefined {
  const values = [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
  return values.length ? values : undefined
}

export function qualityCopy(quality: UsageRollupQuality): {
  label: string
  description: string
  approximate: boolean
} {
  if (quality === "exact") {
    return { label: "Exact", description: "Exact normalized source values.", approximate: false }
  }
  if (quality === "provider-reported") {
    return {
      label: "Provider reported",
      description: "Reported by the provider; not independently billed or verified by Flapstack.",
      approximate: false,
    }
  }
  if (quality === "estimated") {
    return {
      label: "Estimated",
      description: "Approximate value derived from usage and versioned pricing inputs.",
      approximate: true,
    }
  }
  return {
    label: "Unknown quality",
    description: "Source coverage cannot support an exact or estimated claim.",
    approximate: true,
  }
}

export function insightCopy(insight: UsageInsightResult): string {
  if (insight.forecast.status === "unavailable") {
    return `Forecast unavailable: ${humanReason(insight.forecast.reason)}. Coverage ${Math.round(
      insight.coverage.ratio * 100,
    )}% (${insight.coverage.sampleCount} facts).`
  }
  const range = `${formatInsightMetric(insight.forecast.lower, insight.metric)}–${formatInsightMetric(
    insight.forecast.upper,
    insight.metric,
  )}`
  const prefix =
    insight.forecast.quality === "estimated" ? "Estimated forecast range" : "Forecast range"
  return `${prefix}: ${range}. Based on ${insight.coverage.sampleCount} facts; ${insight.pricing.status} pricing provenance.`
}

export function formatExplorerMetric(value: number | null, metric: UsageExplorerMetric): string {
  if (value === null) return "Unavailable"
  if (metric === "cost-usd-micros") {
    return `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
  }
  return Math.round(value).toLocaleString()
}

function formatInsightMetric(value: number | null, metric: UsageExplorerMetric): string {
  return value === null ? "unavailable" : formatExplorerMetric(value, metric)
}

function humanReason(value: string | null): string {
  return (value ?? "source data unavailable").replace(/-/g, " ")
}
