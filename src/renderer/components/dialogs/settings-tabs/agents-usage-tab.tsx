// Stage 2 Track B — U11: Usage dashboard + settings tab.
//
// DB-first reads so the panel renders instantly before any refresh. Shows
// per-provider state, daemon health, samples, and settings toggles. Provider
// polling records explicit capability/error states rather than fake zero usage.

import { Badge } from "../../ui/badge"
import { trpc } from "../../../lib/trpc"
import { useState } from "react"

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex / OpenAI",
  anthropic: "Claude / Anthropic",
  cursor: "Cursor",
  openrouter: "OpenRouter",
  nanogpt: "NanoGPT",
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

function parseThresholdList(value: string): number[] {
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
}

export function AgentsUsageTab() {
  const utils = trpc.useUtils()
  const { data: capabilities } = trpc.usage.getCapabilities.useQuery()
  const { data: states = [] } = trpc.usage.listProviderStates.useQuery()
  const { data: settings } = trpc.usage.getSettings.useQuery()
  const { data: daemon } = trpc.usage.getDaemonStatus.useQuery()
  const { data: samples = [] } = trpc.usage.listSamples.useQuery({ limit: 25 })
  const { data: alertEvents = [] } = trpc.usage.listAlertEvents.useQuery({ limit: 25 })
  const { data: secretPresence } = trpc.usage.getSecretPresence.useQuery()
  const [secrets, setSecrets] = useState<Record<string, string>>({})

  const refresh = trpc.usage.refresh.useMutation({
    onSettled: () => {
      void utils.usage.listProviderStates.invalidate()
      void utils.usage.listSamples.invalidate()
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

  const credentialFields = [
    { key: "openai.api_key", label: "OpenAI API key" },
    { key: "anthropic.admin_key", label: "Anthropic Admin API key" },
    { key: "openrouter.api_key", label: "OpenRouter API key" },
    { key: "nanogpt.api_key", label: "NanoGPT API key" },
    { key: "discord.webhook_url", label: "Discord webhook URL" },
  ]

  const stateByProvider = new Map(states.map((s) => [s.providerId, s]))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Usage &amp; Limits</h3>
          <p className="text-xs text-muted-foreground">
            Replaces onWatch. Background daemon polls providers and sends Discord alerts while
            Flapstack is closed. States show the actual available account, key-limit, or run-only
            data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {daemon && <DaemonHealthBadge health={daemon.health} />}
          <button
            onClick={() => refresh.mutate({})}
            disabled={refresh.isPending}
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-foreground/5 disabled:opacity-50"
          >
            {refresh.isPending ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {/* Global settings */}
      {settings && (
        <div className="bg-background rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-xs text-muted-foreground">
              Background daemon.{" "}
              {daemon?.lastHeartbeatAt
                ? `Last heartbeat ${new Date(daemon.lastHeartbeatAt).toLocaleString()}`
                : "Not installed or no heartbeat yet."}
            </span>
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
          </div>
          {(installDaemon.error || uninstallDaemon.error) && (
            <p className="text-xs text-destructive">
              {installDaemon.error?.message ?? uninstallDaemon.error?.message}
            </p>
          )}
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
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {(capabilities?.providers ?? []).map((provider, index) => {
            const state = stateByProvider.get(provider.id)
            const providerSettings = settings?.providers?.[provider.id]
            const enabled = providerSettings?.enabled ?? false
            return (
              <div key={provider.id} className={index === 0 ? "p-4" : "p-4 border-t border-border"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {PROVIDER_LABELS[provider.id] ?? provider.id}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {provider.billingKind}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {state?.statusDetail ?? "No samples collected yet."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={state?.status ?? "not-configured"} />
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        setProviderEnabled.mutate({
                          providerId: provider.id,
                          enabled: e.target.checked,
                        })
                      }
                    />
                  </div>
                </div>
                {providerSettings && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Alert history</h4>
        {alertEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No usage alerts sent yet.</p>
        ) : (
          <div className="bg-background rounded-lg border border-border divide-y divide-border/50">
            {alertEvents.map((event) => (
              <div key={event.id} className="p-2 text-xs">
                <span className="font-medium">
                  {PROVIDER_LABELS[event.providerId] ?? event.providerId}
                </span>
                {" · "}
                {event.deliveryStatus}
                {" · "}
                {event.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent samples */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Recent samples</h4>
        {samples.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No usage samples yet. Enable a provider and refresh, or start the daemon.
          </p>
        ) : (
          <div className="bg-background rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left p-2">Provider</th>
                  <th className="text-left p-2">Source</th>
                  <th className="text-left p-2">Cost</th>
                  <th className="text-left p-2">Quality</th>
                  <th className="text-left p-2">Captured</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="p-2">{PROVIDER_LABELS[s.providerId] ?? s.providerId}</td>
                    <td className="p-2">{s.source}</td>
                    <td className="p-2">
                      {s.costUsd != null
                        ? `$${s.costUsd.toFixed(4)}`
                        : s.costUsdEstimated != null
                          ? `~$${s.costUsdEstimated.toFixed(4)}`
                          : "—"}
                    </td>
                    <td className="p-2">{s.costQuality}</td>
                    <td className="p-2">
                      {s.capturedAt ? new Date(s.capturedAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
