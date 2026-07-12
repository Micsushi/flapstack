// Stage 2 Track B - U11: Usage dashboard + settings tab.
//
// DB-first reads so the panel renders instantly before any refresh. Shows
// per-provider state, daemon health, samples, and settings toggles. Provider
// polling records explicit capability/error states rather than fake zero usage.

import { Badge } from "../../ui/badge"
import { Progress } from "../../ui/progress"
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs"
import { trpc } from "../../../lib/trpc"
import { useEffect, useId, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react"
import {
  accountLabel,
  buildCurrentUsageSummaries,
  buildUsageHistorySeries,
  formatQuotaUsage,
  prepareUsageHistorySeries,
  quotaPercentUsed,
  usagePaceStatus,
  type CurrentUsageSummary,
  type UsageHistoryMetric,
  type UsageHistoryGraphMode,
  type UsageHistoryRange,
  type UsageStatus,
} from "./agents-usage-helpers"

const PROVIDER_IDS = ["codex", "anthropic", "cursor", "openrouter", "nanogpt"] as const
type ProviderId = (typeof PROVIDER_IDS)[number]
type UsageScope = "all-visible" | "flapstack-only"

const PROVIDER_LABELS: Record<ProviderId, string> = {
  codex: "Codex / OpenAI",
  anthropic: "Claude / Anthropic",
  cursor: "Cursor",
  openrouter: "OpenRouter",
  nanogpt: "NanoGPT",
}

const ALL_PROVIDERS = "__all_providers__"
const ALL_ACCOUNTS = "__all_accounts__"
const DEFAULT_ACCOUNT = "__default_account__"
const PAGE_SIZE = 25
const MAX_SAMPLE_LIMIT = 20_000
const MAX_CYCLE_LIMIT = 500
const MAX_ALERT_LIMIT = 200

const credentialFields = [
  { key: "openai.api_key", label: "OpenAI Admin API key" },
  { key: "anthropic.admin_key", label: "Anthropic Admin API key" },
  { key: "openrouter.api_key", label: "OpenRouter API key" },
  { key: "nanogpt.api_key", label: "NanoGPT API key" },
  { key: "cursor.api_key", label: "Cursor CLI API key" },
  { key: "cursor.access_token", label: "Cursor usage access token" },
  { key: "discord.webhook_url", label: "Discord webhook URL" },
] as const

function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId as ProviderId] ?? providerId
}

function formatMetricLabel(metricKey: string): string {
  return metricKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function accountFilterValue(accountTag: string | undefined): string {
  if (accountTag === undefined) return ALL_ACCOUNTS
  return accountTag === "" ? DEFAULT_ACCOUNT : accountTag
}

function accountTagFromFilter(value: string): string | undefined {
  if (value === ALL_ACCOUNTS) return undefined
  return value === DEFAULT_ACCOUNT ? "" : value
}

function isProviderErrorStatus(status: string): boolean {
  return [
    "auth-failed",
    "rate-limited",
    "source-unavailable",
    "not-installed",
    "not-logged-in",
  ].includes(status)
}

function InlineError({ label, message }: { label: string; message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
      <p className="text-xs font-medium text-destructive">{label}</p>
      <p className="mt-0.5 break-words text-xs text-destructive/90">{message}</p>
    </div>
  )
}

function PagingControls({
  loaded,
  limit,
  maximum,
  onLimitChange,
}: {
  loaded: number
  limit: number
  maximum: number
  onLimitChange: (limit: number) => void
}) {
  const mayHaveMore = loaded >= limit && limit < maximum
  if (!mayHaveMore && limit === PAGE_SIZE) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Showing {loaded.toLocaleString()} record{loaded === 1 ? "" : "s"}
        {limit === maximum ? ` (maximum ${maximum.toLocaleString()} loaded)` : ""}
      </span>
      <div className="flex items-center gap-2">
        {limit > PAGE_SIZE && (
          <button
            type="button"
            onClick={() => onLimitChange(PAGE_SIZE)}
            className="rounded border border-border px-2 py-1 hover:bg-foreground/5"
          >
            Show 25
          </button>
        )}
        {mayHaveMore && limit + PAGE_SIZE < maximum && (
          <button
            type="button"
            onClick={() => onLimitChange(Math.min(limit + PAGE_SIZE, maximum))}
            className="rounded border border-border px-2 py-1 hover:bg-foreground/5"
          >
            Show 25 more
          </button>
        )}
        {mayHaveMore && (
          <button
            type="button"
            onClick={() => onLimitChange(maximum)}
            className="rounded border border-border px-2 py-1 hover:bg-foreground/5"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "ok" ? "default" : status === "not-configured" ? "outline" : "secondary"
  return (
    <Badge variant={tone as "default" | "outline" | "secondary"} className="text-[11px]">
      {status}
    </Badge>
  )
}

const ONWATCH_QUOTA_COLORS: Record<string, string> = {
  five_hour: "#D97757",
  seven_day: "#10B981",
  seven_day_sonnet: "#3B82F6",
  code_review: "#3B82F6",
  monthly_limit: "#A855F7",
  extra_usage: "#F59E0B",
}
const ONWATCH_FALLBACK_COLORS = ["#14B8A6", "#EC4899", "#A855F7", "#F59E0B"]
const ONWATCH_COST_COLOR = "#14B8A6"
const ONWATCH_TOKENS_COLOR = "#38BDF8"

const USAGE_SEVERITY_COLORS = {
  healthy: {
    hex: "var(--usage-healthy)",
    bar: "bg-[var(--usage-healthy)]",
    text: "text-[var(--usage-healthy)]",
    badge: "bg-[var(--usage-healthy-bg)] text-[var(--usage-healthy)]",
  },
  underuse: {
    hex: "var(--usage-underuse)",
    bar: "bg-[var(--usage-underuse)]",
    text: "text-[var(--usage-underuse)]",
    badge: "bg-[var(--usage-underuse-bg)] text-[var(--usage-underuse)]",
  },
  very_underuse: {
    hex: "var(--usage-very-underuse)",
    bar: "bg-[var(--usage-very-underuse)]",
    text: "text-[var(--usage-very-underuse)]",
    badge: "bg-[var(--usage-very-underuse-bg)] text-[var(--usage-very-underuse)]",
  },
  warning: {
    hex: "var(--usage-warning)",
    bar: "bg-[var(--usage-warning)]",
    text: "text-[var(--usage-warning)]",
    badge: "bg-[var(--usage-warning-bg)] text-[var(--usage-warning)]",
  },
  danger: {
    hex: "var(--usage-danger)",
    bar: "bg-[var(--usage-danger)]",
    text: "text-[var(--usage-danger)]",
    badge: "bg-[var(--usage-danger-bg)] text-[var(--usage-danger)]",
  },
  critical: {
    hex: "var(--usage-critical)",
    bar: "bg-[var(--usage-critical)]",
    text: "text-[var(--usage-critical)]",
    badge: "bg-[var(--usage-critical-bg)] text-[var(--usage-critical)]",
  },
} as const

const HISTORY_RANGES: UsageHistoryRange[] = ["1h", "6h", "24h", "7d", "30d", "all"]
const CHART_WIDTH = 500
const CHART_HEIGHT = 116
const CHART_LEFT = 48
const CHART_RIGHT = 452
const CHART_TOP = 8
const CHART_BOTTOM = 88

function formatHistoryValue(metric: UsageHistoryMetric, value: number): string {
  if (metric === "quota") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  if (metric === "cost") {
    const digits = value > 0 && value < 0.0001 ? 6 : value > 0 && value < 0.01 ? 4 : 2
    return `$${value.toFixed(digits)}`
  }
  return Math.round(value).toLocaleString()
}

function smoothChartPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`
  return points.slice(1).reduce(
    (path, point, index) => {
      const previous = points[index]!
      const middleX = (previous.x + point.x) / 2
      return `${path} C ${middleX.toFixed(2)} ${previous.y.toFixed(2)}, ${middleX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    },
    `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`,
  )
}

function formatHistoryAxisTime(at: number, range: UsageHistoryRange, sameDay: boolean): string {
  const date = new Date(at)
  return sameDay || range === "1h" || range === "6h" || range === "24h"
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" })
}

function compactSeriesLabel(label: string, metric: UsageHistoryMetric): string {
  const technicalLabels = new Set([
    "default",
    "personal-oauth",
    "organization-cost",
    "organization-usage",
    "key-limits",
    "generation-total-cost",
    "generation-usage-cost",
    "generation-stats",
    "local-token-cost",
    "onwatch-cost-history",
  ])
  const parts = label
    .split(" · ")
    .slice(1)
    .filter(
      (part) =>
        !technicalLabels.has(part) &&
        !/^(?:codex|claude|openai|anthropic)-[a-f0-9]{8,}$/i.test(part),
    )
    .map(formatMetricLabel)
  return parts.join(" · ") || (metric === "quota" ? "Usage" : metric === "cost" ? "Cost" : "Tokens")
}

function onWatchSeriesColor(label: string, metric: UsageHistoryMetric, index: number): string {
  if (metric === "cost") return ONWATCH_COST_COLOR
  if (metric === "tokens") return ONWATCH_TOKENS_COLOR
  const normalized = label.toLowerCase()
  const match = Object.entries(ONWATCH_QUOTA_COLORS)
    .sort(([left], [right]) => right.length - left.length)
    .find(([key]) => normalized.includes(key))
  return match?.[1] ?? ONWATCH_FALLBACK_COLORS[index % ONWATCH_FALLBACK_COLORS.length]!
}

function nearestHistoryPoint<T extends { at: number }>(points: T[], target: number): T | null {
  return points.reduce<T | null>(
    (nearest, point) =>
      nearest == null || Math.abs(point.at - target) < Math.abs(nearest.at - target)
        ? point
        : nearest,
    null,
  )
}

function UsageHistoryChart({
  title,
  metric,
  rows,
  range,
  mode,
  secondaryMetric,
}: {
  title: string
  metric: UsageHistoryMetric
  rows: Parameters<typeof buildUsageHistorySeries>[0]
  range: UsageHistoryRange
  mode: UsageHistoryGraphMode
  secondaryMetric?: UsageHistoryMetric
}) {
  const gradientPrefix = useId().replace(/:/g, "")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set())
  const [hoveredAt, setHoveredAt] = useState<number | null>(null)
  const primaryRawSeries = useMemo(() => buildUsageHistorySeries(rows, metric), [metric, rows])
  const secondaryRawSeries = useMemo(
    () => (secondaryMetric ? buildUsageHistorySeries(rows, secondaryMetric) : []),
    [rows, secondaryMetric],
  )
  const series = useMemo(() => {
    const primary = prepareUsageHistorySeries(primaryRawSeries, metric, range, mode).map(
      (item) => ({
        ...item,
        key: `${metric}:${item.key}`,
        metric,
      }),
    )
    const secondary = secondaryMetric
      ? prepareUsageHistorySeries(secondaryRawSeries, secondaryMetric, range, mode).map((item) => ({
          ...item,
          key: `${secondaryMetric}:${item.key}`,
          metric: secondaryMetric,
        }))
      : []
    return [...primary, ...secondary]
  }, [metric, mode, primaryRawSeries, range, secondaryMetric, secondaryRawSeries])
  const allPoints = series.flatMap((item) => item.points)
  const minTime = allPoints.length > 0 ? Math.min(...allPoints.map((point) => point.at)) : 0
  const maxTime = allPoints.length > 0 ? Math.max(...allPoints.map((point) => point.at)) : 0
  const sameDay =
    allPoints.length > 0 && new Date(minTime).toDateString() === new Date(maxTime).toDateString()
  const maxForMetric = (targetMetric: UsageHistoryMetric) => {
    const observed = Math.max(
      0,
      ...series
        .filter((item) => item.metric === targetMetric)
        .flatMap((item) => item.points.map((point) => point.value)),
    )
    if (targetMetric === "quota" && mode === "cumulative") return 100
    if (targetMetric === "cost") return Math.max(0.000001, observed * 1.18)
    return Math.max(1, observed * 1.18)
  }
  const primaryMax = maxForMetric(metric)
  const secondaryMax = secondaryMetric ? maxForMetric(secondaryMetric) : null
  const chartSeries = series.map((item) => {
    const colorIndex = series.indexOf(item)
    const color = onWatchSeriesColor(item.label, item.metric, colorIndex)
    const axisMax = item.metric === secondaryMetric ? (secondaryMax ?? primaryMax) : primaryMax
    const points = item.points.map((point) => ({
      ...point,
      x:
        maxTime === minTime
          ? CHART_WIDTH / 2
          : CHART_LEFT + ((point.at - minTime) / (maxTime - minTime)) * (CHART_RIGHT - CHART_LEFT),
      y:
        CHART_BOTTOM - Math.min(1, Math.max(0, point.value / axisMax)) * (CHART_BOTTOM - CHART_TOP),
      color,
    }))
    return {
      ...item,
      color,
      gradientId: `${gradientPrefix}-series-${colorIndex}`,
      points,
      path: smoothChartPath(points),
    }
  })
  const visibleSeries = chartSeries.filter((item) => !hiddenSeries.has(item.key))
  const timeTicks = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5
    return {
      x: CHART_LEFT + ratio * (CHART_RIGHT - CHART_LEFT),
      at: minTime === maxTime ? minTime : minTime + ratio * (maxTime - minTime),
    }
  })
  const valueTicks = [1, 0.5, 0].map((ratio) => ({
    ratio,
    y: CHART_BOTTOM - ratio * (CHART_BOTTOM - CHART_TOP),
  }))
  const hoveredItems =
    hoveredAt == null
      ? []
      : visibleSeries.flatMap((item) => {
          const point = nearestHistoryPoint(item.points, hoveredAt)
          return point
            ? [{ ...point, label: item.label, metric: item.metric, color: item.color }]
            : []
        })
  const hoverX =
    hoveredAt == null || maxTime === minTime
      ? CHART_WIDTH / 2
      : CHART_LEFT + ((hoveredAt - minTime) / (maxTime - minTime)) * (CHART_RIGHT - CHART_LEFT)
  const toggleSeries = (key: string) => {
    setHoveredAt(null)
    setHiddenSeries((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const handleChartMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (allPoints.length === 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const chartX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * CHART_WIDTH
    const ratio = Math.min(1, Math.max(0, (chartX - CHART_LEFT) / (CHART_RIGHT - CHART_LEFT)))
    const targetAt = minTime + ratio * (maxTime - minTime)
    setHoveredAt(nearestHistoryPoint(allPoints, targetAt)?.at ?? null)
  }

  return (
    <div className="min-w-0 space-y-3 overflow-hidden rounded-xl border border-border bg-foreground/[0.025] p-5">
      <p className="text-xs font-medium text-foreground">{title}</p>
      {series.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {primaryRawSeries.length === 0 && secondaryRawSeries.length === 0
            ? "No historical data yet."
            : `No samples in the ${range} range.`}
        </div>
      ) : (
        <>
          <div className="relative min-h-64">
            {hoveredAt != null && hoveredItems.length > 0 && (
              <div
                className={`pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-[10px] text-popover-foreground shadow-lg ${
                  hoverX > CHART_WIDTH / 2 ? "-ml-2 -translate-x-full" : "ml-2"
                }`}
                style={{ left: `${(hoverX / CHART_WIDTH) * 100}%` }}
                aria-live="polite"
              >
                <p className="mb-1 font-medium">
                  {new Date(hoveredAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                {hoveredItems.map((item) => (
                  <p key={`${item.metric}:${item.label}`} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-muted-foreground">
                      {compactSeriesLabel(item.label, item.metric)}:
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatHistoryValue(item.metric, item.value)}
                    </span>
                  </p>
                ))}
              </div>
            )}
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${title}, ${mode}, ${range} history`}
              className="h-72 w-full"
              onMouseMove={handleChartMouseMove}
              onMouseLeave={() => setHoveredAt(null)}
            >
              <defs>
                {chartSeries.map((item) => (
                  <linearGradient key={item.key} id={item.gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={item.color} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={item.color} stopOpacity="0.01" />
                  </linearGradient>
                ))}
              </defs>
              <g className="text-muted-foreground">
                {valueTicks.map((tick) => (
                  <g key={tick.ratio}>
                    <line
                      x1={CHART_LEFT}
                      x2={CHART_RIGHT}
                      y1={tick.y}
                      y2={tick.y}
                      stroke="currentColor"
                      strokeOpacity="0.18"
                      strokeWidth="0.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={CHART_LEFT - 5}
                      y={tick.y + 1.5}
                      textAnchor="end"
                      fill="currentColor"
                      fontSize="3.4"
                    >
                      {formatHistoryValue(metric, primaryMax * tick.ratio)}
                    </text>
                    {secondaryMetric && secondaryMax != null && (
                      <text
                        x={CHART_RIGHT + 5}
                        y={tick.y + 1.5}
                        textAnchor="start"
                        fill="currentColor"
                        fontSize="3.4"
                      >
                        {formatHistoryValue(secondaryMetric, secondaryMax * tick.ratio)}
                      </text>
                    )}
                  </g>
                ))}
                {timeTicks.map((tick, index) => (
                  <g key={index}>
                    <line
                      x1={tick.x}
                      x2={tick.x}
                      y1={CHART_TOP}
                      y2={CHART_BOTTOM}
                      stroke="currentColor"
                      strokeOpacity="0.12"
                      strokeWidth="0.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={tick.x}
                      y="104"
                      textAnchor={index === 0 ? "start" : index === 5 ? "end" : "middle"}
                      fill="currentColor"
                      fontSize="3.4"
                    >
                      {formatHistoryAxisTime(tick.at, range, sameDay)}
                    </text>
                  </g>
                ))}
                <path
                  d={`M ${CHART_LEFT} ${CHART_TOP} V ${CHART_BOTTOM} H ${CHART_RIGHT}`}
                  stroke="currentColor"
                  strokeOpacity="0.35"
                  strokeWidth="0.7"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
              {visibleSeries.map((item) => {
                const first = item.points[0]
                const last = item.points[item.points.length - 1]
                return (
                  <g key={item.key}>
                    {first && last && item.points.length > 1 && (
                      <path
                        d={`${item.path} L ${last.x.toFixed(2)} ${CHART_BOTTOM} L ${first.x.toFixed(2)} ${CHART_BOTTOM} Z`}
                        fill={`url(#${item.gradientId})`}
                      />
                    )}
                    <path
                      d={item.path}
                      stroke={item.color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    {item.points.map((point, pointIndex) => (
                      <circle
                        key={`${point.at}-${pointIndex}`}
                        cx={point.x}
                        cy={point.y}
                        r="1.25"
                        fill={point.color}
                        stroke="currentColor"
                        strokeWidth="0.35"
                        tabIndex={0}
                        aria-label={`${item.label}: ${formatHistoryValue(item.metric, point.value)} at ${new Date(point.at).toLocaleString()}`}
                        onMouseEnter={() => setHoveredAt(point.at)}
                        onFocus={() => setHoveredAt(point.at)}
                        onBlur={() => setHoveredAt(null)}
                      />
                    ))}
                  </g>
                )
              })}
              {hoveredAt != null && (
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={CHART_TOP}
                  y2={CHART_BOTTOM}
                  stroke="currentColor"
                  strokeOpacity="0.65"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          {chartSeries.length > 1 && (
            <div className="flex flex-wrap gap-1.5" aria-label={`${title} series`}>
              {chartSeries.map((item) => {
                const visible = !hiddenSeries.has(item.key)
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={visible}
                    onClick={() => toggleSeries(item.key)}
                    className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] transition-opacity ${
                      visible ? "text-muted-foreground" : "opacity-40"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {compactSeriesLabel(item.label, item.metric)}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function formatCurrentCost(summary: CurrentUsageSummary): string | null {
  if (summary.costUsd != null && summary.costUsd > 0)
    return formatHistoryValue("cost", summary.costUsd)
  if (summary.costUsdEstimated != null && summary.costUsdEstimated > 0)
    return formatHistoryValue("cost", summary.costUsdEstimated)
  return null
}

function usageBarClass(status: UsageStatus): string {
  return USAGE_SEVERITY_COLORS[status].bar
}

function usageTextClass(status: UsageStatus): string {
  return USAGE_SEVERITY_COLORS[status].text
}

function usageBadgeClass(status: UsageStatus): string {
  return USAGE_SEVERITY_COLORS[status].badge
}

function hasDisplayableCurrentUsage(summary: CurrentUsageSummary): boolean {
  return (
    quotaPercentUsed(summary) != null ||
    formatCurrentCost(summary) != null ||
    (summary.totalTokens != null && summary.totalTokens > 0)
  )
}

function relativeTime(value: CurrentUsageSummary["capturedAt"]): string | null {
  const time = value == null ? 0 : new Date(value).getTime()
  if (!Number.isFinite(time) || time <= 0) return null
  const minutes = Math.round((time - Date.now()) / 60_000)
  const absoluteMinutes = Math.abs(minutes)
  if (absoluteMinutes < 1) return "just now"
  if (absoluteMinutes < 60)
    return minutes > 0 ? `in ${absoluteMinutes}m` : `${absoluteMinutes}m ago`
  const hours = Math.round(absoluteMinutes / 60)
  if (hours < 24) return minutes > 0 ? `in ${hours}h` : `${hours}h ago`
  const days = Math.round(hours / 24)
  return minutes > 0 ? `in ${days}d` : `${days}d ago`
}

function formatResetCountdown(value: CurrentUsageSummary["resetAt"], now: number): string | null {
  const resetAt = value == null ? 0 : new Date(value).getTime()
  if (!Number.isFinite(resetAt) || resetAt <= 0) return null
  const seconds = Math.floor((resetAt - now) / 1_000)
  if (seconds < 0) return "Resetting…"
  const totalHours = Math.floor(seconds / 3_600)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainingSeconds = seconds % 60
  if (days > 0 && hours > 0) return `${days}d ${hours}h`
  if (days > 0) return `${days}d ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return "< 1m"
}

function CurrentUsageCard({
  summary,
  detailed = false,
}: {
  summary: CurrentUsageSummary
  detailed?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!summary.resetAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [summary.resetAt])
  const percentUsed = quotaPercentUsed(summary)
  const pace =
    percentUsed == null
      ? null
      : usagePaceStatus(percentUsed, summary.metricKey, summary.resetAt, now)
  const metricLabel = summary.metricKey ? formatMetricLabel(summary.metricKey) : "Account usage"
  const cost = formatCurrentCost(summary)
  const tokens = summary.totalTokens?.toLocaleString() ?? null
  const countdown = formatResetCountdown(summary.resetAt, now)

  return (
    <article
      className={`border border-border/80 bg-background ${
        detailed ? "min-h-64 rounded-xl p-5" : "rounded-lg p-3"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`truncate font-medium text-foreground ${detailed ? "text-base" : "text-sm"}`}
          >
            {metricLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {summary.costQuality === "estimated" && (
            <span className="text-[10px] text-muted-foreground">Estimate</span>
          )}
          {countdown && (
            <span
              className="rounded-md border border-border bg-foreground/[0.045] px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground"
              title={
                summary.resetAt ? `Resets ${new Date(summary.resetAt).toLocaleString()}` : undefined
              }
            >
              {countdown}
            </span>
          )}
        </div>
      </div>

      {percentUsed != null ? (
        <div className={detailed ? "mt-6" : "mt-4"}>
          <div className={detailed ? "flex items-end justify-between gap-4" : ""}>
            <div>
              <span
                className={`${detailed ? "text-4xl" : "text-2xl"} font-semibold tabular-nums ${usageTextClass(pace!.status)}`}
              >
                {Math.round(percentUsed)}%
              </span>
              <span className={`${detailed ? "text-sm" : "text-xs"} ml-1 text-muted-foreground`}>
                used
              </span>
            </div>
            {detailed && (
              <div className="text-right">
                <p className="text-xl font-medium tabular-nums text-foreground">
                  {Math.round(100 - percentUsed)}%
                </p>
                <p className="text-[10px] text-muted-foreground">remaining</p>
              </div>
            )}
          </div>
          {detailed && pace?.paceApplied && pace.expectedUsed != null && (
            <p className="mt-4 text-xs text-muted-foreground">
              Pace target {pace.expectedUsed.toFixed(1)}% by now
            </p>
          )}
          <Progress
            value={percentUsed}
            aria-label={`${metricLabel}: ${Math.round(percentUsed)} percent used`}
            className={`${detailed ? "mt-2 h-2.5" : "mt-2 h-1.5"} bg-foreground/10`}
            indicatorClassName={usageBarClass(pace!.status)}
          />
          {detailed ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${usageBadgeClass(pace!.status)}`}
                title={pace!.label}
              >
                <span aria-hidden="true">
                  {pace!.status === "healthy"
                    ? "✓"
                    : pace!.status === "underuse" || pace!.status === "very_underuse"
                      ? "↓"
                      : "△"}
                </span>
                {pace!.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                Updated {relativeTime(summary.capturedAt) ?? "time not reported"}
              </span>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${usageBadgeClass(pace!.status)}`}
              >
                {pace!.shortLabel}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className={detailed ? "mt-6" : "mt-4"}>
          <p
            className={`${detailed ? "text-4xl" : "text-2xl"} font-semibold tabular-nums text-foreground`}
          >
            {cost ?? tokens ?? "-"}
          </p>
          <p className={`${detailed ? "mt-2 text-xs" : "mt-1 text-[10px]"} text-muted-foreground`}>
            {cost ? "spent" : tokens ? "tokens" : "No limit data"}
            {cost && tokens ? ` · ${tokens} tokens` : ""}
          </p>
          {detailed && (
            <div className="mt-5 border-t border-border/70 pt-4 text-xs text-muted-foreground">
              Updated {relativeTime(summary.capturedAt) ?? "time not reported"}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function AllProvidersOverview({
  summaries,
  onSelectProvider,
}: {
  summaries: CurrentUsageSummary[]
  onSelectProvider: (providerId: ProviderId) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {PROVIDER_IDS.map((providerId) => {
        const providerSummaries = summaries.filter((summary) => summary.providerId === providerId)
        return (
          <section
            key={providerId}
            className="overflow-hidden rounded-xl border border-border bg-foreground/[0.025]"
          >
            <button
              type="button"
              onClick={() => onSelectProvider(providerId)}
              className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left hover:bg-foreground/[0.035]"
            >
              <span className="text-sm font-semibold text-foreground">
                {providerLabel(providerId)}
              </span>
              <span className="text-[11px] text-muted-foreground">Details →</span>
            </button>
            <div
              className={`grid grid-cols-1 gap-3 p-3 ${
                providerSummaries.length > 1 ? "sm:grid-cols-2" : ""
              }`}
            >
              {providerSummaries.length > 0 ? (
                providerSummaries.map((summary) => (
                  <CurrentUsageCard
                    key={`${summary.providerId}|${summary.accountTag}|${summary.metricKey ?? ""}`}
                    summary={summary}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">No usage yet.</p>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function parseThresholdList(value: string): number[] {
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
}

export function AgentsUsageTab() {
  const utils = trpc.useUtils()
  const [providerFilter, setProviderFilter] = useState<ProviderId | typeof ALL_PROVIDERS>(
    ALL_PROVIDERS,
  )
  const [usageScope, setUsageScope] = useState<UsageScope>("all-visible")
  const [historyRange, setHistoryRange] = useState<UsageHistoryRange>("7d")
  const [historyMode, setHistoryMode] = useState<UsageHistoryGraphMode>("cumulative")
  const [accountFilter, setAccountFilter] = useState(ALL_ACCOUNTS)
  const [sampleLimit, setSampleLimit] = useState(PAGE_SIZE)
  const [cycleLimit, setCycleLimit] = useState(PAGE_SIZE)
  const [alertLimit, setAlertLimit] = useState(PAGE_SIZE)
  const selectedProvider = providerFilter === ALL_PROVIDERS ? undefined : providerFilter
  const selectedAccount = accountTagFromFilter(accountFilter)
  const queryFilter = { providerId: selectedProvider, accountTag: selectedAccount }
  const dashboardFilter = {
    ...queryFilter,
    flapstackOnly: selectedProvider && usageScope === "flapstack-only" ? true : undefined,
  }

  const capabilitiesQuery = trpc.usage.getCapabilities.useQuery()
  const statesQuery = trpc.usage.listProviderStates.useQuery()
  const settingsQuery = trpc.usage.getSettings.useQuery()
  const daemonQuery = trpc.usage.getDaemonStatus.useQuery(undefined, {
    refetchInterval: 5_000,
  })
  const samplesQuery = trpc.usage.listSamples.useQuery({ ...dashboardFilter, limit: sampleLimit })
  const historySamplesQuery = trpc.usage.listSamples.useQuery(
    { ...dashboardFilter, limit: MAX_SAMPLE_LIMIT },
    { enabled: selectedProvider != null },
  )
  const currentSamplesQuery = trpc.usage.listCurrentSamples.useQuery({
    ...dashboardFilter,
    limitPerAccount: 25,
  })
  const cyclesQuery = trpc.usage.listCycles.useQuery({ ...queryFilter, limit: cycleLimit })
  const alertEventsQuery = trpc.usage.listAlertEvents.useQuery({
    ...queryFilter,
    limit: alertLimit,
  })
  const secretPresenceQuery = trpc.usage.getSecretPresence.useQuery()
  const [secrets, setSecrets] = useState<Record<string, string>>({})

  const capabilities = capabilitiesQuery.data
  const states = statesQuery.data ?? []
  const settings = settingsQuery.data
  const daemon = daemonQuery.data
  const samples = samplesQuery.data ?? []
  const historySamples = historySamplesQuery.data ?? []
  const currentSamples = currentSamplesQuery.data ?? []
  const cycles = cyclesQuery.data ?? []
  const alertEvents = alertEventsQuery.data ?? []
  const secretPresence = secretPresenceQuery.data

  const refresh = trpc.usage.refresh.useMutation({
    onSettled: () => {
      void utils.usage.listProviderStates.invalidate()
      void utils.usage.listSamples.invalidate()
      void utils.usage.listCurrentSamples.invalidate()
      void utils.usage.listCycles.invalidate()
      void utils.usage.listAlertEvents.invalidate()
    },
  })
  const setProviderEnabled = trpc.usage.setProviderEnabled.useMutation({
    onSettled: () => void utils.usage.getSettings.invalidate(),
  })
  const setProviderSettings = trpc.usage.setProviderSettings.useMutation({
    onSettled: () => void utils.usage.getSettings.invalidate(),
  })
  const setSettings = trpc.usage.setSettings.useMutation({
    onSettled: () => void utils.usage.getSettings.invalidate(),
  })
  const setSecret = trpc.usage.setSecret.useMutation({
    onSettled: () => void utils.usage.getSecretPresence.invalidate(),
  })
  const installDaemon = trpc.usage.installDaemon.useMutation({
    onSettled: () => {
      void utils.usage.getDaemonStatus.invalidate()
      void utils.usage.getSettings.invalidate()
    },
  })
  const uninstallDaemon = trpc.usage.uninstallDaemon.useMutation({
    onSettled: () => {
      void utils.usage.getDaemonStatus.invalidate()
      void utils.usage.getSettings.invalidate()
    },
  })

  const accountOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const row of [...states, ...currentSamples, ...samples, ...cycles, ...alertEvents]) {
      if (selectedProvider && row.providerId !== selectedProvider) continue
      tags.add(row.accountTag ?? "")
    }
    return [...tags].sort((left, right) => {
      if (!left) return -1
      if (!right) return 1
      return left.localeCompare(right)
    })
  }, [alertEvents, currentSamples, cycles, samples, selectedProvider, states])

  const currentSummaries = useMemo(
    () =>
      buildCurrentUsageSummaries(
        currentSamples.filter((sample) => sample.sourceTag !== "onwatch-cost-history"),
      ).filter(hasDisplayableCurrentUsage),
    [currentSamples],
  )
  const visibleProviders = (capabilities?.providers ?? []).filter(
    (provider) => !selectedProvider || provider.id === selectedProvider,
  )
  const visibleStates = states.filter(
    (state) =>
      (!selectedProvider || state.providerId === selectedProvider) &&
      (selectedAccount === undefined || state.accountTag === selectedAccount),
  )
  const queryErrors = [
    { label: "Provider capabilities", error: capabilitiesQuery.error },
    { label: "Provider states", error: statesQuery.error },
    { label: "Usage settings", error: settingsQuery.error },
    { label: "Daemon status", error: daemonQuery.error },
    { label: "Current samples", error: samplesQuery.error },
    { label: "Usage history", error: historySamplesQuery.error },
    { label: "Current provider cards", error: currentSamplesQuery.error },
    { label: "Historical cycles", error: cyclesQuery.error },
    { label: "Alert history", error: alertEventsQuery.error },
    { label: "Credential status", error: secretPresenceQuery.error },
  ].flatMap((entry) => (entry.error ? [{ label: entry.label, message: entry.error.message }] : []))
  const operationErrors = [
    { label: "Provider setting", error: setProviderEnabled.error },
    { label: "Provider details", error: setProviderSettings.error },
    { label: "Usage setting", error: setSettings.error },
    { label: "Credential update", error: setSecret.error },
    { label: "Daemon install", error: installDaemon.error },
    { label: "Daemon removal", error: uninstallDaemon.error },
  ].flatMap((entry) => (entry.error ? [{ label: entry.label, message: entry.error.message }] : []))
  const refreshProviderErrors = refresh.data?.results.filter((result) => result.error) ?? []
  const refreshInserted =
    refresh.data?.results.reduce((total, result) => total + result.inserted, 0) ?? 0

  const resetPaging = () => {
    setSampleLimit(PAGE_SIZE)
    setCycleLimit(PAGE_SIZE)
    setAlertLimit(PAGE_SIZE)
  }

  const selectProvider = (value: string) => {
    setProviderFilter(value as ProviderId | typeof ALL_PROVIDERS)
    setUsageScope("all-visible")
    setAccountFilter(ALL_ACCOUNTS)
    resetPaging()
  }

  const detailUsageMetric: UsageHistoryMetric = historySamples.some(
    (sample) => sample.percentUsed != null,
  )
    ? "quota"
    : "tokens"

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Usage &amp; Limits</h3>
          <p className="text-xs text-muted-foreground">Limits and spend from connected accounts.</p>
        </div>
        <div>
          <button
            onClick={() => refresh.mutate(selectedProvider ? { providerId: selectedProvider } : {})}
            disabled={refresh.isPending}
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-foreground/5 disabled:opacity-50"
          >
            {refresh.isPending
              ? "Refreshing…"
              : selectedProvider
                ? `Refresh ${providerLabel(selectedProvider)}`
                : "Refresh now"}
          </button>
        </div>
      </div>

      {queryErrors.length > 0 && (
        <div className="space-y-2" aria-label="Usage query errors">
          {queryErrors.map((error) => (
            <InlineError
              key={error.label}
              label={`${error.label} could not load`}
              message={error.message}
            />
          ))}
        </div>
      )}

      {operationErrors.length > 0 && (
        <div className="space-y-2" aria-label="Usage setting errors">
          {operationErrors.map((error) => (
            <InlineError
              key={error.label}
              label={`${error.label} failed`}
              message={error.message}
            />
          ))}
        </div>
      )}

      {refresh.error && <InlineError label="Refresh failed" message={refresh.error.message} />}
      {!refresh.isPending && refresh.data && (
        <div
          role="status"
          className={`rounded-md border p-2 text-xs ${
            refreshProviderErrors.length > 0
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-foreground/[0.03] text-muted-foreground"
          }`}
        >
          <p className="font-medium">
            {refreshProviderErrors.length > 0
              ? "Refresh completed with provider errors."
              : `Refresh complete. ${refreshInserted.toLocaleString()} sample${refreshInserted === 1 ? "" : "s"} stored.`}
          </p>
          {refreshProviderErrors.map((result) => (
            <p key={result.providerId} className="mt-1 break-words">
              {providerLabel(result.providerId)}: {result.error}
            </p>
          ))}
          {refresh.data.limitedProviders.length > 0 && (
            <p className="mt-1">
              Limited history: {refresh.data.limitedProviders.map(providerLabel).join(", ")}. Only
              the latest provider-visible data can be recovered.
            </p>
          )}
        </div>
      )}

      <Tabs value={providerFilter} onValueChange={selectProvider}>
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border border-border bg-foreground/[0.035] p-1">
          <TabsTrigger value={ALL_PROVIDERS} className="shrink-0 text-xs">
            All
          </TabsTrigger>
          {PROVIDER_IDS.map((providerId) => (
            <TabsTrigger key={providerId} value={providerId} className="shrink-0 text-xs">
              {providerLabel(providerId)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selectedProvider && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label={`${providerLabel(selectedProvider)} usage scope`}
            className="inline-flex rounded-md border border-border bg-foreground/[0.035] p-1"
          >
            {(
              [
                ["all-visible", "All visible usage"],
                ["flapstack-only", "Flapstack only"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={usageScope === value}
                onClick={() => {
                  setUsageScope(value)
                  setAccountFilter(ALL_ACCOUNTS)
                  resetPaging()
                }}
                className={`rounded px-3 py-1.5 text-xs transition-colors ${
                  usageScope === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {accountOptions.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Account
              <select
                value={accountFilter}
                onChange={(event) => {
                  setAccountFilter(event.target.value)
                  resetPaging()
                }}
                className="rounded border border-border bg-background px-2 py-1 text-foreground"
              >
                <option value={ALL_ACCOUNTS}>All accounts</option>
                {accountOptions.map((accountTag) => (
                  <option
                    key={accountFilterValue(accountTag)}
                    value={accountFilterValue(accountTag)}
                  >
                    {accountLabel(accountTag)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {selectedProvider ? providerLabel(selectedProvider) : "Usage"}
          </h4>
          {!selectedProvider && (
            <p className="mt-1 text-xs text-muted-foreground">Usage by provider.</p>
          )}
        </div>
        {currentSamplesQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading current usage…</p>
        ) : currentSamplesQuery.error ? (
          <p className="text-xs text-destructive">Current usage is unavailable.</p>
        ) : currentSummaries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {selectedProvider && usageScope === "flapstack-only"
              ? "No Flapstack usage yet."
              : "No usage yet."}
          </p>
        ) : selectedProvider ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {currentSummaries.map((summary) => (
              <CurrentUsageCard
                key={`${summary.providerId}|${summary.accountTag}|${summary.metricKey ?? ""}`}
                summary={summary}
                detailed
              />
            ))}
          </div>
        ) : (
          <AllProvidersOverview summaries={currentSummaries} onSelectProvider={selectProvider} />
        )}
      </section>

      {selectedProvider && (
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">History</h4>
            <div className="flex flex-wrap gap-2">
              <div
                className="inline-flex rounded-md border border-border bg-background p-0.5"
                role="group"
                aria-label="History graph style"
              >
                {(["cumulative", "period"] as UsageHistoryGraphMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={historyMode === option}
                    onClick={() => setHistoryMode(option)}
                    className={`rounded px-2 py-1 text-[10px] transition-colors ${
                      historyMode === option
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option === "cumulative" ? "Cumulative" : "Per Period"}
                  </button>
                ))}
              </div>
              <div
                className="inline-flex rounded-md border border-border bg-background p-0.5"
                role="group"
                aria-label="History time range"
              >
                {HISTORY_RANGES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={historyRange === option}
                    onClick={() => setHistoryRange(option)}
                    className={`rounded px-1.5 py-1 text-[10px] uppercase transition-colors ${
                      historyRange === option
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option === "all" ? "All" : option}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {historySamplesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading history…</p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4">
              <UsageHistoryChart
                title={detailUsageMetric === "quota" ? "Usage (%)" : "Usage"}
                metric={detailUsageMetric}
                rows={historySamples}
                range={historyRange}
                mode={historyMode}
              />
              <UsageHistoryChart
                title="Token & Cost"
                metric="cost"
                secondaryMetric="tokens"
                rows={historySamples}
                range={historyRange}
                mode={historyMode}
              />
            </div>
          )}
        </section>
      )}

      <details className="group rounded-xl border border-border bg-foreground/[0.02]">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground hover:bg-foreground/[0.03]">
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground transition-transform group-open:rotate-90">
              ›
            </span>
            Monitoring, alerts &amp; raw data
          </span>
        </summary>
        <div className="space-y-6 border-t border-border p-4">
          {/* Global settings */}
          {settingsQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Loading usage settings…</p>
          )}
          {settings && (
            <div className="bg-background rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-xs text-muted-foreground">
                  Background daemon.{" "}
                  {daemon?.lastHeartbeatAt
                    ? `Last heartbeat ${new Date(daemon.lastHeartbeatAt).toLocaleString()}`
                    : "Not installed or no heartbeat yet."}
                </span>
                {capabilitiesQuery.isLoading ? (
                  <button
                    type="button"
                    disabled
                    className="text-xs px-2 py-1 rounded border border-border disabled:opacity-50"
                  >
                    Checking platform…
                  </button>
                ) : capabilities?.daemonInstall.supported ? (
                  <button
                    type="button"
                    disabled={installDaemon.isPending || uninstallDaemon.isPending}
                    onClick={() =>
                      settings.daemonEnabled ? uninstallDaemon.mutate() : installDaemon.mutate()
                    }
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-foreground/5 disabled:opacity-50"
                  >
                    {settings.daemonEnabled ? "Stop daemon" : "Install & start daemon"}
                  </button>
                ) : (
                  <span className="max-w-72 text-right text-xs text-muted-foreground">
                    Daemon install unavailable on{" "}
                    {capabilities?.daemonInstall.platform ?? "this platform"}.{" "}
                    {capabilities?.daemonInstall.note}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                <span>
                  Last poll:{" "}
                  {daemon?.lastPollAt ? new Date(daemon.lastPollAt).toLocaleString() : "-"}
                </span>
                <span>
                  Last alert:{" "}
                  {daemon?.lastAlertAt ? new Date(daemon.lastAlertAt).toLocaleString() : "-"}
                </span>
                <span className={daemon?.lastError ? "text-destructive" : ""}>
                  Error: {daemon?.lastError ?? "none"}
                </span>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">Discord webhook alerts</span>
                <input
                  type="checkbox"
                  checked={settings.discordAlertsEnabled}
                  onChange={(e) => setSettings.mutate({ discordAlertsEnabled: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">Poll cadence (seconds)</span>
                <input
                  type="number"
                  min={30}
                  defaultValue={settings.cadenceSeconds}
                  onBlur={(e) => setSettings.mutate({ cadenceSeconds: Number(e.target.value) })}
                  className="w-24 text-right bg-transparent border border-border rounded px-2 py-0.5"
                />
              </label>
            </div>
          )}

          <div className="bg-background rounded-lg border border-border p-4 space-y-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">Credentials</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Stored locally. Existing values are never displayed again.
              </p>
            </div>
            {secretPresenceQuery.isLoading && (
              <p className="text-xs text-muted-foreground">Checking configured credentials…</p>
            )}
            {secretPresenceQuery.error && (
              <p className="text-xs text-destructive">
                Credential presence is unavailable. Existing values cannot be identified right now.
              </p>
            )}
            <div className="space-y-2">
              {credentialFields.map((field) => {
                const configured =
                  secretPresence?.[field.key as keyof typeof secretPresence] ?? false
                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <label className="w-44 shrink-0 text-xs text-muted-foreground">
                      {field.label}
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={secrets[field.key] ?? ""}
                      placeholder={configured ? "Configured - enter to replace" : "Not configured"}
                      onChange={(event) =>
                        setSecrets((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      className="min-w-0 flex-1 bg-transparent border border-border rounded px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={!secrets[field.key] || setSecret.isPending}
                      onClick={() => {
                        setSecret.mutate({ key: field.key, value: secrets[field.key] })
                        setSecrets((current) => ({ ...current, [field.key]: "" }))
                      }}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-foreground/5 disabled:opacity-50"
                    >
                      Save
                    </button>
                    {configured && (
                      <button
                        type="button"
                        disabled={setSecret.isPending}
                        onClick={() => setSecret.mutate({ key: field.key, value: null })}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-foreground/5 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Provider cards */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Providers</h4>
            {capabilitiesQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading provider capabilities…</p>
            ) : capabilitiesQuery.error ? (
              <p className="text-xs text-destructive">Provider capabilities are unavailable.</p>
            ) : visibleProviders.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No provider matches the selected filter.
              </p>
            ) : (
              <div className="bg-background rounded-lg border border-border overflow-hidden">
                {visibleProviders.map((provider, index) => {
                  const providerStates = visibleStates.filter(
                    (state) => state.providerId === provider.id,
                  )
                  const providerSettings = settings?.providers?.[provider.id]
                  const enabled = providerSettings?.enabled ?? false
                  return (
                    <div
                      key={provider.id}
                      className={index === 0 ? "p-4" : "p-4 border-t border-border"}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {providerLabel(provider.id)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {provider.billingKind}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs">
                          <span className="text-muted-foreground">Enabled</span>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={!settings || setProviderEnabled.isPending}
                            aria-label={`Enable ${providerLabel(provider.id)} usage tracking`}
                            onChange={(e) =>
                              setProviderEnabled.mutate({
                                providerId: provider.id,
                                enabled: e.target.checked,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {statesQuery.isLoading ? (
                          <p className="text-xs text-muted-foreground">Loading provider state…</p>
                        ) : statesQuery.error ? (
                          <p className="text-xs text-destructive">Provider state is unavailable.</p>
                        ) : providerStates.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No provider state has been collected for the selected account.
                          </p>
                        ) : (
                          providerStates.map((state) => {
                            const hasError = isProviderErrorStatus(state.status)
                            return (
                              <div
                                key={state.id}
                                className={`rounded-md border p-2 ${
                                  hasError
                                    ? "border-destructive/40 bg-destructive/5"
                                    : "border-border/60 bg-foreground/[0.02]"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-foreground">
                                    {accountLabel(state.accountTag)}
                                  </span>
                                  <StatusBadge status={state.status} />
                                </div>
                                <p
                                  className={`mt-1 break-words text-xs ${
                                    hasError ? "text-destructive" : "text-muted-foreground"
                                  }`}
                                >
                                  {state.statusDetail ?? "No status detail was returned."}
                                </p>
                                {state.lastError && state.lastError !== state.statusDetail && (
                                  <p className="mt-1 break-words text-xs text-destructive">
                                    Last error: {state.lastError}
                                  </p>
                                )}
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Last poll:{" "}
                                  {state.lastPollAt
                                    ? new Date(state.lastPollAt).toLocaleString()
                                    : "never"}
                                </p>
                              </div>
                            )
                          })
                        )}
                      </div>
                      {providerSettings && (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
                          <label className="text-xs text-muted-foreground">
                            Poll seconds (blank = global)
                            <input
                              type="number"
                              min={30}
                              defaultValue={providerSettings.cadenceSecondsOverride ?? ""}
                              onBlur={(event) => {
                                const value = event.target.value.trim()
                                setProviderSettings.mutate({
                                  providerId: provider.id,
                                  cadenceSecondsOverride: value ? Number(value) : null,
                                })
                              }}
                              className="mt-1 w-full bg-transparent border border-border rounded px-2 py-1"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Quota alerts %
                            <input
                              defaultValue={providerSettings.thresholds.quotaPercent.join(", ")}
                              onBlur={(event) =>
                                setProviderSettings.mutate({
                                  providerId: provider.id,
                                  thresholds: {
                                    quotaPercent: parseThresholdList(event.target.value),
                                  },
                                })
                              }
                              className="mt-1 w-full bg-transparent border border-border rounded px-2 py-1"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Spend alerts USD
                            <input
                              defaultValue={providerSettings.thresholds.spendUsd.join(", ")}
                              onBlur={(event) =>
                                setProviderSettings.mutate({
                                  providerId: provider.id,
                                  thresholds: { spendUsd: parseThresholdList(event.target.value) },
                                })
                              }
                              className="mt-1 w-full bg-transparent border border-border rounded px-2 py-1"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Spend rate USD/hour
                            <input
                              type="number"
                              min={0}
                              step="any"
                              defaultValue={providerSettings.thresholds.spendRateUsdPerHour ?? ""}
                              onBlur={(event) => {
                                const value = event.target.value.trim()
                                setProviderSettings.mutate({
                                  providerId: provider.id,
                                  thresholds: {
                                    spendRateUsdPerHour: value ? Number(value) : null,
                                  },
                                })
                              }}
                              className="mt-1 w-full bg-transparent border border-border rounded px-2 py-1"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Spend spike multiplier
                            <input
                              type="number"
                              min={0}
                              step="any"
                              defaultValue={providerSettings.thresholds.spikeMultiplier ?? ""}
                              onBlur={(event) => {
                                const value = event.target.value.trim()
                                setProviderSettings.mutate({
                                  providerId: provider.id,
                                  thresholds: { spikeMultiplier: value ? Number(value) : null },
                                })
                              }}
                              className="mt-1 w-full bg-transparent border border-border rounded px-2 py-1"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Alert history</h4>
            {alertEventsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading usage alerts…</p>
            ) : alertEventsQuery.error ? (
              <p className="text-xs text-destructive">Alert history is unavailable.</p>
            ) : alertEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No usage alerts match the selected provider and account.
              </p>
            ) : (
              <div className="bg-background rounded-lg border border-border divide-y divide-border/50">
                {alertEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`p-2 text-xs ${
                      event.deliveryStatus === "failed" ? "text-destructive" : ""
                    }`}
                  >
                    <p>
                      <span className="font-medium">{providerLabel(event.providerId)}</span>
                      {" · "}
                      {accountLabel(event.accountTag)}
                      {" · "}
                      {event.alertType}
                      {" · "}
                      {event.deliveryStatus}
                    </p>
                    <p className="mt-0.5 break-words">{event.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {event.createdAt
                        ? new Date(event.createdAt).toLocaleString()
                        : "Time unavailable"}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {!alertEventsQuery.error && (
              <PagingControls
                loaded={alertEvents.length}
                limit={alertLimit}
                maximum={MAX_ALERT_LIMIT}
                onLimitChange={setAlertLimit}
              />
            )}
          </div>

          {/* Recent samples */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Recent samples</h4>
            {samplesQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading usage samples…</p>
            ) : samplesQuery.error ? (
              <p className="text-xs text-destructive">Usage samples are unavailable.</p>
            ) : samples.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No usage samples match the selected provider and account. Enable a provider and
                refresh to collect data.
              </p>
            ) : (
              <div className="bg-background rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left p-2">Provider</th>
                      <th className="text-left p-2">Account</th>
                      <th className="text-left p-2">Source</th>
                      <th className="text-left p-2">Cost</th>
                      <th className="text-left p-2">Quality</th>
                      <th className="text-left p-2">Tokens</th>
                      <th className="text-left p-2">Quota</th>
                      <th className="text-left p-2">Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((s) => (
                      <tr key={s.id} className="border-b border-border/50">
                        <td className="p-2">{providerLabel(s.providerId)}</td>
                        <td className="p-2">{accountLabel(s.accountTag)}</td>
                        <td className="p-2">{s.sourceTag ?? s.source}</td>
                        <td className="p-2">
                          {s.costUsd != null
                            ? `$${s.costUsd.toFixed(4)}`
                            : s.costUsdEstimated != null
                              ? `~$${s.costUsdEstimated.toFixed(4)}`
                              : "-"}
                        </td>
                        <td className="p-2">{s.costQuality}</td>
                        <td className="p-2">{s.totalTokens?.toLocaleString() ?? "-"}</td>
                        <td className="p-2">{formatQuotaUsage(s, "-")}</td>
                        <td className="p-2">
                          {s.capturedAt ? new Date(s.capturedAt).toLocaleString() : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!samplesQuery.error && (
              <PagingControls
                loaded={samples.length}
                limit={sampleLimit}
                maximum={MAX_SAMPLE_LIMIT}
                onLimitChange={setSampleLimit}
              />
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Historical cycles</h4>
            {cyclesQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading historical billing cycles…</p>
            ) : cyclesQuery.error ? (
              <p className="text-xs text-destructive">Historical billing cycles are unavailable.</p>
            ) : cycles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No historical billing cycles match the selected provider and account.
              </p>
            ) : (
              <div className="bg-background rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left p-2">Provider</th>
                      <th className="text-left p-2">Account</th>
                      <th className="text-left p-2">Window</th>
                      <th className="text-left p-2">Cost</th>
                      <th className="text-left p-2">Tokens</th>
                      <th className="text-left p-2">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.map((cycle) => (
                      <tr key={cycle.id} className="border-b border-border/50">
                        <td className="p-2">{providerLabel(cycle.providerId)}</td>
                        <td className="p-2">{accountLabel(cycle.accountTag)}</td>
                        <td className="p-2">
                          {cycle.cycleStart ? new Date(cycle.cycleStart).toLocaleDateString() : "-"}
                          {" → "}
                          {cycle.cycleEnd
                            ? new Date(cycle.cycleEnd).toLocaleDateString()
                            : "current"}
                        </td>
                        <td className="p-2">
                          {cycle.totalCostUsd != null
                            ? `$${cycle.totalCostUsd.toFixed(4)}`
                            : cycle.totalCostUsdEstimated != null
                              ? `~$${cycle.totalCostUsdEstimated.toFixed(4)}`
                              : "-"}
                        </td>
                        <td className="p-2">{cycle.totalTokens?.toLocaleString() ?? "-"}</td>
                        <td className="p-2">{cycle.costQuality}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!cyclesQuery.error && (
              <PagingControls
                loaded={cycles.length}
                limit={cycleLimit}
                maximum={MAX_CYCLE_LIMIT}
                onLimitChange={setCycleLimit}
              />
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
