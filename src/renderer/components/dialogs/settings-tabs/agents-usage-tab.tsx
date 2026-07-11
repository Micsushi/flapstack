// Stage 2 Track B — U11: Usage dashboard + settings tab.
//
// DB-first reads so the panel renders instantly before any refresh. Shows
// per-provider state, daemon health, samples, and settings toggles. Provider
// polling records explicit capability/error states rather than fake zero usage.

import { Badge } from "../../ui/badge"
import { trpc } from "../../../lib/trpc"
import { useMemo, useState } from "react"
import {
  accountLabel,
  buildCurrentUsageSummaries,
  buildUsageHistorySeries,
  formatQuotaUsage,
  type UsageHistoryMetric,
  type UsageHistorySeries,
} from "./agents-usage-helpers"

const PROVIDER_IDS = ["codex", "anthropic", "cursor", "openrouter", "nanogpt"] as const
type ProviderId = (typeof PROVIDER_IDS)[number]

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
const MAX_SAMPLE_LIMIT = 1_000
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

function DaemonHealthBadge({ health }: { health: string }) {
  return (
    <Badge
      variant={health === "running" ? "default" : health === "stale" ? "secondary" : "outline"}
      className="text-[11px]"
    >
      daemon: {health}
    </Badge>
  )
}

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#db2777",
]

function UsageHistoryChart({
  title,
  metric,
  rows,
}: {
  title: string
  metric: UsageHistoryMetric
  rows: Parameters<typeof buildUsageHistorySeries>[0]
}) {
  const series = buildUsageHistorySeries(rows, metric)
  if (series.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="mt-6 text-center text-xs text-muted-foreground">No historical data yet.</p>
      </div>
    )
  }
  const allPoints = series.flatMap((item) => item.points)
  const minTime = Math.min(...allPoints.map((point) => point.at))
  const maxTime = Math.max(...allPoints.map((point) => point.at))
  const maxValue = metric === "quota" ? 100 : Math.max(1, ...allPoints.map((point) => point.value))
  const pathFor = (item: UsageHistorySeries) =>
    item.points
      .map((point, index) => {
        const x = maxTime === minTime ? 50 : ((point.at - minTime) / (maxTime - minTime)) * 100
        const y = 100 - Math.min(100, Math.max(0, (point.value / maxValue) * 100))
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(" ")
  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <span className="text-[10px] text-muted-foreground">
          {new Date(minTime).toLocaleDateString()} – {new Date(maxTime).toLocaleDateString()}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${title} history`}
        className="h-36 w-full overflow-visible"
      >
        <path
          d="M 0 100 H 100 M 0 50 H 100 M 0 0 H 100"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="0.5"
          fill="none"
        />
        {series.map((item, index) => (
          <path
            key={item.key}
            d={pathFor(item)}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth="1.5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {series.map((item, index) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            {item.label}
          </span>
        ))}
      </div>
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
  const [accountFilter, setAccountFilter] = useState(ALL_ACCOUNTS)
  const [sampleLimit, setSampleLimit] = useState(PAGE_SIZE)
  const [cycleLimit, setCycleLimit] = useState(PAGE_SIZE)
  const [alertLimit, setAlertLimit] = useState(PAGE_SIZE)
  const selectedProvider = providerFilter === ALL_PROVIDERS ? undefined : providerFilter
  const selectedAccount = accountTagFromFilter(accountFilter)
  const queryFilter = { providerId: selectedProvider, accountTag: selectedAccount }

  const capabilitiesQuery = trpc.usage.getCapabilities.useQuery()
  const statesQuery = trpc.usage.listProviderStates.useQuery()
  const settingsQuery = trpc.usage.getSettings.useQuery()
  const daemonQuery = trpc.usage.getDaemonStatus.useQuery(undefined, {
    refetchInterval: 5_000,
  })
  const samplesQuery = trpc.usage.listSamples.useQuery({ ...queryFilter, limit: sampleLimit })
  const currentSamplesQuery = trpc.usage.listCurrentSamples.useQuery({
    ...queryFilter,
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
    () => buildCurrentUsageSummaries(currentSamples),
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Usage &amp; Limits</h3>
          <p className="text-xs text-muted-foreground">
            Background daemon polls supported provider sources and sends Discord alerts while
            Flapstack is closed. States show the actual available account, key-limit, or run-only
            data. Local Codex and Claude sessions add personal subscription quota windows when those
            private sources are available.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {daemon && <DaemonHealthBadge health={daemon.health} />}
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

      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">Dashboard filters</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Filters apply to current usage, provider states, alerts, samples, and billing cycles.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Provider
            <select
              value={providerFilter}
              onChange={(event) => {
                setProviderFilter(event.target.value as ProviderId | typeof ALL_PROVIDERS)
                setAccountFilter(ALL_ACCOUNTS)
                resetPaging()
              }}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-foreground"
            >
              <option value={ALL_PROVIDERS}>All providers</option>
              {PROVIDER_IDS.map((providerId) => (
                <option key={providerId} value={providerId}>
                  {providerLabel(providerId)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Account
            <select
              value={accountFilter}
              onChange={(event) => {
                setAccountFilter(event.target.value)
                resetPaging()
              }}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-foreground"
            >
              <option value={ALL_ACCOUNTS}>All accounts</option>
              {accountOptions.map((accountTag) => (
                <option key={accountFilterValue(accountTag)} value={accountFilterValue(accountTag)}>
                  {accountLabel(accountTag)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">Current usage</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest non-empty values from the loaded provider samples. Missing metrics stay blank.
          </p>
        </div>
        {currentSamplesQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading current usage…</p>
        ) : currentSamplesQuery.error ? (
          <p className="text-xs text-destructive">Current usage is unavailable.</p>
        ) : currentSummaries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No current usage matches these filters. Enable a provider and refresh to collect data.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {currentSummaries.map((summary) => {
              const cost =
                summary.costUsd != null
                  ? `$${summary.costUsd.toFixed(4)}`
                  : summary.costUsdEstimated != null
                    ? `~$${summary.costUsdEstimated.toFixed(4)}`
                    : "Not reported"
              const quota = formatQuotaUsage(summary)
              return (
                <div
                  key={`${summary.providerId}|${summary.accountTag}|${summary.metricKey ?? ""}`}
                  className="rounded-lg border border-border bg-background p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {providerLabel(summary.providerId)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {accountLabel(summary.accountTag)}
                        {summary.metricKey ? ` · ${formatMetricLabel(summary.metricKey)}` : ""}
                      </p>
                    </div>
                    {summary.costQuality && (
                      <Badge variant="outline" className="text-[10px]">
                        {summary.costQuality}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Cost</p>
                      <p className="mt-0.5 text-foreground">{cost}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tokens</p>
                      <p className="mt-0.5 text-foreground">
                        {summary.totalTokens?.toLocaleString() ?? "Not reported"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quota</p>
                      <p className="mt-0.5 text-foreground">{quota}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {summary.sourceTag ?? summary.source ?? "Unknown source"}
                    {summary.capturedAt
                      ? ` · ${new Date(summary.capturedAt).toLocaleString()}`
                      : " · capture time unavailable"}
                  </p>
                  {summary.resetAt && (
                    <p className="text-[11px] text-muted-foreground">
                      Resets {new Date(summary.resetAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <section className="space-y-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">Historical usage</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Provider/account history from local samples. Estimates remain separate in the raw table
            below.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <UsageHistoryChart title="Quota used" metric="quota" rows={samples} />
          <UsageHistoryChart title="Cost (USD)" metric="cost" rows={samples} />
          <UsageHistoryChart title="Tokens" metric="tokens" rows={samples} />
        </div>
      </section>

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
              Last poll: {daemon?.lastPollAt ? new Date(daemon.lastPollAt).toLocaleString() : "—"}
            </span>
            <span>
              Last alert:{" "}
              {daemon?.lastAlertAt ? new Date(daemon.lastAlertAt).toLocaleString() : "—"}
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
            const configured = secretPresence?.[field.key as keyof typeof secretPresence] ?? false
            return (
              <div key={field.key} className="flex items-center gap-2">
                <label className="w-44 shrink-0 text-xs text-muted-foreground">{field.label}</label>
                <input
                  type="password"
                  autoComplete="off"
                  value={secrets[field.key] ?? ""}
                  placeholder={configured ? "Configured — enter to replace" : "Not configured"}
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
          <p className="text-xs text-muted-foreground">No provider matches the selected filter.</p>
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
                              thresholds: { quotaPercent: parseThresholdList(event.target.value) },
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
            No usage samples match the selected provider and account. Enable a provider and refresh
            to collect data.
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
                          : "—"}
                    </td>
                    <td className="p-2">{s.costQuality}</td>
                    <td className="p-2">{s.totalTokens?.toLocaleString() ?? "—"}</td>
                    <td className="p-2">{formatQuotaUsage(s, "—")}</td>
                    <td className="p-2">
                      {s.capturedAt ? new Date(s.capturedAt).toLocaleString() : "—"}
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
                      {cycle.cycleStart ? new Date(cycle.cycleStart).toLocaleDateString() : "—"}
                      {" → "}
                      {cycle.cycleEnd ? new Date(cycle.cycleEnd).toLocaleDateString() : "current"}
                    </td>
                    <td className="p-2">
                      {cycle.totalCostUsd != null
                        ? `$${cycle.totalCostUsd.toFixed(4)}`
                        : cycle.totalCostUsdEstimated != null
                          ? `~$${cycle.totalCostUsdEstimated.toFixed(4)}`
                          : "—"}
                    </td>
                    <td className="p-2">{cycle.totalTokens?.toLocaleString() ?? "—"}</td>
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
  )
}
