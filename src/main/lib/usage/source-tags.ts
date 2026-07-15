// Stage 2 Track B - sample origin tags, cost quality helpers, and the
// deterministic dedupe-key derivation that keeps daemon/app overlap from
// double-counting usage.

import type { CostQuality, SampleSource, UsageProviderId, UsageSampleInput } from "./types"

/** Cost is persisted as integer micro-dollars ($1 = 1_000_000) to avoid float
 * drift when summing many small run costs. */
export const MICROS_PER_USD = 1_000_000

export function usdToMicros(usd: number | null | undefined): number | null {
  if (usd == null || !Number.isFinite(usd)) return null
  return Math.round(usd * MICROS_PER_USD)
}

export function microsToUsd(micros: number | null | undefined): number | null {
  if (micros == null || !Number.isFinite(micros)) return null
  return micros / MICROS_PER_USD
}

/** Estimated cost is strictly weaker than any provider-reported figure. Use
 * this when merging samples so an estimate never overrides an exact value. */
export function isStrongerCostQuality(a: CostQuality, b: CostQuality): boolean {
  const rank: Record<CostQuality, number> = {
    exact: 3,
    "provider-reported": 2,
    estimated: 1,
    unknown: 0,
  }
  return rank[a] > rank[b]
}

/** Samples that came from active polling (daemon or app) rather than a run or
 * external import. Used by the engine's overlap debounce. */
export function isPollSource(source: SampleSource): boolean {
  return source === "daemon-poll" || source === "app-poll" || source === "startup-reconcile"
}

/**
 * Derive a deterministic dedupe key. Two samples describing the same provider /
 * account / window collapse to one row regardless of whether the daemon or the
 * app observed it. Poll sources are normalized to a shared bucket so a
 * daemon-poll and an app-poll for the same window don't both persist.
 *
 * When a provider supplies its own natural key (e.g. an OpenRouter generation
 * id) it should set `dedupeKey` explicitly; this fallback is for aggregate polls.
 */
export function deriveDedupeKey(sample: UsageSampleInput): string {
  if (sample.dedupeKey) return sample.dedupeKey
  const bucket = isPollSource(sample.source) ? "poll" : sample.source
  // Aggregate poll windows describe the provider billing/reset cycle, not the
  // observation time. Key poll snapshots by captured minute so history keeps
  // changing utilization while app/daemon overlap in the same minute still
  // collapses to one row.
  const observedAt = isPollSource(sample.source)
    ? sample.capturedAt
    : (sample.windowEnd ?? sample.windowStart ?? sample.capturedAt)
  // Poll responses are snapshots. Normalizing a timestamp-only snapshot to a
  // minute prevents app/daemon overlap from double-counting the same poll.
  const window = observedAt
    ? new Date(Math.floor(observedAt.getTime() / 60_000) * 60_000).toISOString()
    : new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  return [
    sample.providerId,
    sample.accountTag ?? "default",
    sample.sourceTag ?? "-",
    sample.metricKey ?? "-",
    sample.generationId ?? "-",
    bucket,
    window,
  ].join("|")
}

/** Human label for a provider id (dashboard + alert copy). */
export const PROVIDER_LABELS: Record<UsageProviderId, string> = {
  codex: "Codex / OpenAI",
  anthropic: "Claude / Anthropic",
  cursor: "Cursor",
  openrouter: "OpenRouter",
  nanogpt: "NanoGPT",
  local: "Local / Ollama",
}
