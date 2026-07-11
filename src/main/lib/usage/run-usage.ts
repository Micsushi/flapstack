// Stage 2 Track B — E6 usage handoff for OpenCode-backed provider runs.
//
// Track E calls this after a completed OpenRouter or NanoGPT run. It records
// provider-reported or sidecar-estimated cost when supplied, otherwise it loads
// persisted model pricing and derives an explicitly labeled estimate.

import { insertSamples, type UsageDb } from "./store"
import { runAlerts } from "./alert-runner"
import { hydrateCachedProviderPricing } from "../harness/opencode-sidecar/models"
import { buildEstimatedNanoGptSample } from "./providers/nanogpt"
import { buildEstimatedOpenRouterSample } from "./providers/openrouter"
import type { UsageSettings } from "./settings"
import type { CostQuality, UsageProvider, UsageProviderId, UsageSampleInput } from "./types"

export type OpenCodeUsageCapture = {
  providerId: Extract<UsageProviderId, "openrouter" | "nanogpt">
  runId: string
  model: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costUsd?: number
  costQuality?: Extract<CostQuality, "provider-reported" | "estimated" | "unknown">
  generationId?: string
  observationId?: string
  /** Sanitized provider/sidecar payload for drift debugging. */
  rawPayload?: unknown
}

export type OpenCodeUsageCaptureOptions = {
  alerts?: {
    settings: UsageSettings
    getSecret: (key: string) => Promise<string | null>
    provider: UsageProvider
  }
}

/** Persist one completed OpenCode-backed run. Token usage remains useful when
 * cost is unknown, so missing pricing never causes the whole sample to vanish. */
export async function captureOpenCodeRunUsage(
  db: UsageDb,
  usage: OpenCodeUsageCapture,
  options: OpenCodeUsageCaptureOptions = {},
): Promise<number> {
  return captureOpenCodeRunUsageBatch(db, [usage], options)
}

/** Persist provider steps independently so every OpenRouter generation id can
 * reconcile. Alert thresholds evaluate the aggregate run exactly once. */
export async function captureOpenCodeRunUsageBatch(
  db: UsageDb,
  observations: OpenCodeUsageCapture[],
  options: OpenCodeUsageCaptureOptions = {},
): Promise<number> {
  if (observations.length === 0) return 0
  const samples = observations.map(buildOpenCodeUsageSample)
  const inserted = await insertSamples(db, samples)
  if (options.alerts) {
    await runAlerts({
      db,
      settings: options.alerts.settings,
      getSecret: options.alerts.getSecret,
      provider: options.alerts.provider,
      samples: [buildOpenCodeUsageSample(mergeCaptures(observations))],
    })
  }
  return inserted
}

function buildOpenCodeUsageSample(usage: OpenCodeUsageCapture): UsageSampleInput {
  const reportedCost = typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)
  const quality = usage.costQuality ?? (reportedCost ? "provider-reported" : "unknown")
  const dedupeKey =
    usage.providerId === "openrouter" && usage.generationId
      ? `openrouter|gen|${usage.generationId}`
      : `${usage.providerId}|run|${usage.runId}|${usage.observationId ?? "total"}`
  let sample: UsageSampleInput | null = null

  if (reportedCost && quality !== "unknown") {
    sample = {
      providerId: usage.providerId,
      source: "flapstack-run",
      costQuality: quality,
      runId: usage.runId,
      model: usage.model,
      generationId: usage.generationId ?? null,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      reasoningTokens: usage.reasoningTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
      ...(quality === "estimated"
        ? { costUsdEstimated: usage.costUsd }
        : { costUsd: usage.costUsd }),
      dedupeKey,
    }
  } else {
    // A completed run can arrive before the renderer lists models. Hydrate the
    // persisted catalog here so estimates do not depend on an unrelated UI query.
    hydrateCachedProviderPricing(usage.providerId)
  }

  if (!sample && usage.providerId === "openrouter") {
    sample = buildEstimatedOpenRouterSample({
      model: usage.model,
      generationId: usage.generationId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      source: "flapstack-run",
    })
  } else if (!sample) {
    sample = buildEstimatedNanoGptSample({
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      source: "flapstack-run",
    })
  }

  sample ??= {
    providerId: usage.providerId,
    source: "flapstack-run",
    costQuality: "unknown",
    runId: usage.runId,
    model: usage.model,
    generationId: usage.generationId ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningTokens: usage.reasoningTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    dedupeKey,
  }
  const finalSample: UsageSampleInput = {
    ...sample,
    runId: usage.runId,
    model: usage.model,
    totalTokens: sample.totalTokens ?? usage.totalTokens ?? null,
    sourceTag: "opencode-sidecar",
    rawPayload: usage.rawPayload,
    dedupeKey: sample.dedupeKey ?? dedupeKey,
  }
  return finalSample
}

function mergeCaptures(observations: OpenCodeUsageCapture[]): OpenCodeUsageCapture {
  const first = observations[0]!
  const numericKeys = [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
    "costUsd",
  ] as const
  const sums = Object.fromEntries(
    numericKeys.flatMap((key) => {
      const values = observations.flatMap((observation) =>
        typeof observation[key] === "number" ? [observation[key] as number] : [],
      )
      return values.length
        ? [[key, values.reduce((total, value) => total + value, 0)] as const]
        : []
    }),
  )
  const rank: Record<NonNullable<OpenCodeUsageCapture["costQuality"]>, number> = {
    "provider-reported": 2,
    estimated: 1,
    unknown: 0,
  }
  const costQuality = observations
    .map((observation) => observation.costQuality ?? "unknown")
    .reduce((weakest, quality) => (rank[quality] < rank[weakest] ? quality : weakest))
  return {
    providerId: first.providerId,
    runId: first.runId,
    model: first.model,
    ...sums,
    costQuality,
    observationId: "aggregate-alert",
  }
}
