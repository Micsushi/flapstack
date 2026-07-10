// Stage 2 Track B — U5: app startup catch-up + manual refresh.
//
// On app start, and on a user "refresh now", reconcile provider usage missed
// while the app and daemon were off. Historical providers use reconcileSince
// (from the latest stored watermark); providers without history poll latest and
// the gap is labeled honestly — never backfilled with fabricated zero rows.

import { UsageEngine, type EngineDeps, type ProviderRunResult } from "./engine"
import { getLatestSampleAt } from "./store"
import { getUsageProvider } from "./registry"
import type { UsageProviderId } from "./types"

export interface CatchUpResult {
  results: ProviderRunResult[]
  /** Providers that could not recover history and show an honest gap. */
  limitedProviders: UsageProviderId[]
}

/** Reconcile all enabled providers at startup. */
export async function runStartupCatchUp(deps: EngineDeps): Promise<CatchUpResult> {
  const engine = new UsageEngine("app", deps)
  const results = await engine.runOnce("reconcile")
  const limitedProviders: UsageProviderId[] = []
  for (const result of results) {
    const provider = getUsageProvider(result.providerId)
    if (provider && !provider.supportsHistorical()) {
      limitedProviders.push(result.providerId)
    }
  }
  return { results, limitedProviders }
}

/** Manual "refresh now" — same reconcile path, optionally scoped to one provider. */
export async function runManualRefresh(
  deps: EngineDeps,
  providerId?: UsageProviderId,
): Promise<CatchUpResult> {
  const engine = new UsageEngine("app", deps)
  if (providerId) {
    const result = await engine.runProviderById(providerId, "reconcile")
    const provider = getUsageProvider(providerId)
    return {
      results: result ? [result] : [],
      limitedProviders: provider && !provider.supportsHistorical() ? [providerId] : [],
    }
  }
  return runStartupCatchUp(deps)
}

/** Reconcile watermark for a provider (latest stored sample), or null if none. */
export async function getReconcileWatermark(
  deps: Pick<EngineDeps, "db">,
  providerId: UsageProviderId,
): Promise<Date | null> {
  return getLatestSampleAt(deps.db, providerId)
}
