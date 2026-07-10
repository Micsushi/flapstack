// Stage 2 Track B — U2: shared usage engine.
//
// Runs in two modes with the same provider code:
//   - "app": manual refresh / startup reconcile from the Electron main process.
//   - "daemon": periodic polling from the background daemon while the app is closed.
// No Electron renderer dependency so the daemon can import it standalone.
//
// The engine iterates enabled providers, polls them, persists samples (dedupe
// handled by the store), and records honest provider states. A scaffolded
// provider that throws UsageNotImplementedError is recorded as
// `source-unavailable` — never as zero usage.

import { getUsageProviders } from "./registry"
import { runAlerts } from "./alert-runner"
import { getUsageSettings, type UsageSettings } from "./settings"
import { getLatestSampleAt, insertSamples, upsertProviderState, type UsageDb } from "./store"
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
    try {
      const status = await provider.getStatus(ctx)
      await upsertProviderState(this.deps.db, status)
      if (!status.configured) {
        return { providerId: provider.id, status: status.status, inserted: 0 }
      }
      const samples =
        intent === "reconcile"
          ? await provider.reconcileSince(ctx, await getLatestSampleAt(this.deps.db, provider.id))
          : await provider.pollLatest(ctx)
      const inserted = await insertSamples(this.deps.db, samples)
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
      if (status.status === "source-unavailable") {
        await upsertProviderState(this.deps.db, { ...status, status: "ok", detail: undefined })
      }
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
      await upsertProviderState(this.deps.db, {
        providerId: provider.id,
        status: providerError?.status ?? "source-unavailable",
        detail: isScaffold ? "Provider not implemented yet" : message,
        configured: true,
        supportsDaemon: provider.supportsDaemon(),
        supportsHistorical: provider.supportsHistorical(),
      }).catch(() => {})
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
