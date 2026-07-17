import {
  DEFAULT_RUNTIME_CONTROLS,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type ResolvedRuntimeLaunch,
  type RuntimeAdapterProbe,
  type RuntimeBlockReason,
  type RuntimeLaunchControls,
  type RuntimePermissionSnapshot,
  type RuntimePreferenceSource,
  runtimeAdapterForPreference,
} from "../../../shared/agent-runtime"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "./compatibility"

export type RuntimeResolutionInput = {
  harness: string
  model?: string | null
  chatPreference?: AgentRuntimePreference | null
  projectPreference?: AgentRuntimePreference | null
  globalPreference?: AgentRuntimePreference | null
  controls?: Partial<Omit<RuntimeLaunchControls, "schemaVersion">>
  permission: RuntimePermissionSnapshot
  adapterProbes?: Partial<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>>
}

export type RuntimeResolutionResult =
  { ok: true; launch: ResolvedRuntimeLaunch } | { ok: false; reason: RuntimeBlockReason }

export class AgentRuntimeResolutionError extends Error {
  constructor(readonly reason: RuntimeBlockReason) {
    super(reason.message)
    this.name = "AgentRuntimeResolutionError"
  }
}

export function resolveAgentRuntime(input: RuntimeResolutionInput): RuntimeResolutionResult {
  const selected = selectPreference(input)
  const compatibility = checkRuntimeCompatibility(input.harness, selected.runtime)
  if (!compatibility.compatible) return { ok: false, reason: compatibility.reason }

  const probe = input.adapterProbes?.[selected.runtime]
  if (probe && !probe.available) {
    return {
      ok: false,
      reason:
        probe.reason ??
        unavailableReason(input.harness, selected.runtime, "The Runtime adapter is unavailable."),
    }
  }

  const capabilities =
    probe?.capabilities ??
    ({
      schemaVersion: 1,
      status: "unprobed",
      capturedAt: null,
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      limitations: ["Adapter capability probe has not run."],
      unavailableReason: null,
    } as const)

  return {
    ok: true,
    launch: {
      schemaVersion: 1,
      harness: input.harness,
      model: input.model ?? null,
      requestedPreference: selected.preference,
      preferenceSource: selected.source,
      resolvedRuntime: selected.runtime,
      compatibility,
      versions: probe?.versions ?? {
        adapterVersion: "unresolved",
        protocolVersion: "unresolved",
      },
      capabilities,
      controls: { ...DEFAULT_RUNTIME_CONTROLS, ...input.controls, schemaVersion: 1 },
      permission: input.permission,
    },
  }
}

export function assertResolvedAgentRuntime(input: RuntimeResolutionInput): ResolvedRuntimeLaunch {
  const result = resolveAgentRuntime(input)
  if (!result.ok) throw new AgentRuntimeResolutionError(result.reason)
  return result.launch
}

function selectPreference(input: RuntimeResolutionInput): {
  preference: AgentRuntimePreference
  runtime: ResolvedAgentRuntime
  source: RuntimePreferenceSource
} {
  const candidates: Array<[RuntimePreferenceSource, AgentRuntimePreference | null | undefined]> = [
    ["chat", input.chatPreference],
    ["project", input.projectPreference],
    ["global", input.globalPreference],
  ]
  for (const [source, preference] of candidates) {
    if (preference !== null && preference !== undefined && preference !== "auto") {
      return {
        preference,
        runtime: runtimeAdapterForPreference(preference)!,
        source,
      }
    }
  }
  const runtime = productRuntimeForHarness(input.harness)
  return {
    preference: runtime,
    runtime,
    source: "product",
  }
}

function unavailableReason(
  harness: string,
  runtime: ResolvedAgentRuntime,
  message: string,
): RuntimeBlockReason {
  return {
    code: "runtime-unavailable",
    harness,
    runtime,
    message,
    repair: "Choose another compatible Runtime or repair the adapter capability probe.",
  }
}
