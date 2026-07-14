import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"
import type { ProviderExtensionManifest } from "../provider-extensions"
import type { ExtensionHarness, ExtensionKind } from "./capability-registry"
import type { ExtensionPolicyTarget } from "./enablement-policy"

export type ExtensionRuntimeEnforcement = {
  support: "supported" | "unsupported"
  contract: string
  reason: string | null
}

export type ExtensionLaunchPolicy = {
  harness: ExtensionHarness
  fingerprint: string
  claudeSkillAllowlist: string[] | null
  disabledMcpNames: string[]
  codexDisabledSkillPaths: string[]
}

type ResolvedRuntimeEntry = {
  extension: ProviderExtensionManifest
  resolved: {
    support: "supported" | "unsupported"
    enabled: boolean
    target: ExtensionPolicyTarget
  }
}

const CLAUDE_SKILL_CONTRACT = "Claude Agent SDK options.skills allowlist"
const CLAUDE_MCP_CONTRACT = "Claude Agent SDK strictMcpConfig with app-filtered mcpServers"
const CODEX_SKILL_CONTRACT = "Codex session config skills.config exact-path disablement"
const CODEX_MCP_CONTRACT = "Codex session config mcp_servers.<name>.enabled=false"

export class ExtensionPolicyRunBlockedError extends Error {
  readonly code = "EXTENSION_POLICY_RUN_BLOCKED"

  constructor(
    readonly harness: ExtensionHarness,
    readonly blockedExtensionIds: string[],
    message: string,
  ) {
    super(message)
    this.name = "ExtensionPolicyRunBlockedError"
  }
}

export function getExtensionRuntimeEnforcementSupport(
  target: ExtensionPolicyTarget,
): ExtensionRuntimeEnforcement {
  if (target.harness === "claude-code" && target.kind === "skill") {
    return { support: "supported", contract: CLAUDE_SKILL_CONTRACT, reason: null }
  }
  if (target.harness === "claude-code" && target.kind === "mcp") {
    return { support: "supported", contract: CLAUDE_MCP_CONTRACT, reason: null }
  }
  if (target.harness === "codex" && target.kind === "skill") {
    return { support: "supported", contract: CODEX_SKILL_CONTRACT, reason: null }
  }
  if (target.harness === "codex" && target.kind === "mcp") {
    return { support: "supported", contract: CODEX_MCP_CONTRACT, reason: null }
  }

  return {
    support: "unsupported",
    contract: "fail-closed launch block",
    reason: `${target.harness} exposes no supported per-${target.kind} native discovery filter for managed runs.`,
  }
}

export function buildExtensionLaunchPolicy(
  harness: ExtensionHarness,
  state: ResolvedRuntimeEntry[],
): ExtensionLaunchPolicy {
  const disabled = state.filter(
    (entry) => entry.resolved.support === "supported" && !entry.resolved.enabled,
  )
  const unsupported = disabled.filter(
    (entry) =>
      getExtensionRuntimeEnforcementSupport(entry.resolved.target).support === "unsupported",
  )
  if (unsupported.length > 0) {
    throw blocked(
      harness,
      unsupported,
      getExtensionRuntimeEnforcementSupport(unsupported[0]!.resolved.target).reason ??
        "Native discovery suppression is unsupported.",
    )
  }

  const disabledSkills = disabled.filter((entry) => entry.resolved.target.kind === "skill")
  const disabledMcp = disabled.filter((entry) => entry.resolved.target.kind === "mcp")
  assertNoNameCollision(harness, "mcp", state, disabledMcp)

  let claudeSkillAllowlist: string[] | null = null
  let codexDisabledSkillPaths: string[] = []
  if (harness === "claude-code" && disabledSkills.length > 0) {
    assertNoNameCollision(harness, "skill", state, disabledSkills)
    claudeSkillAllowlist = uniqueSorted(
      state
        .filter(
          (entry) =>
            entry.resolved.support === "supported" &&
            entry.resolved.enabled &&
            entry.resolved.target.kind === "skill",
        )
        .map((entry) => entry.extension.name),
    )
  }
  if (harness === "codex" && disabledSkills.length > 0) {
    codexDisabledSkillPaths = uniqueSorted(
      disabledSkills.map((entry) => {
        const path = entry.extension.sourceId
        if (!isAbsolute(path)) {
          throw blocked(harness, [entry], "Codex skill policy requires an absolute SKILL.md path.")
        }
        return path
      }),
    )
  }

  const disabledMcpNames = uniqueSorted(disabledMcp.map((entry) => entry.extension.name))
  const fingerprintSource = {
    harness,
    claudeSkillAllowlist,
    disabledMcpNames,
    codexDisabledSkillPaths,
  }
  return {
    ...fingerprintSource,
    fingerprint: createHash("sha256").update(JSON.stringify(fingerprintSource)).digest("hex"),
  }
}

export function getClaudeExtensionSdkOptions(policy: ExtensionLaunchPolicy): {
  skills?: string[]
  strictMcpConfig?: true
} {
  assertHarness(policy, "claude-code")
  return {
    ...(policy.claudeSkillAllowlist ? { skills: policy.claudeSkillAllowlist } : {}),
    ...(policy.disabledMcpNames.length > 0 ? { strictMcpConfig: true as const } : {}),
  }
}

export function filterClaudeExtensionMcpServers<T>(
  servers: Record<string, T> | undefined,
  policy: ExtensionLaunchPolicy,
): Record<string, T> | undefined {
  assertHarness(policy, "claude-code")
  if (!servers || policy.disabledMcpNames.length === 0) return servers
  const disabled = new Set(policy.disabledMcpNames)
  return Object.fromEntries(Object.entries(servers).filter(([name]) => !disabled.has(name)))
}

export function applyCodexExtensionPolicyConfig(
  config: Record<string, unknown>,
  policy: ExtensionLaunchPolicy,
): Record<string, unknown> {
  assertHarness(policy, "codex")
  let result = { ...config }

  if (policy.codexDisabledSkillPaths.length > 0) {
    const skills = isRecord(result.skills) ? result.skills : {}
    const existingRows = Array.isArray(skills.config) ? skills.config.filter(isRecord) : []
    const disabledPaths = new Set(policy.codexDisabledSkillPaths)
    result = {
      ...result,
      skills: {
        ...skills,
        config: [
          ...existingRows.filter(
            (row) => typeof row.path !== "string" || !disabledPaths.has(row.path),
          ),
          ...policy.codexDisabledSkillPaths.map((path) => ({ path, enabled: false })),
        ],
      },
    }
  }

  if (policy.disabledMcpNames.length > 0) {
    const mcpServers = isRecord(result.mcp_servers) ? result.mcp_servers : {}
    result = {
      ...result,
      mcp_servers: {
        ...mcpServers,
        ...Object.fromEntries(
          policy.disabledMcpNames.map((name) => {
            const existing = isRecord(mcpServers[name]) ? mcpServers[name] : {}
            return [name, { ...existing, enabled: false }]
          }),
        ),
      },
    }
  }

  return result
}

export function filterCodexExtensionMcpServers<T extends { name: string }>(
  servers: T[],
  policy: ExtensionLaunchPolicy,
): T[] {
  assertHarness(policy, "codex")
  if (policy.disabledMcpNames.length === 0) return servers
  const disabled = new Set(policy.disabledMcpNames)
  return servers.filter((server) => !disabled.has(server.name))
}

function assertNoNameCollision(
  harness: ExtensionHarness,
  kind: ExtensionKind,
  state: ResolvedRuntimeEntry[],
  disabled: ResolvedRuntimeEntry[],
): void {
  if (disabled.length === 0) return
  const disabledNames = new Set(disabled.map((entry) => entry.extension.name))
  const collision = state.find(
    (entry) =>
      entry.resolved.support === "supported" &&
      entry.resolved.enabled &&
      entry.resolved.target.kind === kind &&
      disabledNames.has(entry.extension.name),
  )
  if (!collision) return
  throw blocked(
    harness,
    [...disabled, collision],
    `${harness} filters ${kind} discovery by name, so conflicting enabled and disabled native entries cannot be isolated safely.`,
  )
}

function blocked(
  harness: ExtensionHarness,
  entries: ResolvedRuntimeEntry[],
  reason: string,
): ExtensionPolicyRunBlockedError {
  const ids = uniqueSorted(entries.map((entry) => entry.extension.id))
  return new ExtensionPolicyRunBlockedError(
    harness,
    ids,
    `Run blocked: disabled extension policy cannot be enforced for ${ids.join(", ")}. ${reason}`,
  )
}

function assertHarness(policy: ExtensionLaunchPolicy, harness: ExtensionHarness): void {
  if (policy.harness !== harness) {
    throw new Error(`Extension launch policy for ${policy.harness} cannot configure ${harness}`)
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
