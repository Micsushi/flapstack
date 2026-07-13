import type { HarnessProvider } from "../../../shared/harness-types"
import type { AgentInputCapability } from "../../../shared/agent-input"

const CONTINUATION_LIMITATION =
  "This installed harness does not expose a verified pausable structured-input request; answers continue as a normal user turn."

const BUILTIN_CAPABILITIES: Readonly<Record<HarnessProvider, AgentInputCapability>> = {
  "claude-code": { mode: "native", sameRun: true },
  codex: { mode: "continuation", sameRun: false, limitation: CONTINUATION_LIMITATION },
  "cursor-agent": { mode: "continuation", sameRun: false, limitation: CONTINUATION_LIMITATION },
  openrouter: { mode: "continuation", sameRun: false, limitation: CONTINUATION_LIMITATION },
  nanogpt: { mode: "continuation", sameRun: false, limitation: CONTINUATION_LIMITATION },
  local: { mode: "unsupported", sameRun: false, limitation: "No local agent loop is registered." },
  custom: {
    mode: "unsupported",
    sameRun: false,
    limitation: "The custom harness did not declare structured-input support.",
  },
}

const registrations = new Map<string, AgentInputCapability>(Object.entries(BUILTIN_CAPABILITIES))

export function registerAgentInputCapability(
  harness: string,
  capability: AgentInputCapability,
): () => void {
  const previous = registrations.get(harness)
  registrations.set(harness, { ...capability })
  return () => {
    if (previous) registrations.set(harness, previous)
    else registrations.delete(harness)
  }
}

export function getAgentInputCapability(harness: string): AgentInputCapability {
  return (
    registrations.get(harness) ?? {
      mode: "unsupported",
      sameRun: false,
      limitation: `Harness ${harness} has not declared structured-input support.`,
    }
  )
}

export function listAgentInputCapabilities(): Array<{
  harness: string
  capability: AgentInputCapability
}> {
  return [...registrations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([harness, capability]) => ({ harness, capability: { ...capability } }))
}
