import type {
  RuntimeBlockReason,
  RuntimeCapabilitySnapshot,
  RuntimeVersionSnapshot,
} from "../../../../shared/agent-runtime"

export const FLAPSTACK_NATIVE_ADAPTER_VERSION = "1.0.0"
export const FLAPSTACK_NATIVE_PROTOCOL_VERSION = "stage3-normalized-v1"

export type FlapstackNativeProviderPath =
  | "codex-acp"
  | "claude-transformed"
  | "cursor-stream-json"
  | "opencode-sidecar"
  | "local-model-loop"
  | "custom-provider"
  | "generic-provider"

export type FlapstackNativeCapabilityState = "supported" | "unsupported" | "provider-delegated"

export type FlapstackNativeLimitationCode =
  | "normalized-provider-events"
  | "legacy-reasoning-tool-bridge"
  | "native-provider-identity-may-be-unavailable"
  | "provider-session-remains-stage3-authority"
  | "reasoning-controls-remain-coupled"
  | "ordinary-streams-are-not-resumable"
  | "custom-provider-capabilities-are-delegated"

export type FlapstackNativeLimitation = {
  code: FlapstackNativeLimitationCode
  message: string
}

export type FlapstackNativeDiagnostics = {
  runtime: "flapstack-native"
  harness: string
  providerPath: FlapstackNativeProviderPath
  versions: RuntimeVersionSnapshot
  capabilities: {
    providerSessionResume: FlapstackNativeCapabilityState
    cancellation: FlapstackNativeCapabilityState
    continuation: "supported"
    historyReload: "supported"
    search: "supported"
    copy: "supported"
    export: "supported"
    losslessActivityProjection: FlapstackNativeCapabilityState
  }
  limitations: FlapstackNativeLimitation[]
}

type ProviderDescriptor = {
  path: FlapstackNativeProviderPath
  resume: FlapstackNativeCapabilityState
  cancellation: FlapstackNativeCapabilityState
  activity: FlapstackNativeCapabilityState
  limitations: FlapstackNativeLimitation[]
}

const NORMALIZED_EVENTS: FlapstackNativeLimitation = {
  code: "normalized-provider-events",
  message: "Provider events retain the Stage 3 normalized message and tool pipeline.",
}
const SESSION_AUTHORITY: FlapstackNativeLimitation = {
  code: "provider-session-remains-stage3-authority",
  message: "The existing provider path remains authoritative for session identity and resume.",
}
const IDENTITY_LIMIT: FlapstackNativeLimitation = {
  code: "native-provider-identity-may-be-unavailable",
  message:
    "Only events carrying stable provider identity are projected into durable Runtime activity.",
}

const DESCRIPTORS: Readonly<Record<string, ProviderDescriptor>> = {
  codex: {
    path: "codex-acp",
    resume: "supported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [
      NORMALIZED_EVENTS,
      SESSION_AUTHORITY,
      IDENTITY_LIMIT,
      {
        code: "legacy-reasoning-tool-bridge",
        message:
          "Post-turn Codex reasoning summaries keep the Stage 3 tool-ReasoningOutput bridge.",
      },
    ],
  },
  "claude-code": {
    path: "claude-transformed",
    resume: "supported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [
      NORMALIZED_EVENTS,
      SESSION_AUTHORITY,
      IDENTITY_LIMIT,
      {
        code: "legacy-reasoning-tool-bridge",
        message: "Claude thinking keeps the Stage 3 tool-ReasoningOutput bridge.",
      },
      {
        code: "reasoning-controls-remain-coupled",
        message:
          "Stage 3 Claude reasoning display, child forwarding, and hook controls remain coupled.",
      },
    ],
  },
  "cursor-agent": {
    path: "cursor-stream-json",
    resume: "supported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [NORMALIZED_EVENTS, SESSION_AUTHORITY, IDENTITY_LIMIT],
  },
  openrouter: {
    path: "opencode-sidecar",
    resume: "supported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [NORMALIZED_EVENTS, SESSION_AUTHORITY, IDENTITY_LIMIT],
  },
  nanogpt: {
    path: "opencode-sidecar",
    resume: "supported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [NORMALIZED_EVENTS, SESSION_AUTHORITY, IDENTITY_LIMIT],
  },
  local: {
    path: "local-model-loop",
    resume: "unsupported",
    cancellation: "supported",
    activity: "provider-delegated",
    limitations: [
      NORMALIZED_EVENTS,
      IDENTITY_LIMIT,
      {
        code: "ordinary-streams-are-not-resumable",
        message: "Ordinary local-model streams cannot resume after their owning process exits.",
      },
    ],
  },
  custom: {
    path: "custom-provider",
    resume: "provider-delegated",
    cancellation: "provider-delegated",
    activity: "provider-delegated",
    limitations: [
      NORMALIZED_EVENTS,
      IDENTITY_LIMIT,
      {
        code: "custom-provider-capabilities-are-delegated",
        message: "Custom-provider session and cancellation capabilities come from its delegation.",
      },
    ],
  },
  generic: {
    path: "generic-provider",
    resume: "provider-delegated",
    cancellation: "provider-delegated",
    activity: "provider-delegated",
    limitations: [
      NORMALIZED_EVENTS,
      IDENTITY_LIMIT,
      {
        code: "custom-provider-capabilities-are-delegated",
        message: "Generic-provider capabilities come from its delegation.",
      },
    ],
  },
}

export function flapstackNativeProviderPath(harness: string): FlapstackNativeProviderPath {
  return descriptorForHarness(harness).path
}

export function getFlapstackNativeDiagnostics(harness: string): FlapstackNativeDiagnostics {
  const descriptor = descriptorForHarness(harness)
  return {
    runtime: "flapstack-native",
    harness,
    providerPath: descriptor.path,
    versions: {
      adapterVersion: FLAPSTACK_NATIVE_ADAPTER_VERSION,
      protocolVersion: `${FLAPSTACK_NATIVE_PROTOCOL_VERSION}/${descriptor.path}`,
    },
    capabilities: {
      providerSessionResume: descriptor.resume,
      cancellation: descriptor.cancellation,
      continuation: "supported",
      historyReload: "supported",
      search: "supported",
      copy: "supported",
      export: "supported",
      losslessActivityProjection: descriptor.activity,
    },
    limitations: descriptor.limitations.map((limitation) => ({ ...limitation })),
  }
}

export function flapstackNativeCapabilitySnapshot(input: {
  harness: string
  available: boolean
  capturedAt?: string | null
  unavailableReason?: RuntimeBlockReason | null
}): RuntimeCapabilitySnapshot {
  const diagnostics = getFlapstackNativeDiagnostics(input.harness)
  const claude = input.harness === "claude-code"
  return {
    schemaVersion: 1,
    status: input.available ? "available" : "unavailable",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    controls: {
      modelThinking: {
        supported: claude,
        reason: claude
          ? null
          : "The Stage 3 provider path does not expose a separate thinking control.",
      },
      reasoningDisplay: { supported: true, reason: null },
      subagentActivity: {
        supported: claude,
        reason: claude ? null : "The Stage 3 provider path has no separate subagent control.",
      },
      hookDiagnostics: {
        supported: claude,
        reason: claude ? null : "The Stage 3 provider path has no separate hook control.",
      },
    },
    limitations: diagnostics.limitations.map(
      (limitation) => `${limitation.code}: ${limitation.message}`,
    ),
    unavailableReason: input.unavailableReason ?? null,
  }
}

function descriptorForHarness(harness: string): ProviderDescriptor {
  if (DESCRIPTORS[harness]) return DESCRIPTORS[harness]
  return DESCRIPTORS.generic
}
