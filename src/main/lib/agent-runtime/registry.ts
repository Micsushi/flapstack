import type {
  HarnessAdapter,
  HarnessAdapterFactory,
  HarnessAdapterRegistryContract,
  ResolvedAgentRuntime,
  RuntimeAdapterProbe,
  RuntimeBlockReason,
} from "../../../shared/agent-runtime"

export type RuntimeRegistryEntry<TActivity = unknown> = {
  runtime: ResolvedAgentRuntime
  factory: HarnessAdapterFactory<TActivity>
  enabled?: boolean
  disabledReason?: string | null
}

export type RuntimeRegistryDiagnostic = {
  runtime: ResolvedAgentRuntime
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
  private readonly entries = new Map<
    ResolvedAgentRuntime,
    Required<RuntimeRegistryEntry<TActivity>>
  >()
  private readonly adapters = new Map<ResolvedAgentRuntime, HarnessAdapter<TActivity>>()

  constructor(entries: ReadonlyArray<RuntimeRegistryEntry<TActivity>>) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: RuntimeRegistryEntry<TActivity>): void {
    if (this.entries.has(entry.runtime)) {
      throw new Error(`Runtime adapter ${entry.runtime} is already registered.`)
    }
    this.entries.set(entry.runtime, {
      ...entry,
      enabled: entry.enabled ?? true,
      disabledReason: entry.disabledReason ?? null,
    })
  }

  get(runtime: ResolvedAgentRuntime): HarnessAdapter<TActivity> | null {
    const entry = this.entries.get(runtime)
    if (!entry) return null
    let adapter = this.adapters.get(runtime)
    if (!adapter) {
      adapter = entry.factory()
      if (adapter.runtime !== runtime) {
        throw new Error(
          `Runtime factory ${runtime} returned mismatched adapter ${adapter.runtime}.`,
        )
      }
      this.adapters.set(runtime, adapter)
    }
    return adapter
  }

  forNewLaunch(runtime: ResolvedAgentRuntime, harness: string): HarnessAdapter<TActivity> {
    const entry = this.entries.get(runtime)
    if (!entry) {
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
    return this.get(runtime)!
  }

  setEnabled(runtime: ResolvedAgentRuntime, enabled: boolean, reason?: string | null): void {
    const entry = this.entries.get(runtime)
    if (!entry) throw new Error(`Runtime adapter ${runtime} is not registered.`)
    entry.enabled = enabled
    entry.disabledReason = enabled ? null : (reason ?? entry.disabledReason)
  }

  async probe(runtime: ResolvedAgentRuntime, harness: string): Promise<RuntimeAdapterProbe> {
    try {
      return await this.forNewLaunch(runtime, harness).probe(harness)
    } catch (error) {
      if (!(error instanceof RuntimeRegistryError)) throw error
      return unavailableProbe(runtime, harness, error.reason)
    }
  }

  async probeAll(harness: string): Promise<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>> {
    const pairs = await Promise.all(
      [...this.entries.keys()].map(
        async (runtime) => [runtime, await this.probe(runtime, harness)] as const,
      ),
    )
    return Object.fromEntries(pairs) as Record<ResolvedAgentRuntime, RuntimeAdapterProbe>
  }

  list(): ReadonlyArray<{
    runtime: ResolvedAgentRuntime
    factory: HarnessAdapterFactory<TActivity>
  }> {
    return [...this.entries.values()].map(({ runtime, factory }) => ({ runtime, factory }))
  }

  diagnostics(): RuntimeRegistryDiagnostic[] {
    return [...this.entries.values()].map((entry) => ({
      runtime: entry.runtime,
      enabled: entry.enabled,
      instantiated: this.adapters.has(entry.runtime),
      disabledReason: entry.disabledReason,
    }))
  }
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
