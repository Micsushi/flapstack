// Stage 2 Track B - usage tracking settings (file-based, no Electron hard
// dependency so the daemon can read the same config). Mirrors the speech
// settings helper. Secrets (provider keys, Discord webhook URL) are NOT stored
// here - they live in the OS credential store; this file holds only non-secret
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

export interface UsageOrganizationSettings {
  openai: {
    /** Exact organization selected for Admin API requests. Admin polling stays
     * disabled until this selection is proven by the provider. */
    organizationId: string | null
    /** Empty means all projects. */
    projectIds: string[]
    /** Durable non-secret proof that this exact credential, organization, and
     * configured coverage were validated together. */
    validatedBinding: OpenAiValidatedOrganizationBinding | null
  }
  anthropic: {
    /** Exact organization expected from `/v1/organizations/me`. */
    organizationId: string | null
    /** Empty means all workspaces, including the default workspace. */
    workspaceIds: string[]
    /** Durable non-secret proof that this exact credential, organization, and
     * configured coverage were validated together. */
    validatedBinding: AnthropicValidatedOrganizationBinding | null
  }
}

export interface OpenAiValidatedOrganizationBinding {
  organizationId: string
  /** Stable one-way credential fingerprint, never the credential. */
  credentialTag: string
  validatedAt: string
  coverage: {
    selection: "all-projects" | "selected-projects"
    projectIds: string[]
  }
}

export interface AnthropicValidatedOrganizationBinding {
  organizationId: string
  /** Stable one-way credential fingerprint, never the credential. */
  credentialTag: string
  validatedAt: string
  coverage: {
    selection: "all-workspaces" | "selected-workspaces"
    workspaceIds: string[]
  }
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
  /** Non-secret Admin API scope selectors shared by the app and daemon. */
  organization: UsageOrganizationSettings
}

const defaultThresholds: UsageAlertThresholds = {
  quotaPercent: [80, 95],
  spendUsd: [],
  spendRateUsdPerHour: null,
  spikeMultiplier: null,
}

function defaultProviderSettings(): UsageProviderSettings {
  return {
    // Polling can make network requests and inspect local credentials, so it
    // stays opt-in.
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
  organization: {
    openai: { organizationId: null, projectIds: [], validatedBinding: null },
    anthropic: { organizationId: null, workspaceIds: [], validatedBinding: null },
  },
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
    organization: patch.organization ?? current.organization,
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
    organization: normalizeOrganizationSettings(raw.organization),
  }
}

export function invalidateOpenAiOrganizationBinding(credentialTag: string): boolean {
  const current = getUsageSettings()
  if (current.organization.openai.validatedBinding?.credentialTag !== credentialTag) return false
  setUsageSettings({
    organization: {
      ...current.organization,
      openai: {
        ...current.organization.openai,
        validatedBinding: null,
      },
    },
  })
  return true
}

export function invalidateAnthropicOrganizationBinding(credentialTag: string): boolean {
  const current = getUsageSettings()
  if (current.organization.anthropic.validatedBinding?.credentialTag !== credentialTag) return false
  setUsageSettings({
    organization: {
      ...current.organization,
      anthropic: {
        ...current.organization.anthropic,
        validatedBinding: null,
      },
    },
  })
  return true
}

export function resolveCadenceSeconds(
  settings: UsageSettings,
  providerId: UsageProviderId,
): number {
  return settings.providers[providerId]?.cadenceSecondsOverride ?? settings.cadenceSeconds
}

/** Fastest enabled provider cadence drives the daemon wake-up. The engine then
 * skips providers whose individual cadence has not elapsed. */
export function resolveSchedulerCadenceSeconds(settings: UsageSettings): number {
  const enabledCadences = USAGE_PROVIDER_IDS.filter((id) => settings.providers[id].enabled).map(
    (id) => resolveCadenceSeconds(settings, id),
  )
  return enabledCadences.length > 0 ? Math.min(...enabledCadences) : settings.cadenceSeconds
}

function sanitizeNumberList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]
  const out = value.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  )
  return out
}

function sanitizePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function normalizeOrganizationSettings(value: unknown): UsageOrganizationSettings {
  const organization = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const openai =
    organization.openai && typeof organization.openai === "object"
      ? (organization.openai as Record<string, unknown>)
      : {}
  const anthropic =
    organization.anthropic && typeof organization.anthropic === "object"
      ? (organization.anthropic as Record<string, unknown>)
      : {}
  return {
    openai: {
      organizationId: normalizedIdentity(openai.organizationId),
      projectIds: normalizedIdentityList(openai.projectIds),
      validatedBinding: normalizedOpenAiBinding(openai.validatedBinding, openai),
    },
    anthropic: {
      organizationId: normalizedIdentity(anthropic.organizationId),
      workspaceIds: normalizedIdentityList(anthropic.workspaceIds),
      validatedBinding: normalizedAnthropicBinding(anthropic.validatedBinding, anthropic),
    },
  }
}

function normalizedOpenAiBinding(
  value: unknown,
  configured: Record<string, unknown>,
): OpenAiValidatedOrganizationBinding | null {
  if (!value || typeof value !== "object") return null
  const binding = value as Record<string, unknown>
  const organizationId = normalizedIdentity(binding.organizationId)
  const credentialTag = normalizedIdentity(binding.credentialTag)
  const validatedAt =
    typeof binding.validatedAt === "string" && Number.isFinite(Date.parse(binding.validatedAt))
      ? new Date(binding.validatedAt).toISOString()
      : null
  const coverage =
    binding.coverage && typeof binding.coverage === "object"
      ? (binding.coverage as Record<string, unknown>)
      : {}
  const projectIds = normalizedIdentityList(coverage.projectIds)
  const selection =
    coverage.selection === "all-projects" || coverage.selection === "selected-projects"
      ? coverage.selection
      : null
  const configuredOrganizationId = normalizedIdentity(configured.organizationId)
  const configuredProjectIds = normalizedIdentityList(configured.projectIds)
  const expectedSelection = configuredProjectIds.length > 0 ? "selected-projects" : "all-projects"
  if (
    !organizationId ||
    !credentialTag ||
    !validatedAt ||
    !selection ||
    organizationId !== configuredOrganizationId ||
    selection !== expectedSelection ||
    projectIds.length !== configuredProjectIds.length ||
    projectIds.some((projectId, index) => projectId !== configuredProjectIds[index])
  ) {
    return null
  }
  return {
    organizationId,
    credentialTag,
    validatedAt,
    coverage: { selection, projectIds },
  }
}

function normalizedAnthropicBinding(
  value: unknown,
  configured: Record<string, unknown>,
): AnthropicValidatedOrganizationBinding | null {
  if (!value || typeof value !== "object") return null
  const binding = value as Record<string, unknown>
  const organizationId = normalizedIdentity(binding.organizationId)
  const credentialTag = normalizedIdentity(binding.credentialTag)
  const validatedAt =
    typeof binding.validatedAt === "string" && Number.isFinite(Date.parse(binding.validatedAt))
      ? new Date(binding.validatedAt).toISOString()
      : null
  const coverage =
    binding.coverage && typeof binding.coverage === "object"
      ? (binding.coverage as Record<string, unknown>)
      : {}
  const workspaceIds = normalizedIdentityList(coverage.workspaceIds)
  const selection =
    coverage.selection === "all-workspaces" || coverage.selection === "selected-workspaces"
      ? coverage.selection
      : null
  const configuredOrganizationId = normalizedIdentity(configured.organizationId)
  const configuredWorkspaceIds = normalizedIdentityList(configured.workspaceIds)
  const expectedSelection =
    configuredWorkspaceIds.length > 0 ? "selected-workspaces" : "all-workspaces"
  if (
    !organizationId ||
    !credentialTag ||
    !validatedAt ||
    !selection ||
    organizationId !== configuredOrganizationId ||
    selection !== expectedSelection ||
    workspaceIds.length !== configuredWorkspaceIds.length ||
    workspaceIds.some((workspaceId, index) => workspaceId !== configuredWorkspaceIds[index])
  ) {
    return null
  }
  return {
    organizationId,
    credentialTag,
    validatedAt,
    coverage: { selection, workspaceIds },
  }
}

function normalizedIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

function normalizedIdentityList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.flatMap((entry) => {
        const normalized = normalizedIdentity(entry)
        return normalized ? [normalized] : []
      }),
    ),
  ].sort()
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
