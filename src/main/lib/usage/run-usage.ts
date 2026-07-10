// Stage 2 Track B — E6 usage handoff for OpenCode-backed provider runs.
//
// Track E calls this after a completed OpenRouter or NanoGPT run. This module
// deliberately uses a structural input contract so Track B does not import the
// sidecar branch before it lands. It records exact/provider-reported cost when
// supplied, otherwise an estimate only when live model pricing is known.

import { insertSamples, type UsageDb } from "./store"
import { buildEstimatedNanoGptSample } from "./providers/nanogpt"
import { buildEstimatedOpenRouterSample } from "./providers/openrouter"
import type { CostQuality, UsageProviderId, UsageSampleInput } from "./types"

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
}

/** Persist one completed OpenCode-backed run. Returns zero when neither exact
 * cost nor a defensible estimate is available; absence is better than $0. */
export async function captureOpenCodeRunUsage(
  db: UsageDb,
  usage: OpenCodeUsageCapture,
): Promise<number> {
  const reportedCost = typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)
  const quality = usage.costQuality ?? (reportedCost ? "provider-reported" : "unknown")
  let sample: UsageSampleInput | null

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
      dedupeKey:
        usage.providerId === "openrouter" && usage.generationId
          ? `openrouter|gen|${usage.generationId}`
          : `${usage.providerId}|run|${usage.runId}`,
    }
  } else if (usage.providerId === "openrouter") {
    sample = buildEstimatedOpenRouterSample({
      model: usage.model,
      generationId: usage.generationId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      source: "flapstack-run",
    })
  } else {
    sample = buildEstimatedNanoGptSample({
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      source: "flapstack-run",
    })
  }

  if (!sample) return 0
  return insertSamples(db, [{ ...sample, runId: usage.runId, model: usage.model }])
}
