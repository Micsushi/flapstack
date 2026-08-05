import type {
  AgentRuntimePreference,
  HarnessAdapter,
  HarnessAdapterFactory,
  ResolvedAgentRuntime,
  ResolvedRuntimeLaunch,
  RuntimeAdapterCompositionSnapshot,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
  RuntimeBlockReason,
} from "../../../shared/agent-runtime"
import { sanitizeRuntimeText } from "./sanitizer"

export type TranslatedRuntimeAdapterPackDescriptor = {
  id: string
  version: string
  providerHarness: string
  providerRuntime: ResolvedAgentRuntime
  contractRuntime: ResolvedAgentRuntime
  capabilities: RuntimeAdapterCompositionSnapshot["capabilities"]
  losses: RuntimeAdapterCompositionSnapshot["losses"]
}

const COMMON_TRANSLATED_CAPABILITIES = {
  promptSystem: "lossy",
  instructionFiles: "lossy",
  toolLoop: "available",
  tools: "lossy",
  permissions: "available",
  mcp: "lossy",
  skills: "lossy",
  hooks: "lossy",
  sessionResume: "lossy",
  sessionFork: "unavailable",
  attachments: "unknown",
  reasoning: "lossy",
  events: "lossy",
  structuredOutput: "available",
  usage: "available",
  cancellation: "available",
  recovery: "available",
} as const satisfies RuntimeAdapterCompositionSnapshot["capabilities"]

export const CLAUDE_PROVIDER_TO_CODEX_CONTRACT: TranslatedRuntimeAdapterPackDescriptor = {
  id: "claude-provider-to-codex-contract",
  version: "1",
  providerHarness: "claude-code",
  providerRuntime: "claude-code",
  contractRuntime: "codex",
  capabilities: COMMON_TRANSLATED_CAPABILITIES,
  losses: [
    {
      code: "system-instruction-channel",
      summary:
        "Codex developer instructions are mapped into explicit turn context instead of the Codex App Server developer-instruction channel.",
    },
    {
      code: "native-instruction-files",
      summary:
        "The Claude provider keeps its native instruction discovery; Codex AGENTS.md discovery is not claimed.",
    },
    {
      code: "tool-schema-semantics",
      summary:
        "The Claude provider tool loop and Flapstack authority are enforced, but Codex-native tool names and input schemas are not relabeled.",
    },
    {
      code: "native-session-identity",
      summary:
        "Sessions remain Claude provider sessions; Codex thread, fork, and archive identity is unavailable.",
    },
    {
      code: "reasoning-semantics",
      summary:
        "Claude provider-visible thinking is preserved without Codex reasoning section or summary-index identity.",
    },
  ],
}

export const CODEX_PROVIDER_TO_CLAUDE_CONTRACT: TranslatedRuntimeAdapterPackDescriptor = {
  id: "codex-provider-to-claude-contract",
  version: "1",
  providerHarness: "codex",
  providerRuntime: "codex",
  contractRuntime: "claude-code",
  capabilities: COMMON_TRANSLATED_CAPABILITIES,
  losses: [
    {
      code: "system-instruction-channel",
      summary:
        "Claude system instructions are mapped into explicit turn context instead of the Claude Code system-prompt preset.",
    },
    {
      code: "native-instruction-files",
      summary:
        "The Codex provider keeps its native instruction discovery; Claude CLAUDE.md and setting-source semantics are not claimed.",
    },
    {
      code: "tool-schema-semantics",
      summary:
        "The Codex provider tool loop and Flapstack authority are enforced, but Claude-native tool names and input schemas are not relabeled.",
    },
    {
      code: "native-session-identity",
      summary:
        "Sessions remain Codex provider threads; Claude session, resume-at, and fork identity is unavailable.",
    },
    {
      code: "reasoning-semantics",
      summary:
        "Codex displayable reasoning is preserved without Claude thinking-block or parent-tool-use identity.",
    },
  ],
}

export class TranslatedRuntimeAdapterError extends Error {
  readonly cause: unknown

  constructor(
    readonly packId: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const safeCause = sanitizeRuntimeText(errorMessage(cause), {
      maxLength: 500,
      mode: "diagnostic",
    })
    super(`[${packId}] ${operation} failed: ${safeCause}`)
    this.name = "TranslatedRuntimeAdapterError"
    this.cause = new Error(safeCause)
  }
}

export function createTranslatedRuntimeAdapterPackFactory<TActivity>(
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
  providerFactory: HarnessAdapterFactory<TActivity>,
): HarnessAdapterFactory<TActivity> {
  validateDescriptor(descriptor)
  return () => new TranslatedRuntimeAdapterPack(descriptor, providerFactory())
}

export function translatedRuntimeCompositionIdentity(
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
  providerVersions = { adapterVersion: "unresolved", protocolVersion: "unresolved" },
): RuntimeAdapterCompositionSnapshot {
  return {
    runtimeMode: "translated",
    providerRuntime: descriptor.providerRuntime,
    providerVersions,
    adapterChain: [{ id: descriptor.id, version: descriptor.version }],
    capabilities: Object.fromEntries(
      Object.keys(descriptor.capabilities).map((capability) => [capability, "unavailable"]),
    ),
    losses: descriptor.losses.map((loss) => ({ ...loss })),
  }
}

class TranslatedRuntimeAdapterPack<TActivity> implements HarnessAdapter<TActivity> {
  readonly runtime: ResolvedAgentRuntime

  constructor(
    private readonly descriptor: TranslatedRuntimeAdapterPackDescriptor,
    private readonly provider: HarnessAdapter<TActivity>,
  ) {
    this.runtime = descriptor.contractRuntime
    if (provider.runtime !== descriptor.providerRuntime) {
      throw new Error(
        `Translated adapter pack ${descriptor.id} expected provider Runtime ${descriptor.providerRuntime}, received ${provider.runtime}.`,
      )
    }
  }

  async probe(harness: string): Promise<RuntimeAdapterProbe> {
    if (harness !== this.descriptor.providerHarness) {
      return unavailableProbe(
        this.descriptor,
        harness,
        `Translated adapter pack ${this.descriptor.id} requires the ${this.descriptor.providerHarness} provider harness.`,
        "runtime-incompatible",
      )
    }
    let providerProbe: RuntimeAdapterProbe
    try {
      providerProbe = await this.provider.probe(this.descriptor.providerHarness)
    } catch (error) {
      return unavailableProbe(
        this.descriptor,
        harness,
        `Provider probe failed: ${errorMessage(error)}`,
      )
    }
    if (
      providerProbe.runtime !== this.descriptor.providerRuntime ||
      providerProbe.harness !== this.descriptor.providerHarness
    ) {
      return unavailableProbe(
        this.descriptor,
        harness,
        "Provider adapter probe returned mismatched Runtime or harness identity.",
      )
    }
    if (!providerProbe.available) {
      return unavailableProbe(
        this.descriptor,
        harness,
        providerProbe.reason?.message ?? "Provider adapter is unavailable.",
        providerProbe.reason?.code ?? "runtime-unavailable",
        providerProbe,
      )
    }
    const composition = compositionSnapshot(this.descriptor, providerProbe)
    return {
      runtime: this.descriptor.contractRuntime,
      harness,
      available: true,
      versions: {
        adapterVersion: `${this.descriptor.id}/${this.descriptor.version}+${providerProbe.versions.adapterVersion}`,
        protocolVersion: providerProbe.versions.protocolVersion,
      },
      capabilities: {
        ...providerProbe.capabilities,
        composition,
        limitations: unique([
          ...providerProbe.capabilities.limitations,
          ...composition.losses.map((loss) => loss.summary),
        ]),
        unavailableReason: null,
      },
      reason: null,
    }
  }

  async startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession> {
    return await this.call("startSession", () =>
      this.provider.startSession(providerContext(context, this.descriptor)),
    )
  }

  async resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession> {
    return await this.call("resumeSession", () =>
      this.provider.resumeSession(providerContext(context, this.descriptor), session),
    )
  }

  async startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn> {
    return await this.call("startTurn", () =>
      this.provider.startTurn(
        providerContext(context, this.descriptor),
        session,
        translatedPrompt(context, prompt),
      ),
    )
  }

  async *streamActivity(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): AsyncIterable<TActivity> {
    try {
      yield* this.provider.streamActivity(providerContext(context, this.descriptor), session, turn)
    } catch (error) {
      throw this.error("streamActivity", error)
    }
  }

  async requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    return await this.call("requestPermission", () =>
      this.provider.requestPermission(providerContext(context, this.descriptor), request),
    )
  }

  async requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    return await this.call("requestInput", () =>
      this.provider.requestInput(providerContext(context, this.descriptor), request),
    )
  }

  async cancel(context: RuntimeAdapterContext, reason: string): Promise<void> {
    await this.call("cancel", () =>
      this.provider.cancel(providerContext(context, this.descriptor), reason),
    )
  }

  async complete(context: RuntimeAdapterContext): Promise<void> {
    await this.call("complete", () =>
      this.provider.complete(providerContext(context, this.descriptor)),
    )
  }

  async reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain"> {
    return await this.call("reconcile", () =>
      this.provider.reconcile(providerContext(context, this.descriptor)),
    )
  }

  async cleanup(context: RuntimeAdapterContext): Promise<void> {
    await this.call("cleanup", () =>
      this.provider.cleanup(providerContext(context, this.descriptor)),
    )
  }

  private async call<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    try {
      return await callback()
    } catch (error) {
      throw this.error(operation, error)
    }
  }

  private error(operation: string, cause: unknown): TranslatedRuntimeAdapterError {
    return cause instanceof TranslatedRuntimeAdapterError
      ? cause
      : new TranslatedRuntimeAdapterError(this.descriptor.id, operation, cause)
  }
}

function providerContext(
  context: RuntimeAdapterContext,
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
): RuntimeAdapterContext {
  assertPackContext(context, descriptor)
  const launch: ResolvedRuntimeLaunch = {
    ...context.launch,
    harness: descriptor.providerHarness,
    requestedPreference: descriptor.providerRuntime as AgentRuntimePreference,
    resolvedRuntime: descriptor.providerRuntime,
    compatibility: {
      compatible: true,
      harness: descriptor.providerHarness,
      runtime: descriptor.providerRuntime,
      reason: null,
    },
    versions: context.launch.capabilities.composition?.providerVersions ?? context.launch.versions,
    capabilities: withoutComposition(context.launch.capabilities),
  }
  return { ...context, launch, instructions: null }
}

function assertPackContext(
  context: RuntimeAdapterContext,
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
): void {
  const composition = context.launch.capabilities.composition
  const adapter = composition?.adapterChain[0]
  if (
    context.launch.harness !== descriptor.providerHarness ||
    context.launch.resolvedRuntime !== descriptor.contractRuntime ||
    composition?.runtimeMode !== "translated" ||
    composition.providerRuntime !== descriptor.providerRuntime ||
    composition.adapterChain.length !== 1 ||
    adapter?.id !== descriptor.id ||
    adapter.version !== descriptor.version
  ) {
    throw new Error(
      `Launch snapshot does not match selected translated adapter pack ${descriptor.id}/${descriptor.version}.`,
    )
  }
}

function translatedPrompt(context: RuntimeAdapterContext, prompt: string): string {
  const instructions = context.instructions?.trim()
  if (!instructions) return prompt
  return `${instructions}\n\n--- USER REQUEST ---\n${prompt}\n--- END USER REQUEST ---`
}

function withoutComposition(
  capabilities: ResolvedRuntimeLaunch["capabilities"],
): ResolvedRuntimeLaunch["capabilities"] {
  const { composition: _composition, ...providerCapabilities } = capabilities
  return providerCapabilities
}

function compositionSnapshot(
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
  providerProbe: RuntimeAdapterProbe,
): RuntimeAdapterCompositionSnapshot {
  const capabilities = { ...descriptor.capabilities }
  const execution = providerProbe.capabilities.execution
  for (const capability of [
    "continuation",
    "delegation",
    "structuredOutput",
    "cancellation",
  ] as const) {
    capabilities[capability] = execution
      ? execution[capability].supported
        ? "available"
        : "unavailable"
      : "unknown"
  }
  return {
    runtimeMode: "translated",
    providerRuntime: descriptor.providerRuntime,
    providerVersions: providerProbe.versions,
    adapterChain: [{ id: descriptor.id, version: descriptor.version }],
    capabilities,
    losses: descriptor.losses.map((loss) => ({ ...loss })),
  }
}

function unavailableProbe(
  descriptor: TranslatedRuntimeAdapterPackDescriptor,
  harness: string,
  message: string,
  code: RuntimeBlockReason["code"] = "runtime-unavailable",
  providerProbe?: RuntimeAdapterProbe,
): RuntimeAdapterProbe {
  const reason: RuntimeBlockReason = {
    code,
    message: sanitizeRuntimeText(message, { maxLength: 1_000, mode: "diagnostic" }),
    harness,
    runtime: descriptor.contractRuntime,
    repair: `Repair the ${descriptor.providerHarness} provider adapter or choose another explicit Runtime target.`,
  }
  const controls = providerProbe?.capabilities.controls ?? {
    modelThinking: { supported: false, reason: reason.message },
    reasoningDisplay: { supported: false, reason: reason.message },
    subagentActivity: { supported: false, reason: reason.message },
    hookDiagnostics: { supported: false, reason: reason.message },
  }
  return {
    runtime: descriptor.contractRuntime,
    harness,
    available: false,
    versions: {
      adapterVersion: `${descriptor.id}/${descriptor.version}`,
      protocolVersion: providerProbe?.versions.protocolVersion ?? "unresolved",
    },
    capabilities: {
      schemaVersion: 1,
      status: "unavailable",
      capturedAt: providerProbe?.capabilities.capturedAt ?? null,
      controls,
      execution: {
        continuation: { supported: false, reason: reason.message },
        delegation: { supported: false, reason: reason.message },
        structuredOutput: { supported: false, reason: reason.message },
        cancellation: { supported: false, reason: reason.message },
      },
      composition: translatedRuntimeCompositionIdentity(descriptor, providerProbe?.versions),
      limitations: unique([
        ...(providerProbe?.capabilities.limitations ?? []),
        reason.message,
        ...descriptor.losses.map((loss) => loss.summary),
      ]),
      unavailableReason: reason,
    },
    reason,
  }
}

function validateDescriptor(descriptor: TranslatedRuntimeAdapterPackDescriptor): void {
  if (
    !descriptor.id.trim() ||
    !descriptor.version.trim() ||
    descriptor.providerRuntime === descriptor.contractRuntime
  ) {
    throw new Error(
      "Translated adapter pack requires distinct, versioned provider and contract identities.",
    )
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
