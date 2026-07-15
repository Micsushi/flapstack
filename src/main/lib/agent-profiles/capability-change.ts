import {
  DEFAULT_AGENT_CAPABILITY,
  type AgentCapabilityProfile,
  type AgentProfileVersionInput,
} from "../../../shared/agent-profiles"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
  type CustomPermissionCapabilities,
} from "../../../shared/permission-capabilities"

export type AgentProfileCapabilityChange = {
  kind: "presentation-only" | "narrowing" | "widening"
  narrowedFields: string[]
  widenedFields: string[]
}

export function classifyAgentProfileCapabilityChange(
  current: AgentProfileVersionInput | null,
  next: AgentProfileVersionInput,
): AgentProfileCapabilityChange {
  const before = current?.capability ?? DEFAULT_AGENT_CAPABILITY
  const after = next.capability
  const narrowed = new Set<string>()
  const widened = new Set<string>()
  comparePermission(before, after, narrowed, widened)
  compareSet("tools", before.tools, after.tools, narrowed, widened)
  compareSet("skills", before.skills, after.skills, narrowed, widened)
  compareSet(
    "allowedDescendantProfileIds",
    before.allowedDescendantProfileIds,
    after.allowedDescendantProfileIds,
    narrowed,
    widened,
  )
  compareNumber("maxDescendants", before.maxDescendants, after.maxDescendants, narrowed, widened)
  compareRuntimeSelection(before, after, widened)
  compareWorktree(before.worktreeStrategy, after.worktreeStrategy, narrowed, widened)
  if (
    next.base?.profileId !== current?.base?.profileId ||
    next.base?.version !== current?.base?.version ||
    canonical(next.inheritCapabilityFields) !== canonical(current?.inheritCapabilityFields ?? [])
  ) {
    widened.add("inheritance")
  }
  return {
    kind: widened.size > 0 ? "widening" : narrowed.size > 0 ? "narrowing" : "presentation-only",
    narrowedFields: [...narrowed].sort(),
    widenedFields: [...widened].sort(),
  }
}

function comparePermission(
  before: AgentCapabilityProfile,
  after: AgentCapabilityProfile,
  narrowed: Set<string>,
  widened: Set<string>,
) {
  const current = permissionCapabilities(before.permissionMode, before.customPermissions)
  const next = permissionCapabilities(after.permissionMode, after.customPermissions)
  for (const key of customPermissionCapabilityKeys) {
    if (current[key] && !next[key]) narrowed.add("permission")
    if (!current[key] && next[key]) widened.add("permission")
  }
}

function permissionCapabilities(
  mode: AgentCapabilityProfile["permissionMode"],
  custom: CustomPermissionCapabilities | null,
): CustomPermissionCapabilities {
  if (mode === "custom") return custom ?? disabledCustomPermissions
  const enabled = new Set<string>()
  if (mode === "ask-before-edits") enabled.add("productMcpRead")
  if (mode === "auto-edit-project-only") {
    enabled.add("projectWrite")
    enabled.add("productMcpRead")
  }
  if (mode === "full-access") {
    for (const key of customPermissionCapabilityKeys) enabled.add(key)
  }
  return {
    ...disabledCustomPermissions,
    ...Object.fromEntries(customPermissionCapabilityKeys.map((key) => [key, enabled.has(key)])),
  } as CustomPermissionCapabilities
}

function compareSet(
  field: string,
  before: string[],
  after: string[],
  narrowed: Set<string>,
  widened: Set<string>,
) {
  const current = new Set(before)
  const next = new Set(after)
  if (before.some((item) => !next.has(item))) narrowed.add(field)
  if (after.some((item) => !current.has(item))) widened.add(field)
}

function compareNumber(
  field: string,
  before: number,
  after: number,
  narrowed: Set<string>,
  widened: Set<string>,
) {
  if (after < before) narrowed.add(field)
  if (after > before) widened.add(field)
}

function compareRuntimeSelection(
  before: AgentCapabilityProfile,
  after: AgentCapabilityProfile,
  widened: Set<string>,
) {
  if (before.harness !== after.harness) widened.add("harness")
  if (before.runtimePreference !== after.runtimePreference) widened.add("runtimePreference")
  if (before.modelPreference !== after.modelPreference) widened.add("modelPreference")
}

function compareWorktree(
  before: AgentCapabilityProfile["worktreeStrategy"],
  after: AgentCapabilityProfile["worktreeStrategy"],
  narrowed: Set<string>,
  widened: Set<string>,
) {
  if (before === after) return
  if (after === "none") narrowed.add("worktreeStrategy")
  else widened.add("worktreeStrategy")
}

function canonical(value: unknown) {
  return JSON.stringify(value)
}
