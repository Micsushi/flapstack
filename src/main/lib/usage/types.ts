// Stage 2 Track B — shared usage tracking types.
// These types are the contract shared by the usage engine (app + daemon),
// provider adapters, the SQLite store, and the alert evaluator. Keep this file
// free of Electron / renderer imports so the daemon can import it standalone.

/** Providers Flapstack tracks usage for. Stage 2 (S2.0) scope only. */
export const USAGE_PROVIDER_IDS = ["codex", "anthropic", "cursor", "openrouter", "nanogpt"] as const
export type UsageProviderId = (typeof USAGE_PROVIDER_IDS)[number]

/** Where a sample came from. Never fabricate historical detail from a current
 * aggregate — pick the honest origin instead. */
export const SAMPLE_SOURCES = [
  "daemon-poll",
  "app-poll",
  "startup-reconcile",
  "flapstack-run",
  "external-provider",
] as const
export type SampleSource = (typeof SAMPLE_SOURCES)[number]

/** How trustworthy the cost figure on a sample is. */
export const COST_QUALITIES = ["exact", "provider-reported", "estimated", "unknown"] as const
export type CostQuality = (typeof COST_QUALITIES)[number]

/** Honest provider health. Drives dashboard badges and alert suppression. */
export const PROVIDER_STATUSES = [
  "not-configured",
  "ok",
  "auth-failed",
  "rate-limited",
  "source-unavailable",
  "run-usage-only",
  "estimate-only",
  "not-installed",
  "not-logged-in",
] as const
export type ProviderStatusKind = (typeof PROVIDER_STATUSES)[number]

/** Subscription/quota providers vs pay-as-you-go API-spend providers. Alert
 * copy and threshold kinds differ between the two. */
export type ProviderBillingKind = "subscription-quota" | "api-spend"

/** A normalized usage observation. Mirrors the `usage_samples` table but uses
 * plain numbers/Dates; the store maps cost to integer micro-dollars. */
export interface UsageSampleInput {
  providerId: UsageProviderId
  accountTag?: string | null
  source: SampleSource
  costQuality: CostQuality
  sourceTag?: string | null
  capturedAt?: Date
  windowStart?: Date | null
  windowEnd?: Date | null
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  totalTokens?: number | null
  requestCount?: number | null
  /** Exact / provider-reported cost in USD. */
  costUsd?: number | null
  /** Derived estimate in USD when exact cost is unavailable. */
  costUsdEstimated?: number | null
  currency?: string
  percentUsed?: number | null
  quotaUsed?: number | null
  quotaLimit?: number | null
  quotaUnit?: "provider-native" | "usd-micros" | null
  resetAt?: Date | null
  model?: string | null
  generationId?: string | null
  runId?: string | null
  /** Raw provider payload for drift debugging. MUST NOT contain credentials. */
  rawPayload?: unknown
  /** Optional explicit dedupe key. When omitted the store derives one. */
  dedupeKey?: string
}

/** Current status snapshot a provider reports via getStatus(). */
export interface ProviderStatus {
  providerId: UsageProviderId
  accountTag?: string | null
  status: ProviderStatusKind
  detail?: string
  configured: boolean
  supportsDaemon: boolean
  supportsHistorical: boolean
}

/** Context passed to provider methods. Providers read credentials/settings via
 * the resolver rather than reaching into Electron directly, so the daemon works. */
export interface UsageProviderContext {
  now: Date
  /** Origin to tag produced samples with (daemon vs app vs reconcile). */
  source: SampleSource
  /** Reads a stored credential/setting value for the provider. Returns null when
   * unset. Credential storage lives outside this module. */
  getSecret(key: string): Promise<string | null>
  /** Stored provider generation ids that still lack exact reconciled cost.
   * Optional so provider adapters remain easy to test in isolation. */
  getPendingGenerationIds?(providerId: UsageProviderId, limit?: number): Promise<string[]>
  markGenerationReconciliation?(
    providerId: UsageProviderId,
    generationId: string,
    state: "retry" | "unavailable" | "resolved",
    detail?: string,
  ): Promise<void>
  /** Structured logger; must never receive raw secrets. */
  log: (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void
}

/**
 * One provider adapter. Each Stage 2 provider (codex, anthropic, cursor,
 * openrouter, nanogpt) implements this. Scaffolds return honest
 * not-implemented / not-configured states rather than fabricated zeros.
 */
export interface UsageProvider {
  readonly id: UsageProviderId
  readonly label: string
  readonly billingKind: ProviderBillingKind
  /** True when credentials/config make this provider pollable. */
  isConfigured(ctx: UsageProviderContext): Promise<boolean>
  /** Current health + capability snapshot. */
  getStatus(ctx: UsageProviderContext): Promise<ProviderStatus>
  /** Poll the latest available usage/cost. Returns [] when nothing new. */
  pollLatest(ctx: UsageProviderContext): Promise<UsageSampleInput[]>
  /** Reconcile usage since a timestamp (historical providers only). Providers
   * without history should return pollLatest()'s current aggregate and set an
   * honest status instead of inventing per-window rows. */
  reconcileSince(ctx: UsageProviderContext, since: Date | null): Promise<UsageSampleInput[]>
  /** Can this provider be polled by the background daemon? */
  supportsDaemon(): boolean
  /** Does this provider expose historical reconciliation? */
  supportsHistorical(): boolean
}

/** Thrown by scaffolded provider paths that are not implemented yet. Callers
 * (engine) catch this and record a `source-unavailable` status — never a zero
 * sample. */
export class UsageNotImplementedError extends Error {
  constructor(
    public readonly providerId: UsageProviderId,
    public readonly capability: string,
  ) {
    super(
      `Usage provider "${providerId}" capability "${capability}" is scaffolded, not implemented`,
    )
    this.name = "UsageNotImplementedError"
  }
}

/** A provider reached a real source but could not complete a poll. The engine
 * persists this explicit health state instead of flattening auth/rate errors
 * into an unhelpful generic unavailable status. */
export class UsageProviderError extends Error {
  constructor(
    public readonly providerId: UsageProviderId,
    public readonly status: Extract<
      ProviderStatusKind,
      "auth-failed" | "rate-limited" | "source-unavailable"
    >,
    message: string,
  ) {
    super(message)
    this.name = "UsageProviderError"
  }
}
