import type { RuntimeAdapterProbe, RuntimeBlockReason } from "../../../../shared/agent-runtime"
import {
  CLAUDE_AGENT_SDK_VERSION,
  CLAUDE_CODE_VERSION,
  CLAUDE_RUNTIME_ADAPTER_VERSION,
  CLAUDE_RUNTIME_PROTOCOL_VERSION,
  type ClaudeRuntimeProbeInput,
} from "./types"

const REQUIRED_FEATURES: ReadonlyArray<keyof ClaudeRuntimeProbeInput["features"]> = [
  "partialMessages",
  "thinking",
  "hooks",
  "subagentForwarding",
  "resume",
  "resumeAt",
  "fork",
  "cancellation",
]

export function probeClaudeCodeRuntime(input: ClaudeRuntimeProbeInput): RuntimeAdapterProbe {
  const limitations: string[] = []
  let reason: RuntimeBlockReason | null = null

  if (!input.available) {
    reason = unavailable(
      input.unavailableReason || "Claude Agent SDK or Claude Code is unavailable.",
    )
  } else if (input.sdkVersion !== CLAUDE_AGENT_SDK_VERSION) {
    reason = unavailable(
      `Claude Agent SDK ${input.sdkVersion || "unknown"} is not the pinned ${CLAUDE_AGENT_SDK_VERSION}.`,
      "protocol-unsupported",
    )
  } else if (input.claudeCodeVersion !== CLAUDE_CODE_VERSION) {
    reason = unavailable(
      `Claude Code ${input.claudeCodeVersion || "unknown"} is not the pinned ${CLAUDE_CODE_VERSION}.`,
      "protocol-unsupported",
    )
  } else {
    const missing = REQUIRED_FEATURES.filter((feature) => !input.features[feature])
    if (missing.length > 0) {
      reason = unavailable(
        `Claude runtime is missing required capabilities: ${missing.join(", ")}.`,
        "protocol-unsupported",
      )
    }
  }

  if (reason) limitations.push(reason.message)

  return {
    runtime: "claude-code",
    harness: "claude-code",
    available: reason === null,
    versions: {
      adapterVersion: CLAUDE_RUNTIME_ADAPTER_VERSION,
      protocolVersion: CLAUDE_RUNTIME_PROTOCOL_VERSION,
    },
    capabilities: {
      schemaVersion: 1,
      status: reason ? "unavailable" : "available",
      capturedAt: new Date().toISOString(),
      controls: {
        modelThinking: supported(reason),
        reasoningDisplay: supported(reason),
        subagentActivity: supported(reason),
        hookDiagnostics: supported(reason),
      },
      execution: {
        continuation: supported(reason),
        delegation: supported(reason),
        structuredOutput: supported(reason),
        cancellation: supported(reason),
      },
      limitations,
      unavailableReason: reason,
    },
    reason,
  }
}

function supported(reason: RuntimeBlockReason | null) {
  return reason ? { supported: false, reason: reason.message } : { supported: true, reason: null }
}

function unavailable(
  message: string,
  code: RuntimeBlockReason["code"] = "runtime-unavailable",
): RuntimeBlockReason {
  return {
    code,
    message,
    harness: "claude-code",
    runtime: "claude-code",
    repair:
      code === "protocol-unsupported"
        ? `Install the pinned Claude Agent SDK ${CLAUDE_AGENT_SDK_VERSION} and Claude Code ${CLAUDE_CODE_VERSION}.`
        : "Install or enable the pinned Claude Code runtime, then probe again.",
  }
}
