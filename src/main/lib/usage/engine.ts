// Stage 2 Track B - U2: shared usage engine.
//
// Runs in two modes with the same provider code:
//   - "app": manual refresh / startup reconcile from the Electron main process.
//   - "daemon": periodic polling from the background daemon while the app is closed.
// No Electron renderer dependency so the daemon can import it standalone.
//
// The engine iterates enabled providers, polls them, persists samples (dedupe
// handled by the store), and records honest provider states. A scaffolded
// provider that throws UsageNotImplementedError is recorded as
// `source-unavailable` - never as zero usage.

import { getUsageProviders } from "./registry"
import { runAlerts } from "./alert-runner"
import { getUsageSettings, resolveCadenceSeconds, type UsageSettings } from "./settings"
import {
  getLatestSampleAt,
  listPendingGenerationIds,
  markGenerationReconciliation,
  getProviderLastPollAt,
  insertSamples,
  upsertProviderState,
  type UsageDb,
} from "./store"
import {
  UsageNotImplementedError,
  UsageProviderError,
  type SampleSource,
  type UsageProvider,
  type UsageProviderContext,
  type UsageProviderId,
} from "./types"

export type EngineMode = "app" | "daemon"

export interface EngineDeps {
  db: UsageDb
  /** Reads a stored secret for a provider (OS credential store). */
  getSecret: (key: string) => Promise<string | null>
  /** Optional structured logger. Never receives raw secrets. */
  log?: UsageProviderContext["log"]
  /** Settings loader override (tests). Defaults to file-based settings. */
  loadSettings?: () => UsageSettings
}

export interface ProviderRunResult {
  providerId: UsageProviderId
  status: string
  inserted: number
  error?: string
}

const noopLog: UsageProviderContext["log"] = () => {}

export class UsageEngine {
  constructor(
    private readonly mode: EngineMode,
    private readonly deps: EngineDeps,
  ) {}

  private sourceFor(intent: "poll" | "reconcile"): SampleSource {
    if (intent === "reconcile") return "startup-reconcile"
    return this.mode === "daemon" ? "daemon-poll" : "app-poll"
  }

  private makeContext(source: SampleSource): UsageProviderContext {
    return {
      now: new Date(),
      source,
      getSecret: this.deps.getSecret,
      getPendingGenerationIds: (providerId, limit) =>
        listPendingGenerationIds(this.deps.db, providerId, limit),
      markGenerationReconciliation: (providerId, generationId, state, detail) =>
        markGenerationReconciliation(this.deps.db, providerId, generationId, state, detail),
      log: this.deps.log ?? noopLog,
    }
  }

  /** Poll (or reconcile) every enabled provider once. */
  async runOnce(intent: "poll" | "reconcile" = "poll"): Promise<ProviderRunResult[]> {
    const settings = (this.deps.loadSettings ?? getUsageSettings)()
    const results: ProviderRunResult[] = []
    for (const provider of getUsageProviders()) {
      if (!settings.providers[provider.id]?.enabled) continue
      if (this.mode === "daemon" && !provider.supportsDaemon()) continue
      if (this.mode === "daemon" && intent === "poll") {
        const lastPollAt = await getProviderLastPollAt(this.deps.db, provider.id)
        const cadenceMs = resolveCadenceSeconds(settings, provider.id) * 1_000
        if (lastPollAt && Date.now() - lastPollAt.getTime() < cadenceMs) continue
      }
      results.push(await this.runProvider(provider, intent, settings))
    }
    return results
  }

  /** Run a single provider by id (manual refresh of one card). */
  async runProviderById(
    id: UsageProviderId,
    intent: "poll" | "reconcile" = "poll",
  ): Promise<ProviderRunResult | null> {
    const provider = getUsageProviders().find((p) => p.id === id)
    if (!provider) return null
    return this.runProvider(provider, intent, (this.deps.loadSettings ?? getUsageSettings)())
  }

  private async runProvider(
    provider: UsageProvider,
    intent: "poll" | "reconcile",
    settings: UsageSettings,
  ): Promise<ProviderRunResult> {
    const source = this.sourceFor(intent)
    const ctx = this.makeContext(source)
    let knownStatus: Awaited<ReturnType<UsageProvider["getStatus"]>> | null = null
    try {
      const status = await provider.getStatus(ctx)
      knownStatus = status
      await upsertProviderState(this.deps.db, status)
      if (!status.configured) {
        return { providerId: provider.id, status: status.status, inserted: 0 }
      }
      const samples =
        intent === "reconcile"
          ? await provider.reconcileSince(ctx, await getLatestSampleAt(this.deps.db, provider.id))
          : await provider.pollLatest(ctx)
      const inserted = await insertSamples(this.deps.db, samples)
      // Only exact generation costs are terminal. Mark them after the durable
      // sample write; a crash before this point leaves the id safely retryable.
      for (const sample of samples) {
        if (
          sample.providerId === "openrouter" &&
          sample.generationId &&
          sample.costQuality === "exact"
        ) {
          await markGenerationReconciliation(
            this.deps.db,
            sample.providerId,
            sample.generationId,
            "resolved",
          )
        }
      }
      if (this.mode === "daemon") {
        await runAlerts({
          db: this.deps.db,
          settings,
          getSecret: this.deps.getSecret,
          provider,
          samples,
        })
      }
      // A source that was previously unverified is healthy after a successful
      // poll, even when it legitimately returns no new samples.
      await upsertProviderState(
        this.deps.db,
        status.status === "source-unavailable"
          ? { ...status, status: "ok", detail: undefined }
          : status,
        { kind: "success" },
      )
      return {
        providerId: provider.id,
        status: status.status === "source-unavailable" ? "ok" : status.status,
        inserted,
      }
    } catch (err) {
      // Scaffolded/not-implemented paths degrade to an honest status, not zeros.
      const isScaffold = err instanceof UsageNotImplementedError
      const providerError = err instanceof UsageProviderError ? err : null
      const message = String((err as Error)?.message ?? err)
      const configured =
        knownStatus?.configured ?? (await provider.isConfigured(ctx).catch(() => false))
      await upsertProviderState(
        this.deps.db,
        {
          providerId: provider.id,
          accountTag: knownStatus?.accountTag,
          status: providerError?.status ?? "source-unavailable",
          detail: isScaffold ? "Provider not implemented yet" : message,
          configured,
          supportsDaemon: provider.supportsDaemon(),
          supportsHistorical: provider.supportsHistorical(),
        },
        { kind: "error", message },
      ).catch(() => {})
      this.deps.log?.("warn", `usage provider ${provider.id} failed`, {
        scaffold: isScaffold,
        message,
      })
      return {
        providerId: provider.id,
        status: providerError?.status ?? "source-unavailable",
        inserted: 0,
        error: message,
      }
    }
  }
}
