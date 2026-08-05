import type {
  HarnessAdapter,
  HarnessAdapterFactory,
  HarnessAdapterRegistryContract,
  ResolvedAgentRuntime,
  RuntimeAdapterCompositionSnapshot,
  RuntimeAdapterProbe,
  RuntimeBlockReason,
} from "../../../shared/agent-runtime"

export type RuntimeRegistryEntry<TActivity = unknown> = {
  runtime: ResolvedAgentRuntime
  /** Exact provider harness. Omit only for a Runtime that supports every harness. */
  harness?: string
  composition?: RuntimeAdapterCompositionSnapshot
  factory: HarnessAdapterFactory<TActivity>
  enabled?: boolean
  disabledReason?: string | null
}

export type RuntimeRegistryDiagnostic = {
  runtime: ResolvedAgentRuntime
  harness: string | null
  enabled: boolean
  instantiated: boolean
  disabledReason: string | null
}

export class RuntimeRegistryError extends Error {
  constructor(readonly reason: RuntimeBlockReason) {
    super(reason.message)
    this.name = "RuntimeRegistryError"
  }
}

/** Process-local adapter authority. Disabled adapters remain usable for recovery. */
export class AgentRuntimeRegistry<
  TActivity = unknown,
> implements HarnessAdapterRegistryContract<TActivity> {
  private readonly entries = new Map<string, NormalizedRuntimeRegistryEntry<TActivity>>()
  private readonly adapters = new Map<string, HarnessAdapter<TActivity>>()
  private readonly probes = new Map<
    string,
    { expiresAt: number; value: Promise<RuntimeAdapterProbe> }
  >()

  constructor(entries: ReadonlyArray<RuntimeRegistryEntry<TActivity>>) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: RuntimeRegistryEntry<TActivity>): void {
    const key = entryKey(entry.runtime, entry.harness)
    if (this.entries.has(key)) {
      throw new Error(
        `Runtime adapter ${entry.runtime} for ${entry.harness ?? "all harnesses"} is already registered.`,
      )
    }
    this.entries.set(key, {
      ...entry,
      harness: entry.harness ?? null,
      composition: entry.composition ?? null,
      enabled: entry.enabled ?? true,
      disabledReason: entry.disabledReason ?? null,
    })
  }

  get(runtime: ResolvedAgentRuntime, harness?: string): HarnessAdapter<TActivity> | null {
    const resolved = this.resolveEntry(runtime, harness)
    if (!resolved) return null
    const [key, entry] = resolved
    let adapter = this.adapters.get(key)
    if (!adapter) {
      adapter = entry.factory()
      if (adapter.runtime !== runtime) {
        throw new Error(
          `Runtime factory ${runtime} returned mismatched adapter ${adapter.runtime}.`,
        )
      }
      this.adapters.set(key, adapter)
    }
    return adapter
  }

  forNewLaunch(runtime: ResolvedAgentRuntime, harness: string): HarnessAdapter<TActivity> {
    const resolved = this.resolveEntry(runtime, harness)
    if (!resolved) {
      throw new RuntimeRegistryError(
        blockReason(
          "runtime-unavailable",
          harness,
          runtime,
          `Runtime adapter ${runtime} is not registered.`,
          "Install or register the adapter, or choose another compatible Runtime.",
        ),
      )
    }
    const [, entry] = resolved
    if (!entry.enabled) {
      throw new RuntimeRegistryError(
        blockReason(
          "adapter-disabled",
          harness,
          runtime,
          entry.disabledReason ?? `Runtime adapter ${runtime} is disabled.`,
          "Enable the adapter after its release gates pass, or explicitly choose another compatible Runtime.",
        ),
      )
    }
    return this.get(runtime, harness)!
  }

  setEnabled(runtime: ResolvedAgentRuntime, enabled: boolean, reason?: string | null): void {
    const entries = [...this.entries.values()].filter((entry) => entry.runtime === runtime)
    if (entries.length === 0) throw new Error(`Runtime adapter ${runtime} is not registered.`)
    for (const entry of entries) {
      entry.enabled = enabled
      entry.disabledReason = enabled ? null : (reason ?? entry.disabledReason)
    }
    for (const key of this.probes.keys()) {
      if (key.startsWith(`${runtime}\0`)) this.probes.delete(key)
    }
  }

  async probe(runtime: ResolvedAgentRuntime, harness: string): Promise<RuntimeAdapterProbe> {
    const key = `${runtime}\0${harness}`
    const cached = this.probes.get(key)
    if (cached && cached.expiresAt > Date.now()) return await cached.value
    const value = (async () => {
      try {
        return await this.forNewLaunch(runtime, harness).probe(harness)
      } catch (error) {
        if (!(error instanceof RuntimeRegistryError)) throw error
        return unavailableProbe(
          runtime,
          harness,
          error.reason,
          this.resolveEntry(runtime, harness)?.[1].composition,
        )
      }
    })()
    this.probes.set(key, { expiresAt: Number.POSITIVE_INFINITY, value })
    try {
      const result = await value
      if (this.probes.get(key)?.value === value) {
        this.probes.set(key, { expiresAt: Date.now() + 2_000, value })
      }
      return result
    } catch (error) {
      if (this.probes.get(key)?.value === value) this.probes.delete(key)
      throw error
    }
  }

  async probeAll(harness: string): Promise<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>> {
    const runtimes = [...new Set([...this.entries.values()].map((entry) => entry.runtime))]
    const pairs = await Promise.all(
      runtimes.map(async (runtime) => [runtime, await this.probe(runtime, harness)] as const),
    )
    return Object.fromEntries(pairs) as Record<ResolvedAgentRuntime, RuntimeAdapterProbe>
  }

  list(): ReadonlyArray<{
    runtime: ResolvedAgentRuntime
    harness?: string
    factory: HarnessAdapterFactory<TActivity>
  }> {
    return [...this.entries.values()].map(({ runtime, harness, factory }) => ({
      runtime,
      ...(harness ? { harness } : {}),
      factory,
    }))
  }

  diagnostics(): RuntimeRegistryDiagnostic[] {
    return [...this.entries.values()].map((entry) => ({
      runtime: entry.runtime,
      harness: entry.harness,
      enabled: entry.enabled,
      instantiated: this.adapters.has(entryKey(entry.runtime, entry.harness ?? undefined)),
      disabledReason: entry.disabledReason,
    }))
  }

  private resolveEntry(
    runtime: ResolvedAgentRuntime,
    harness?: string,
  ): [string, NormalizedRuntimeRegistryEntry<TActivity>] | null {
    if (harness) {
      const exactKey = entryKey(runtime, harness)
      const exact = this.entries.get(exactKey)
      if (exact) return [exactKey, exact]
    }
    const universalKey = entryKey(runtime)
    const universal = this.entries.get(universalKey)
    if (universal) return [universalKey, universal]
    if (harness) return null
    const matches = [...this.entries.entries()].filter(([, entry]) => entry.runtime === runtime)
    return matches.length === 1 ? matches[0] : null
  }
}

type NormalizedRuntimeRegistryEntry<TActivity> = Omit<
  Required<RuntimeRegistryEntry<TActivity>>,
  "harness" | "composition"
> & { harness: string | null; composition: RuntimeAdapterCompositionSnapshot | null }

function entryKey(runtime: ResolvedAgentRuntime, harness?: string): string {
  return `${runtime}\0${harness ?? "*"}`
}

export function createAgentRuntimeRegistry<TActivity = unknown>(
  entries: ReadonlyArray<RuntimeRegistryEntry<TActivity>>,
): AgentRuntimeRegistry<TActivity> {
  return new AgentRuntimeRegistry(entries)
}

function unavailableProbe(
  runtime: ResolvedAgentRuntime,
  harness: string,
  reason: RuntimeBlockReason,
  composition?: RuntimeAdapterCompositionSnapshot | null,
): RuntimeAdapterProbe {
  return {
    runtime,
    harness,
    available: false,
    versions: { adapterVersion: "disabled", protocolVersion: "unresolved" },
    capabilities: {
      schemaVersion: 1,
      status: "unavailable",
      capturedAt: null,
      controls: {
        modelThinking: { supported: false, reason: reason.message },
        reasoningDisplay: { supported: false, reason: reason.message },
        subagentActivity: { supported: false, reason: reason.message },
        hookDiagnostics: { supported: false, reason: reason.message },
      },
      ...(composition ? { composition } : {}),
      limitations: [reason.message],
      unavailableReason: reason,
    },
    reason,
  }
}

function blockReason(
  code: RuntimeBlockReason["code"],
  harness: string,
  runtime: ResolvedAgentRuntime,
  message: string,
  repair: string,
): RuntimeBlockReason {
  return { code, harness, runtime, message, repair }
}
