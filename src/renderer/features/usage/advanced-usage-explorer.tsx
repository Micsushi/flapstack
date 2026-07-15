import { useMemo, useReducer, useState, type FormEvent } from "react"
import type {
  UsageBudgetAction,
  UsageBudgetReset,
  UsageBudgetScope,
  UsageRollupQuality,
  UsageRollupScope,
} from "../../../shared/advanced-usage"
import { usageBudgetCreateSchema, usageRollupQuerySchema } from "../../../shared/advanced-usage"
import type { UsageExplorerMetric } from "../../../shared/advanced-usage-explorer"
import { trpc } from "../../lib/trpc"
import {
  ADVANCED_USAGE_A11Y,
  advancedUsageExplorerReducer,
  formatExplorerMetric,
  initialAdvancedUsageExplorerState,
  insightCopy,
  qualityCopy,
  splitUsageFilter,
} from "./advanced-usage-model"

const QUALITY_VALUES = ["exact", "provider-reported", "estimated", "unknown"] as const
const SOURCE_CLASS_VALUES = [
  "provider-account-total",
  "flapstack-run",
  "external-provider",
  "unknown",
] as const

type FilterDraft = {
  scopeType: UsageRollupScope["type"]
  scopeId: string
  scopeProviderId: string
  scopeAccountTag: string
  providerIds: string
  accountTags: string
  harnesses: string
  models: string
  sources: string
  qualities: UsageRollupQuality[]
  sourceClasses: (typeof SOURCE_CLASS_VALUES)[number][]
  from: string
  to: string
}

type BudgetDraft = {
  id: string | null
  expectedVersion: number | null
  name: string
  enabled: boolean
  scopeType: UsageBudgetScope["type"]
  scopeId: string
  providerId: string
  accountTag: string
  thresholdType: "cost-usd-micros" | "total-tokens" | "request-count" | "quota-percent-micros"
  thresholdValue: string
  action: UsageBudgetAction
  resetType: UsageBudgetReset["type"]
  timezone: string
}

export function AdvancedUsageExplorer() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const [state, dispatch] = useReducer(advancedUsageExplorerReducer, undefined, () =>
    initialAdvancedUsageExplorerState(Date.now(), timezone),
  )
  const [filters, setFilters] = useState<FilterDraft>(() => filterDraft(state.query))
  const [savedViewName, setSavedViewName] = useState("")
  const [includeRedactedRawPayload, setIncludeRedactedRawPayload] = useState(false)
  const [budget, setBudget] = useState<BudgetDraft>(() => emptyBudget(timezone))
  const utils = trpc.useUtils()

  const explorer = trpc.usage.queryExplorer.useQuery(state.query)
  const insight = trpc.usage.queryInsights.useQuery({
    rollup: { ...state.query, bucket: "none", groupBy: "none", cursor: null, limit: 500 },
    metric: state.metric,
  })
  const views = trpc.usage.listExplorerViews.useQuery()
  const budgets = trpc.usage.listBudgets.useQuery({ enabledOnly: false })
  const saveView = trpc.usage.saveExplorerView.useMutation({
    onSuccess: (view) => {
      dispatch({ type: "saved", view })
      setSavedViewName(view.name)
      void utils.usage.listExplorerViews.invalidate()
    },
  })
  const deleteView = trpc.usage.deleteExplorerView.useMutation({
    onSuccess: () => {
      dispatch({ type: "deleted-view" })
      setSavedViewName("")
      void utils.usage.listExplorerViews.invalidate()
    },
  })
  const createBudget = trpc.usage.createBudget.useMutation({
    onSuccess: () => budgetSaved("Budget created."),
  })
  const updateBudget = trpc.usage.updateBudget.useMutation({
    onSuccess: () => budgetSaved("Budget updated."),
  })
  const deleteBudget = trpc.usage.deleteBudget.useMutation({
    onSuccess: () => budgetSaved("Budget deleted."),
  })
  const exportUsage = trpc.usage.exportAdvancedUsage.useMutation({
    onSuccess: (result) => {
      downloadText(result.filename, result.mimeType, result.content)
      dispatch({
        type: "message",
        message: `Exported ${result.factCount} filtered facts; raw payload ${result.rawPayloadPolicy}.`,
      })
    },
  })

  const result = explorer.data
  const rollup = result?.rollup
  const selectedAggregate =
    state.selectedAggregateKey === "totals"
      ? rollup?.totals
      : rollup?.items.find((item) => item.key === state.selectedAggregateKey)
  const selectedFactIds = new Set(selectedAggregate?.factIds ?? [])
  const selectedFacts = (result?.facts ?? []).filter((fact) => selectedFactIds.has(fact.id))
  const chartMax = Math.max(
    1,
    ...(rollup?.items.map((item) => metricValue(item.metrics, state.metric) ?? 0) ?? []),
  )
  const selectedQuality = selectedAggregate?.quality ?? "unknown"
  const selectedQualityCopy = qualityCopy(selectedQuality)

  function budgetSaved(message: string) {
    setBudget(emptyBudget(timezone))
    dispatch({ type: "message", message })
    void utils.usage.listBudgets.invalidate()
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    const scope = rollupScope(filters)
    const parsed = usageRollupQuerySchema.parse({
      ...state.query,
      scope,
      providerIds: splitUsageFilter(filters.providerIds),
      accountTags: splitUsageFilter(filters.accountTags),
      harnesses: splitUsageFilter(filters.harnesses),
      models: splitUsageFilter(filters.models),
      sources: splitUsageFilter(filters.sources),
      qualities: filters.qualities.length ? filters.qualities : undefined,
      sourceClasses: filters.sourceClasses.length ? filters.sourceClasses : undefined,
      fromMs: filters.from ? new Date(filters.from).getTime() : undefined,
      toMs: filters.to ? new Date(filters.to).getTime() : undefined,
      cursor: null,
    })
    dispatch({ type: "query", query: parsed })
  }

  function setTimePreset(days: number | null) {
    const toMs = Date.now()
    const next = {
      ...filters,
      from: days === null ? "" : localDateTime(toMs - days * 24 * 60 * 60 * 1_000),
      to: days === null ? "" : localDateTime(toMs),
    }
    setFilters(next)
  }

  function loadView(id: string) {
    if (!id) {
      dispatch({ type: "new-view" })
      setSavedViewName("")
      return
    }
    const view = views.data?.find((item) => item.id === id)
    if (!view) return
    dispatch({ type: "load-view", view })
    setFilters(filterDraft(view.query))
    setSavedViewName(view.name)
  }

  function submitBudget(event: FormEvent) {
    event.preventDefault()
    const definition = usageBudgetCreateSchema.parse({
      name: budget.name,
      enabled: budget.enabled,
      scope: budgetScope(budget),
      threshold: budgetThreshold(budget),
      action: budget.action,
      reset: budgetReset(budget),
    })
    if (budget.id && budget.expectedVersion) {
      updateBudget.mutate({ id: budget.id, expectedVersion: budget.expectedVersion, ...definition })
    } else {
      createBudget.mutate(definition)
    }
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-foreground/[0.02] p-4"
      aria-label={ADVANCED_USAGE_A11Y.explorer}
      data-dev-usage-section="advanced-explorer"
    >
      <div>
        <h4 className="text-sm font-semibold text-foreground">Advanced explorer</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Aggregates reconcile to normalized facts. Estimated and unknown values remain explicit.
        </p>
      </div>

      <form
        onSubmit={applyFilters}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
        aria-label={ADVANCED_USAGE_A11Y.filters}
      >
        <FilterSelect
          label="Scope"
          value={filters.scopeType}
          options={[
            "global",
            "provider-account",
            "project",
            "task",
            "chat",
            "automation",
            "orchestration",
            "run",
          ]}
          onChange={(scopeType) =>
            setFilters({ ...filters, scopeType: scopeType as FilterDraft["scopeType"] })
          }
        />
        {filters.scopeType === "provider-account" ? (
          <>
            <FilterInput
              label="Scope provider"
              required
              value={filters.scopeProviderId}
              onChange={(scopeProviderId) => setFilters({ ...filters, scopeProviderId })}
            />
            <FilterInput
              label="Scope account"
              value={filters.scopeAccountTag}
              onChange={(scopeAccountTag) => setFilters({ ...filters, scopeAccountTag })}
            />
          </>
        ) : filters.scopeType !== "global" ? (
          <FilterInput
            label="Scope ID"
            required
            value={filters.scopeId}
            onChange={(scopeId) => setFilters({ ...filters, scopeId })}
          />
        ) : null}
        <FilterInput
          label="Providers"
          hint="Comma separated"
          value={filters.providerIds}
          onChange={(providerIds) => setFilters({ ...filters, providerIds })}
        />
        <FilterInput
          label="Accounts"
          hint="Comma separated"
          value={filters.accountTags}
          onChange={(accountTags) => setFilters({ ...filters, accountTags })}
        />
        <FilterInput
          label="Harnesses"
          hint="Comma separated"
          value={filters.harnesses}
          onChange={(harnesses) => setFilters({ ...filters, harnesses })}
        />
        <FilterInput
          label="Models"
          hint="Comma separated"
          value={filters.models}
          onChange={(models) => setFilters({ ...filters, models })}
        />
        <FilterInput
          label="Sources"
          hint="Comma separated"
          value={filters.sources}
          onChange={(sources) => setFilters({ ...filters, sources })}
        />
        <fieldset className="space-y-1 text-xs">
          <legend className="text-muted-foreground">Quality</legend>
          <div className="flex flex-wrap gap-2">
            {QUALITY_VALUES.map((quality) => (
              <CheckFilter
                key={quality}
                label={quality}
                checked={filters.qualities.includes(quality)}
                onChange={() =>
                  setFilters({
                    ...filters,
                    qualities: toggleValue(filters.qualities, quality),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1 text-xs md:col-span-2">
          <legend className="text-muted-foreground">Source class</legend>
          <div className="flex flex-wrap gap-2">
            {SOURCE_CLASS_VALUES.map((sourceClass) => (
              <CheckFilter
                key={sourceClass}
                label={sourceClass}
                checked={filters.sourceClasses.includes(sourceClass)}
                onChange={() =>
                  setFilters({
                    ...filters,
                    sourceClasses: toggleValue(filters.sourceClasses, sourceClass),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        <FilterInput
          label="From"
          type="datetime-local"
          value={filters.from}
          onChange={(from) => setFilters({ ...filters, from })}
        />
        <FilterInput
          label="To"
          type="datetime-local"
          value={filters.to}
          onChange={(to) => setFilters({ ...filters, to })}
        />
        <div className="flex items-end gap-1">
          {[7, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setTimePreset(days)}
              className="rounded border border-border px-2 py-1 text-xs"
            >
              {days}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTimePreset(null)}
            className="rounded border border-border px-2 py-1 text-xs"
          >
            All time
          </button>
        </div>
        <FilterSelect
          label="Group by"
          value={state.query.groupBy}
          options={[
            "none",
            "provider-account",
            "project",
            "task",
            "chat",
            "automation",
            "orchestration",
            "run",
            "harness",
            "model",
            "source",
            "source-class",
            "quality",
          ]}
          onChange={(groupBy) =>
            dispatch({
              type: "query",
              query: usageRollupQuerySchema.parse({ ...state.query, groupBy, cursor: null }),
            })
          }
        />
        <FilterSelect
          label="Time bucket"
          value={state.query.bucket}
          options={["none", "hour", "day", "week", "month"]}
          onChange={(bucket) =>
            dispatch({
              type: "query",
              query: usageRollupQuerySchema.parse({ ...state.query, bucket, cursor: null }),
            })
          }
        />
        <FilterSelect
          label="Metric"
          value={state.metric}
          options={["cost-usd-micros", "total-tokens", "request-count"]}
          onChange={(metric) => dispatch({ type: "metric", metric: metric as UsageExplorerMetric })}
        />
        <button
          type="submit"
          className="rounded border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-foreground/5"
        >
          Apply filters
        </button>
      </form>

      <div className="flex flex-wrap items-end gap-2 rounded border border-border bg-background p-3">
        <FilterSelect
          label="Saved views"
          value={state.selectedViewId ?? ""}
          options={["", ...(views.data?.map((view) => view.id) ?? [])]}
          optionLabel={(id) => views.data?.find((view) => view.id === id)?.name ?? "New view"}
          onChange={loadView}
        />
        <FilterInput label="View name" value={savedViewName} onChange={setSavedViewName} />
        <button
          type="button"
          disabled={!savedViewName.trim() || saveView.isPending}
          onClick={() =>
            saveView.mutate({
              id: state.selectedViewId,
              name: savedViewName,
              query: state.query,
              metric: state.metric,
            })
          }
          className="rounded border border-border px-2 py-1.5 text-xs disabled:opacity-50"
        >
          Save view
        </button>
        <button
          type="button"
          disabled={!state.selectedViewId || deleteView.isPending}
          onClick={() => state.selectedViewId && deleteView.mutate({ id: state.selectedViewId })}
          className="rounded border border-border px-2 py-1.5 text-xs disabled:opacity-50"
        >
          Delete view
        </button>
      </div>

      {explorer.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading filtered aggregates…</p>
      ) : explorer.error ? (
        <p role="alert" className="text-xs text-destructive">
          Explorer query failed: {explorer.error.message}
        </p>
      ) : rollup ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => dispatch({ type: "aggregate", key: "totals" })}
              aria-pressed={state.selectedAggregateKey === "totals"}
              className="rounded border border-border bg-background p-3 text-left"
            >
              <span className="block text-xs text-muted-foreground">Filtered total</span>
              <span className="block text-lg font-semibold">
                {truthfulMetric(rollup.totals.metrics, state.metric, rollup.totals.quality)}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {qualityCopy(rollup.totals.quality).label} · {rollup.totals.factIds.length} facts
              </span>
            </button>
            <div className="rounded border border-border bg-background p-3 md:col-span-2">
              <p className="text-xs font-medium">Reconciliation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {rollup.reconciliation.rawFactCount} raw facts ·{" "}
                {rollup.reconciliation.contributingFactCount} contributing ·{" "}
                {rollup.reconciliation.suppressedMetricCount} overlapping metrics suppressed
              </p>
            </div>
          </div>

          <div
            className="space-y-2 rounded border border-border bg-background p-3"
            role="group"
            aria-label={ADVANCED_USAGE_A11Y.chart}
          >
            {rollup.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No grouped aggregates match.</p>
            ) : (
              rollup.items.map((item) => {
                const value = metricValue(item.metrics, state.metric) ?? 0
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => dispatch({ type: "aggregate", key: item.key })}
                    aria-label={`Show ${item.factIds.length} supporting facts for ${item.label ?? item.value}: ${truthfulMetric(item.metrics, state.metric, item.quality)}`}
                    aria-pressed={state.selectedAggregateKey === item.key}
                    className="grid w-full grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-2 text-left text-xs"
                  >
                    <span className="truncate">{item.label ?? item.value}</span>
                    <span className="h-3 rounded bg-foreground/5">
                      <span
                        className="block h-3 rounded bg-foreground/40"
                        style={{ width: `${Math.max(2, (value / chartMax) * 100)}%` }}
                      />
                    </span>
                    <span>{truthfulMetric(item.metrics, state.metric, item.quality)}</span>
                  </button>
                )
              })
            )}
          </div>

          <div className="overflow-x-auto rounded border border-border bg-background">
            <table className="w-full text-xs" aria-label={ADVANCED_USAGE_A11Y.table}>
              <caption className="sr-only">
                Every aggregate includes a supporting-facts action.
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="p-2 text-left">
                    Aggregate
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Value
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Quality
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Provenance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rollup.items.map((item) => (
                  <tr key={item.key} className="border-b border-border/50">
                    <th scope="row" className="p-2 text-left font-normal">
                      {item.label ?? item.value}
                    </th>
                    <td className="p-2">
                      {truthfulMetric(item.metrics, state.metric, item.quality)}
                    </td>
                    <td className="p-2">{qualityCopy(item.quality).label}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "aggregate", key: item.key })}
                        className="underline underline-offset-2"
                      >
                        Show {item.factIds.length} facts
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div
        className="rounded border border-border bg-background p-3"
        aria-label={ADVANCED_USAGE_A11Y.insights}
      >
        <p className="text-xs font-medium">Insight quality</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {insight.data
            ? insightCopy(insight.data)
            : insight.error
              ? "Insight unavailable."
              : "Loading insight…"}
        </p>
      </div>

      <div className="space-y-2" aria-label={ADVANCED_USAGE_A11Y.facts} aria-live="polite">
        <div>
          <h5 className="text-xs font-medium">Supporting facts and provenance</h5>
          <p className="text-xs text-muted-foreground">
            {selectedQualityCopy.label}: {selectedQualityCopy.description}
          </p>
        </div>
        {selectedFacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No contributing facts for this aggregate.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-background">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Raw normalized facts supporting the selected aggregate.
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="p-2 text-left">
                    Fact
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Provider / account
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Source
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Value
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Quality / estimate inputs
                  </th>
                  <th scope="col" className="p-2 text-left">
                    Attribution
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedFacts.map((fact) => (
                  <tr key={fact.id} className="border-b border-border/50 align-top">
                    <th scope="row" className="p-2 text-left font-mono font-normal">
                      {fact.id}
                    </th>
                    <td className="p-2">
                      {fact.providerId} / {fact.accountTag || "default"}
                    </td>
                    <td className="p-2">
                      {fact.source} · {fact.sourceClass}
                    </td>
                    <td className="p-2">
                      {truthfulMetric(fact.metrics, state.metric, fact.quality)}
                    </td>
                    <td className="p-2">
                      {qualityCopy(fact.quality).label}
                      {fact.quality === "estimated" && (
                        <span className="block text-muted-foreground">
                          Pricing {fact.provenance.pricingVersion ?? "version unavailable"}; exact
                          cost unavailable.
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {fact.attribution.projectName ??
                        fact.attribution.projectId ??
                        "Unknown project"}
                      {fact.attribution.taskName ? ` · ${fact.attribution.taskName}` : ""}
                      {fact.attribution.runId ? ` · run ${fact.attribution.runId}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="rounded border border-border bg-background p-3">
        <summary className="cursor-pointer text-xs font-medium">Scoped budgets</summary>
        <div className="mt-3 space-y-3" aria-label={ADVANCED_USAGE_A11Y.budgets}>
          <form onSubmit={submitBudget} className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <FilterInput
              label="Budget name"
              required
              value={budget.name}
              onChange={(name) => setBudget({ ...budget, name })}
            />
            <FilterSelect
              label="Budget scope"
              value={budget.scopeType}
              options={[
                "global",
                "provider-account",
                "project",
                "task",
                "automation",
                "orchestration",
              ]}
              onChange={(scopeType) => {
                const nextScope = scopeType as BudgetDraft["scopeType"]
                const providerAccount = nextScope === "provider-account"
                setBudget({
                  ...budget,
                  scopeType: nextScope,
                  action: providerAccount ? "soft-alert" : budget.action,
                  thresholdType:
                    !providerAccount && budget.thresholdType === "quota-percent-micros"
                      ? "cost-usd-micros"
                      : budget.thresholdType,
                  resetType:
                    providerAccount && !["none", "provider-cycle"].includes(budget.resetType)
                      ? "none"
                      : !providerAccount && budget.resetType === "provider-cycle"
                        ? "none"
                        : budget.resetType,
                })
              }}
            />
            {budget.scopeType === "provider-account" ? (
              <>
                <FilterInput
                  label="Provider"
                  required
                  value={budget.providerId}
                  onChange={(providerId) => setBudget({ ...budget, providerId })}
                />
                <FilterInput
                  label="Account"
                  value={budget.accountTag}
                  onChange={(accountTag) => setBudget({ ...budget, accountTag })}
                />
              </>
            ) : budget.scopeType !== "global" ? (
              <FilterInput
                label="Scope ID"
                required
                value={budget.scopeId}
                onChange={(scopeId) => setBudget({ ...budget, scopeId })}
              />
            ) : null}
            <FilterSelect
              label="Threshold"
              value={budget.thresholdType}
              options={
                budget.scopeType === "provider-account"
                  ? ["cost-usd-micros", "total-tokens", "request-count", "quota-percent-micros"]
                  : ["cost-usd-micros", "total-tokens", "request-count"]
              }
              onChange={(thresholdType) =>
                setBudget({
                  ...budget,
                  thresholdType: thresholdType as BudgetDraft["thresholdType"],
                })
              }
            />
            <FilterInput
              label={
                budget.thresholdType === "cost-usd-micros"
                  ? "Limit USD"
                  : budget.thresholdType === "quota-percent-micros"
                    ? "Limit percent"
                    : "Limit"
              }
              type="number"
              required
              value={budget.thresholdValue}
              onChange={(thresholdValue) => setBudget({ ...budget, thresholdValue })}
            />
            <FilterSelect
              label="Action"
              value={budget.action}
              options={
                budget.scopeType === "provider-account"
                  ? ["soft-alert"]
                  : ["soft-alert", "hard-stop"]
              }
              onChange={(action) => setBudget({ ...budget, action: action as UsageBudgetAction })}
            />
            <FilterSelect
              label="Reset"
              value={budget.resetType}
              options={
                budget.scopeType === "provider-account"
                  ? ["none", "provider-cycle"]
                  : ["none", "daily", "weekly", "monthly"]
              }
              onChange={(resetType) =>
                setBudget({ ...budget, resetType: resetType as BudgetDraft["resetType"] })
              }
            />
            <CheckFilter
              label="Enabled"
              checked={budget.enabled}
              onChange={() => setBudget({ ...budget, enabled: !budget.enabled })}
            />
            <button type="submit" className="rounded border border-border px-2 py-1.5 text-xs">
              {budget.id ? "Update budget" : "Create budget"}
            </button>
            {budget.id && (
              <button
                type="button"
                onClick={() => setBudget(emptyBudget(timezone))}
                className="rounded border border-border px-2 py-1.5 text-xs"
              >
                Cancel edit
              </button>
            )}
          </form>
          <ul className="divide-y divide-border rounded border border-border text-xs">
            {(budgets.data ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>
                  {item.name} · {item.scope.type} · {item.action} ·{" "}
                  {item.enabled ? "enabled" : "disabled"}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setBudget(editBudget(item, timezone))}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      deleteBudget.mutate({ id: item.id, expectedVersion: item.version })
                    }
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <div
        className="flex flex-wrap items-center gap-2 rounded border border-border bg-background p-3"
        aria-label={ADVANCED_USAGE_A11Y.exports}
      >
        <CheckFilter
          label="Include redacted raw payload"
          checked={includeRedactedRawPayload}
          onChange={() => setIncludeRedactedRawPayload(!includeRedactedRawPayload)}
        />
        {(["csv", "json"] as const).map((format) => (
          <button
            key={format}
            type="button"
            disabled={exportUsage.isPending}
            onClick={() =>
              exportUsage.mutate({ query: state.query, format, includeRedactedRawPayload })
            }
            className="rounded border border-border px-2 py-1.5 text-xs uppercase disabled:opacity-50"
          >
            Export {format}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">
          Credentials are never exported. Raw payload is omitted or redacted.
        </span>
      </div>

      {(state.statusMessage ||
        saveView.error ||
        exportUsage.error ||
        createBudget.error ||
        updateBudget.error ||
        deleteBudget.error) && (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {saveView.error?.message ??
            exportUsage.error?.message ??
            createBudget.error?.message ??
            updateBudget.error?.message ??
            deleteBudget.error?.message ??
            state.statusMessage}
        </p>
      )}
    </section>
  )
}

function FilterInput({
  label,
  hint,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string
  hint?: string
  value: string
  onChange(value: string): void
  type?: string
  required?: boolean
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      {hint ? ` · ${hint}` : ""}
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
      />
    </label>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  optionLabel = (option) => option,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange(value: string): void
  optionLabel?: (option: string) => string
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
      >
        {options.map((option) => (
          <option key={option || "empty"} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

function CheckFilter({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange(): void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  )
}

function filterDraft(query: ReturnType<typeof usageRollupQuerySchema.parse>): FilterDraft {
  return {
    scopeType: query.scope.type,
    scopeId: "id" in query.scope ? query.scope.id : "",
    scopeProviderId: query.scope.type === "provider-account" ? query.scope.providerId : "",
    scopeAccountTag: query.scope.type === "provider-account" ? query.scope.accountTag : "",
    providerIds: query.providerIds?.join(", ") ?? "",
    accountTags: query.accountTags?.join(", ") ?? "",
    harnesses: query.harnesses?.join(", ") ?? "",
    models: query.models?.join(", ") ?? "",
    sources: query.sources?.join(", ") ?? "",
    qualities: query.qualities ?? [],
    sourceClasses: query.sourceClasses ?? [],
    from: query.fromMs === undefined ? "" : localDateTime(query.fromMs),
    to: query.toMs === undefined ? "" : localDateTime(query.toMs),
  }
}

function rollupScope(filters: FilterDraft): UsageRollupScope {
  if (filters.scopeType === "global") return { type: "global" }
  if (filters.scopeType === "provider-account") {
    return {
      type: "provider-account",
      providerId: filters.scopeProviderId,
      accountTag: filters.scopeAccountTag,
    }
  }
  return { type: filters.scopeType, id: filters.scopeId } as UsageRollupScope
}

function emptyBudget(timezone: string): BudgetDraft {
  return {
    id: null,
    expectedVersion: null,
    name: "",
    enabled: false,
    scopeType: "global",
    scopeId: "",
    providerId: "",
    accountTag: "",
    thresholdType: "cost-usd-micros",
    thresholdValue: "",
    action: "soft-alert",
    resetType: "none",
    timezone,
  }
}

function budgetScope(draft: BudgetDraft): UsageBudgetScope {
  if (draft.scopeType === "global") return { type: "global" }
  if (draft.scopeType === "provider-account")
    return {
      type: "provider-account",
      providerId: draft.providerId,
      accountTag: draft.accountTag || null,
    }
  const key =
    draft.scopeType === "project"
      ? "projectId"
      : draft.scopeType === "task"
        ? "taskId"
        : draft.scopeType === "automation"
          ? "automationId"
          : "orchestrationId"
  return { type: draft.scopeType, [key]: draft.scopeId } as UsageBudgetScope
}

function budgetThreshold(draft: BudgetDraft) {
  const raw = Number(draft.thresholdValue)
  const value =
    draft.thresholdType === "cost-usd-micros"
      ? Math.round(raw * 1_000_000)
      : draft.thresholdType === "quota-percent-micros"
        ? Math.round(raw * 1_000_000)
        : Math.round(raw)
  return { type: draft.thresholdType, value }
}

function budgetReset(draft: BudgetDraft): UsageBudgetReset {
  if (draft.resetType === "none" || draft.resetType === "provider-cycle")
    return { type: draft.resetType }
  return { type: draft.resetType, timezone: draft.timezone }
}

function editBudget(
  item: {
    id: string
    version: number
    name: string
    enabled: boolean
    scope: UsageBudgetScope
    threshold: { type: BudgetDraft["thresholdType"]; value: number }
    action: UsageBudgetAction
    reset: UsageBudgetReset
  },
  timezone: string,
): BudgetDraft {
  const scopeId =
    "projectId" in item.scope
      ? item.scope.projectId
      : "taskId" in item.scope
        ? item.scope.taskId
        : "automationId" in item.scope
          ? item.scope.automationId
          : "orchestrationId" in item.scope
            ? item.scope.orchestrationId
            : ""
  const divisor =
    item.threshold.type === "cost-usd-micros" || item.threshold.type === "quota-percent-micros"
      ? 1_000_000
      : 1
  return {
    id: item.id,
    expectedVersion: item.version,
    name: item.name,
    enabled: item.enabled,
    scopeType: item.scope.type,
    scopeId,
    providerId: item.scope.type === "provider-account" ? item.scope.providerId : "",
    accountTag: item.scope.type === "provider-account" ? (item.scope.accountTag ?? "") : "",
    thresholdType: item.threshold.type,
    thresholdValue: String(item.threshold.value / divisor),
    action: item.action,
    resetType: item.reset.type,
    timezone: "timezone" in item.reset ? item.reset.timezone : timezone,
  }
}

function metricValue(
  metrics: {
    costUsdMicros: number | null
    costUsdEstimatedMicros: number | null
    totalTokens: number | null
    requestCount: number | null
  },
  metric: UsageExplorerMetric,
): number | null {
  if (metric === "total-tokens") return metrics.totalTokens
  if (metric === "request-count") return metrics.requestCount
  const values = [metrics.costUsdMicros, metrics.costUsdEstimatedMicros].filter(
    (value): value is number => value !== null,
  )
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function truthfulMetric(
  metrics: Parameters<typeof metricValue>[0],
  metric: UsageExplorerMetric,
  quality: UsageRollupQuality,
): string {
  const formatted = formatExplorerMetric(metricValue(metrics, metric), metric)
  return quality === "estimated"
    ? `Approximately ${formatted}`
    : quality === "unknown"
      ? `${formatted} (unknown quality)`
      : formatted
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function localDateTime(value: number): string {
  const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function downloadText(filename: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
