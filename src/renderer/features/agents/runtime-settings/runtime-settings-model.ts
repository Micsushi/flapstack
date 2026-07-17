import {
  runtimeAdapterForPreference,
  type AgentRuntimeDefaultDto,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type RuntimeDefaultScope,
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
  if (preference === "codex-enhanced") return "Codex Enhanced"
  if (preference === "claude-code") return "Claude Code"
  if (preference === "claude-code-enhanced") return "Claude Code Enhanced"
  return "Flapstack Native"
}

export function allowedRuntimePreferences(harness: string): AgentRuntimePreference[] {
  if (harness === "codex") {
    return ["auto", "codex", "codex-enhanced", "flapstack-native"]
  }
  if (harness === "claude-code") {
    return ["auto", "claude-code", "claude-code-enhanced", "flapstack-native"]
  }
  return ["auto", "flapstack-native"]
}

export function resolveConfiguredRuntimePreference(input: {
  harness: string
  chatPreference: AgentRuntimePreference
  projectId?: string | null
  defaults: AgentRuntimeDefaultDto[]
}): Exclude<AgentRuntimePreference, "auto"> {
  if (input.chatPreference !== "auto") return input.chatPreference
  const project = input.projectId
    ? input.defaults.find(
        (entry) =>
          entry.scope.type === "project" &&
          entry.scope.id === input.projectId &&
          entry.harness === input.harness &&
          entry.preference !== "auto",
      )
    : null
  if (project && project.preference !== "auto") return project.preference
  const global = input.defaults.find(
    (entry) =>
      entry.scope.type === "global" &&
      entry.harness === input.harness &&
      entry.preference !== "auto",
  )
  if (global && global.preference !== "auto") return global.preference
  return productRuntime(input.harness)
}

export function resolvedRuntimeAdapter(
  preference: AgentRuntimePreference,
  harness: string,
): ResolvedAgentRuntime {
  return runtimeAdapterForPreference(preference) ?? productRuntime(harness)
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
      options: (
        [
          "auto",
          "codex",
          "codex-enhanced",
          "claude-code",
          "claude-code-enhanced",
          "flapstack-native",
        ] as const
      ).map((value) => {
        const compatible = allowed.includes(value)
        const resolved = runtimeAdapterForPreference(value) ?? productRuntime(harness)
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
