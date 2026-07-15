import type {
  AgentRuntimeDefaultDto,
  AgentRuntimePreference,
  ResolvedAgentRuntime,
  RuntimeDefaultScope,
} from "../../../../shared/agent-runtime"
import { AGENT_HARNESSES, type AgentHarness } from "../../../../shared/harness-types"

export type RuntimeReleaseView = {
  runtime: ResolvedAgentRuntime
  enabledForNewLaunches: boolean
  reason: string | null
}

export type RuntimeSettingsRow = {
  harness: AgentHarness
  label: string
  selected: AgentRuntimePreference
  version: number
  inherited: AgentRuntimePreference | null
  options: Array<{
    value: AgentRuntimePreference
    label: string
    compatible: boolean
    available: boolean
    reason: string | null
  }>
}

const LABELS: Record<AgentHarness, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  "cursor-agent": "Cursor Agent",
  openrouter: "OpenRouter",
  nanogpt: "NanoGPT",
  local: "Local models",
}

export function runtimePreferenceLabel(preference: AgentRuntimePreference): string {
  if (preference === "auto") return "Automatic"
  if (preference === "codex") return "Codex"
  if (preference === "claude-code") return "Claude Code"
  return "Flapstack Native"
}

export function allowedRuntimePreferences(harness: string): AgentRuntimePreference[] {
  if (harness === "codex") return ["auto", "codex", "flapstack-native"]
  if (harness === "claude-code") return ["auto", "claude-code", "flapstack-native"]
  return ["auto", "flapstack-native"]
}

export function buildRuntimeSettingsRows(input: {
  scope: RuntimeDefaultScope
  defaults: AgentRuntimeDefaultDto[]
  releases: RuntimeReleaseView[]
}): RuntimeSettingsRow[] {
  const releases = new Map(input.releases.map((release) => [release.runtime, release]))
  const global = new Map(
    input.defaults
      .filter((entry) => entry.scope.type === "global")
      .map((entry) => [entry.harness, entry]),
  )
  const scoped = new Map(
    input.defaults
      .filter(
        (entry) =>
          entry.scope.type === input.scope.type &&
          (entry.scope.type === "global" || entry.scope.id === input.scope.id),
      )
      .map((entry) => [entry.harness, entry]),
  )
  return AGENT_HARNESSES.map((harness) => {
    const current = scoped.get(harness)
    const inherited =
      input.scope.type === "project" ? (global.get(harness)?.preference ?? null) : null
    const allowed = allowedRuntimePreferences(harness)
    return {
      harness,
      label: LABELS[harness],
      selected: current?.preference ?? "auto",
      version: current?.version ?? 0,
      inherited,
      options: (["auto", "codex", "claude-code", "flapstack-native"] as const).map((value) => {
        const compatible = allowed.includes(value)
        const resolved = value === "auto" ? productRuntime(harness) : value
        const release = releases.get(resolved)
        return {
          value,
          label: runtimePreferenceLabel(value),
          compatible,
          available: compatible && (release?.enabledForNewLaunches ?? true),
          reason: !compatible
            ? `${runtimePreferenceLabel(value)} is incompatible with ${LABELS[harness]}.`
            : (release?.reason ?? null),
        }
      }),
    }
  })
}

export function productRuntime(harness: string): ResolvedAgentRuntime {
  if (harness === "codex") return "codex"
  if (harness === "claude-code") return "claude-code"
  return "flapstack-native"
}
