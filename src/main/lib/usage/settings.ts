// Stage 2 Track B — usage tracking settings (file-based, no Electron hard
// dependency so the daemon can read the same config). Mirrors the speech
// settings helper. Secrets (provider keys, Discord webhook URL) are NOT stored
// here — they live in the OS credential store; this file holds only non-secret
// config plus a boolean of whether a secret is present.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { USAGE_PROVIDER_IDS, type UsageProviderId } from "./types"

const require = createRequire(import.meta.url)
const configFileName = "usage-settings.json"

/** Alert thresholds are provider-kind specific; both blocks are optional. */
export interface UsageAlertThresholds {
  /** Subscription/quota: fire when percent-used crosses these values (0-100). */
  quotaPercent: number[]
  /** API-spend: dollar budget ceilings that trigger an alert. */
  spendUsd: number[]
  /** API-spend: alert when spend rate (USD/hour) exceeds this. */
  spendRateUsdPerHour: number | null
  /** API-spend: alert on a sudden spike (multiple of trailing average). */
  spikeMultiplier: number | null
}

export interface UsageProviderSettings {
  enabled: boolean
  /** Per-provider cadence override in seconds; null = use global cadence. */
  cadenceSecondsOverride: number | null
  thresholds: UsageAlertThresholds
}

export interface UsageSettings {
  /** Global default poll cadence. Default 5 minutes per S2.0. */
  cadenceSeconds: number
  /** Run the background daemon (poll while the app is closed). */
  daemonEnabled: boolean
  /** Start the daemon at login when enabled. */
  daemonStartAtLogin: boolean
  /** Send Discord webhook alerts from the daemon. */
  discordAlertsEnabled: boolean
  providers: Record<UsageProviderId, UsageProviderSettings>
}

const defaultThresholds: UsageAlertThresholds = {
  quotaPercent: [80, 95],
  spendUsd: [],
  spendRateUsdPerHour: null,
  spikeMultiplier: null,
}

function defaultProviderSettings(): UsageProviderSettings {
  return {
    enabled: false,
    cadenceSecondsOverride: null,
    thresholds: { ...defaultThresholds, quotaPercent: [...defaultThresholds.quotaPercent] },
  }
}

export const defaultUsageSettings: UsageSettings = {
  cadenceSeconds: 300,
  daemonEnabled: false,
  daemonStartAtLogin: false,
  discordAlertsEnabled: false,
  providers: Object.fromEntries(
    USAGE_PROVIDER_IDS.map((id) => [id, defaultProviderSettings()]),
  ) as Record<UsageProviderId, UsageProviderSettings>,
}

export function getUsageSettings(): UsageSettings {
  const configPath = getUsageSettingsPath()
  if (!existsSync(configPath)) return normalizeUsageSettings({})
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<UsageSettings>
    return normalizeUsageSettings(raw)
  } catch (error) {
    console.warn("[Usage] Failed to read usage settings:", error)
    return defaultUsageSettings
  }
}

export function setUsageSettings(patch: Partial<UsageSettings>): UsageSettings {
  const current = getUsageSettings()
  const next = normalizeUsageSettings({
    ...current,
    ...patch,
    // Provider settings are updated independently by the UI. A shallow merge
    // here would silently disable every provider except the one in a patch.
    providers: { ...current.providers, ...patch.providers },
  })
  const configPath = getUsageSettingsPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(next, null, 2))
  return next
}

export function normalizeUsageSettings(raw: Partial<UsageSettings>): UsageSettings {
  const providers = {} as Record<UsageProviderId, UsageProviderSettings>
  for (const id of USAGE_PROVIDER_IDS) {
    const p = raw.providers?.[id]
    providers[id] = {
      enabled: typeof p?.enabled === "boolean" ? p.enabled : false,
      cadenceSecondsOverride:
        typeof p?.cadenceSecondsOverride === "number" && p.cadenceSecondsOverride >= 30
          ? p.cadenceSecondsOverride
          : null,
      thresholds: {
        quotaPercent: sanitizeNumberList(
          p?.thresholds?.quotaPercent,
          defaultThresholds.quotaPercent,
        ),
        spendUsd: sanitizeNumberList(p?.thresholds?.spendUsd, []),
        spendRateUsdPerHour: sanitizePositive(p?.thresholds?.spendRateUsdPerHour),
        spikeMultiplier: sanitizePositive(p?.thresholds?.spikeMultiplier),
      },
    }
  }
  return {
    cadenceSeconds:
      typeof raw.cadenceSeconds === "number" && raw.cadenceSeconds >= 30 ? raw.cadenceSeconds : 300,
    daemonEnabled: typeof raw.daemonEnabled === "boolean" ? raw.daemonEnabled : false,
    daemonStartAtLogin:
      typeof raw.daemonStartAtLogin === "boolean" ? raw.daemonStartAtLogin : false,
    discordAlertsEnabled:
      typeof raw.discordAlertsEnabled === "boolean" ? raw.discordAlertsEnabled : false,
    providers,
  }
}

export function resolveCadenceSeconds(
  settings: UsageSettings,
  providerId: UsageProviderId,
): number {
  return settings.providers[providerId]?.cadenceSecondsOverride ?? settings.cadenceSeconds
}

function sanitizeNumberList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]
  const out = value.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  )
  return out.length > 0 ? out : [...fallback]
}

function sanitizePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function getUsageSettingsPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) return join(overrideDir, configFileName)
  return join(getElectronUserDataPath(), "data", configFileName)
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return userDataPath
  } catch {
    // Daemon / tests can run outside Electron.
  }
  return join(process.cwd(), ".flapstack")
}
