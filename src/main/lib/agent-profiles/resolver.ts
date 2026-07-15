import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "../agent-runtime/compatibility"
import {
  agentProfileResolveInputSchema,
  agentProfileVersionInputSchema,
  DEFAULT_AGENT_CAPABILITY,
  DEFAULT_AGENT_PRESENTATION,
  type AgentCapabilityProfile,
  type AgentPresentationStyle,
  type AgentProfileBoundedOverride,
  type AgentProfileLaunchPolicy,
  type AgentProfileResolvedFieldSource,
  type AgentProfileVersionInput,
  type AgentProfileVersionRef,
  type ResolvedAgentProfileSnapshot,
} from "../../../shared/agent-profiles"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
  type CustomPermissionCapabilities,
} from "../../../shared/permission-capabilities"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export class AgentProfileResolutionError extends Error {
  constructor(
    readonly code:
      | "profile-missing"
      | "profile-archived"
      | "profile-cycle"
      | "profile-scope-conflict"
      | "profile-corrupt",
    message: string,
  ) {
    super(message)
    this.name = "AgentProfileResolutionError"
  }
}

type Composed = {
  capability: AgentCapabilityProfile
  presentation: AgentPresentationStyle
  sources: Record<string, AgentProfileResolvedFieldSource>
  unresolvedRequirements: Array<{ kind: string; id: string; reason: string }>
}

const capabilityFields = [
  "role",
  "instructions",
  "harness",
  "runtimePreference",
  "modelPreference",
  "reasoningEffort",
  "tools",
  "skills",
  "permissionMode",
  "customPermissions",
  "memoryPolicy",
  "worktreeStrategy",
  "allowedDescendantProfileIds",
  "maxDescendants",
] as const
const presentationFields = [
  "tone",
  "verbosity",
  "formatting",
  "responseStructure",
  "characterLabel",
  "voiceLabel",
  "color",
] as const

export class AgentProfileResolver {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  preview(inputValue: unknown, overrideLayer: "launch" | "workflow" = "launch") {
    const input = agentProfileResolveInputSchema.parse(inputValue)
    return this.resolve(input.profile, input.overrides, input.policy, overrideLayer, false)
  }

  snapshot(
    profile: AgentProfileVersionRef,
    overrides: AgentProfileBoundedOverride | null,
    policy: AgentProfileLaunchPolicy,
    overrideLayer: "launch" | "workflow" = "launch",
  ): ResolvedAgentProfileSnapshot {
    return this.resolve(profile, overrides, policy, overrideLayer, true)
  }

  getSnapshot(snapshotId: string): ResolvedAgentProfileSnapshot {
    const row = this.sqlite
      .prepare("SELECT resolved_json FROM agent_profile_snapshots WHERE id = ?")
      .get(snapshotId) as { resolved_json: string } | undefined
    if (!row)
      throw new AgentProfileResolutionError("profile-missing", "Profile snapshot is missing.")
    return JSON.parse(row.resolved_json) as ResolvedAgentProfileSnapshot
  }

  private resolve(
    profile: AgentProfileVersionRef,
    overrides: AgentProfileBoundedOverride | null,
    policy: AgentProfileLaunchPolicy,
    overrideLayer: "launch" | "workflow",
    persist: boolean,
  ): ResolvedAgentProfileSnapshot {
    const displayName = this.profileDisplayName(profile.profileId)
    const composed = this.compose(profile, [], null)
    applyOverrides(composed, overrides, overrideLayer, profile)
    const conflicts = intersectPolicy(composed, policy, profile)
    const evaluation = latestEvaluation(
      this.sqlite,
      profile,
      resolvedRuntime(composed.capability.harness, composed.capability.runtimePreference),
      composed.capability.modelPreference,
    )
    if (isBuiltIn(this.sqlite, profile.profileId) && evaluation.state === "untested") {
      conflicts.push({
        code: "evaluation-required",
        field: "evaluation",
        message:
          "This built-in Agent Profile has no local evidence for the resolved Runtime/model.",
        repair:
          "Run the local profile evaluation for this exact version and Runtime/model before launch.",
      })
    }
    if (isBuiltIn(this.sqlite, profile.profileId) && evaluation.state === "failed") {
      conflicts.push({
        code: "evaluation-failed",
        field: "evaluation",
        message:
          "This built-in Agent Profile failed its latest local safety or compatibility gate.",
        repair: "Inspect the append-only evidence and use a corrected new profile version.",
      })
    }
    const body = {
      schemaVersion: 1 as const,
      profile,
      displayName,
      capability: composed.capability,
      presentation: composed.presentation,
      sources: composed.sources,
      conflicts,
      unresolvedRequirements: composed.unresolvedRequirements,
      evaluation,
    }
    const digest = sha256(canonicalJson(body))
    const existing = this.sqlite
      .prepare("SELECT resolved_json FROM agent_profile_snapshots WHERE digest = ?")
      .get(digest) as { resolved_json: string } | undefined
    if (existing) return JSON.parse(existing.resolved_json) as ResolvedAgentProfileSnapshot
    const snapshot: ResolvedAgentProfileSnapshot = {
      ...body,
      snapshotId: randomUUID(),
      resolvedAt: new Date().toISOString(),
      digest,
    }
    if (persist) {
      this.sqlite
        .prepare(
          `INSERT INTO agent_profile_snapshots
           (id, profile_id, profile_version, resolved_json, digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.snapshotId,
          profile.profileId,
          profile.version,
          JSON.stringify(snapshot),
          digest,
          epoch(),
        )
    }
    return snapshot
  }

  private profileDisplayName(profileId: string) {
    const row = this.sqlite
      .prepare("SELECT name FROM agent_profiles WHERE id = ?")
      .get(profileId) as { name: string } | undefined
    if (!row) {
      throw new AgentProfileResolutionError("profile-missing", "Agent Profile is missing.")
    }
    return row.name
  }

  private compose(
    ref: AgentProfileVersionRef,
    stack: string[],
    childScope: { type: string; projectId: string | null } | null,
  ): Composed {
    const identity = `${ref.profileId}@${ref.version}`
    if (stack.includes(identity)) {
      throw new AgentProfileResolutionError(
        "profile-cycle",
        `Agent Profile inheritance cycle: ${[...stack, identity].join(" -> ")}.`,
      )
    }
    const row = this.sqlite
      .prepare(
        `SELECT p.scope_type, p.project_id, p.archived_at, v.*
         FROM agent_profiles p JOIN agent_profile_versions v ON v.profile_id = p.id
         WHERE p.id = ? AND v.version = ?`,
      )
      .get(ref.profileId, ref.version) as Row | undefined
    if (!row) {
      throw new AgentProfileResolutionError(
        "profile-missing",
        `Agent Profile ${identity} is missing.`,
      )
    }
    if (stack.length === 0 && row.archived_at !== null && row.archived_at !== undefined) {
      throw new AgentProfileResolutionError(
        "profile-archived",
        `Agent Profile ${identity} is archived. Restore or replace it before a new launch.`,
      )
    }
    const scope = { type: String(row.scope_type), projectId: stringOrNull(row.project_id) }
    if (
      childScope &&
      scope.type === "project" &&
      (childScope.type !== "project" || childScope.projectId !== scope.projectId)
    ) {
      throw new AgentProfileResolutionError(
        "profile-scope-conflict",
        "A project profile cannot inherit from another project's profile.",
      )
    }
    let definition: AgentProfileVersionInput
    let provenance: Record<string, unknown>
    try {
      provenance = JSON.parse(String(row.provenance_json)) as Record<string, unknown>
      definition = agentProfileVersionInputSchema.parse({
        base:
          row.base_profile_id && row.base_profile_version
            ? { profileId: String(row.base_profile_id), version: Number(row.base_profile_version) }
            : null,
        capability: JSON.parse(String(row.capability_json)),
        presentation: JSON.parse(String(row.presentation_json)),
        inheritCapabilityFields: provenance.inheritCapabilityFields ?? [],
        inheritPresentationFields: provenance.inheritPresentationFields ?? [],
      })
    } catch {
      throw new AgentProfileResolutionError(
        "profile-corrupt",
        `Agent Profile ${identity} is corrupt.`,
      )
    }
    const composed = definition.base
      ? this.compose(definition.base, [...stack, identity], scope)
      : defaults()
    const inheritedCapabilities = new Set(definition.inheritCapabilityFields)
    const inheritedPresentation = new Set(definition.inheritPresentationFields)
    for (const field of capabilityFields) {
      if (inheritedCapabilities.has(field)) continue
      assign(composed.capability, field, definition.capability[field])
      composed.sources[`capability.${field}`] = source("profile", ref, "Exact profile version")
    }
    for (const field of presentationFields) {
      if (inheritedPresentation.has(field)) continue
      assign(composed.presentation, field, definition.presentation[field])
      composed.sources[`presentation.${field}`] = source("profile", ref, "Exact profile version")
    }
    composed.unresolvedRequirements = mergeRequirements(
      composed.unresolvedRequirements,
      parseDisabledRequirements(provenance.disabledRequirements),
    )
    return composed
  }
}

function defaults(): Composed {
  const sources: Record<string, AgentProfileResolvedFieldSource> = {}
  for (const field of capabilityFields)
    sources[`capability.${field}`] = source("default", null, "Built-in safe default")
  for (const field of presentationFields)
    sources[`presentation.${field}`] = source("default", null, "Built-in style default")
  return {
    capability: structuredClone(DEFAULT_AGENT_CAPABILITY),
    presentation: structuredClone(DEFAULT_AGENT_PRESENTATION),
    sources,
    unresolvedRequirements: [],
  }
}

function parseDisabledRequirements(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    return typeof item.kind === "string" &&
      typeof item.id === "string" &&
      typeof item.reason === "string"
      ? [{ kind: item.kind, id: item.id, reason: item.reason }]
      : []
  })
}

function mergeRequirements(
  left: Array<{ kind: string; id: string; reason: string }>,
  right: Array<{ kind: string; id: string; reason: string }>,
) {
  return [
    ...new Map([...left, ...right].map((item) => [`${item.kind}\0${item.id}`, item])).values(),
  ]
}

function applyOverrides(
  composed: Composed,
  overrides: AgentProfileBoundedOverride | null,
  layer: "launch" | "workflow",
  profile: AgentProfileVersionRef,
) {
  if (!overrides) return
  if (overrides.instructionAppend) {
    composed.capability.instructions = `${composed.capability.instructions}\n\n${overrides.instructionAppend}`
    composed.sources["capability.instructions"] = source(
      layer,
      profile,
      "Bounded instruction append",
    )
  }
  if (overrides.modelPreference !== null) {
    composed.capability.modelPreference = overrides.modelPreference
    composed.sources["capability.modelPreference"] = source(
      layer,
      profile,
      "Bounded model preference",
    )
  }
  if (overrides.reasoningEffort !== null) {
    composed.capability.reasoningEffort = overrides.reasoningEffort
    composed.sources["capability.reasoningEffort"] = source(
      layer,
      profile,
      "Bounded effort preference",
    )
  }
  if (overrides.presentation) {
    for (const [field, value] of Object.entries(overrides.presentation)) {
      if (field === "schemaVersion" || value === undefined) continue
      ;(composed.presentation as unknown as Record<string, unknown>)[field] = value
      composed.sources[`presentation.${field}`] = source(
        layer,
        profile,
        "Presentation-only override",
      )
    }
  }
}

function intersectPolicy(
  composed: Composed,
  policy: AgentProfileLaunchPolicy,
  profile: AgentProfileVersionRef,
) {
  const conflicts: ResolvedAgentProfileSnapshot["conflicts"] = []
  const capability = composed.capability
  if (policy.allowedTools) {
    const allowed = new Set(policy.allowedTools)
    const removed = capability.tools.filter((item) => !allowed.has(item))
    capability.tools = capability.tools.filter((item) => allowed.has(item))
    if (removed.length) conflicts.push(narrowed("tools", removed))
    composed.sources["capability.tools"] = source(
      "policy",
      profile,
      "Task/project tool intersection",
    )
  }
  if (policy.allowedSkills) {
    const allowed = new Set(policy.allowedSkills)
    const removed = capability.skills.filter((item) => !allowed.has(item))
    capability.skills = capability.skills.filter((item) => allowed.has(item))
    if (removed.length) conflicts.push(narrowed("skills", removed))
    composed.sources["capability.skills"] = source(
      "policy",
      profile,
      "Task/project skill intersection",
    )
  }
  if (
    capability.modelPreference &&
    policy.allowedModels &&
    !policy.allowedModels.includes(capability.modelPreference)
  ) {
    conflicts.push({
      code: "model-blocked",
      field: "modelPreference",
      message: `Model ${capability.modelPreference} is outside the current model policy.`,
      repair: "Choose an allowed model or update policy through its existing approval path.",
    })
  }
  const runtime = resolvedRuntime(capability.harness, capability.runtimePreference)
  if (policy.allowedRuntimes && !policy.allowedRuntimes.includes(runtime)) {
    conflicts.push({
      code: "runtime-policy-blocked",
      field: "runtimePreference",
      message: `Runtime ${runtime} is outside the current durable Runtime policy.`,
      repair: "Choose the current project/chat Runtime or confirm a newly narrowed snapshot.",
    })
  }
  const compatibility = checkRuntimeCompatibility(capability.harness, runtime)
  if (!compatibility.compatible) {
    conflicts.push({
      code: compatibility.reason.code,
      field: "runtimePreference",
      message: compatibility.reason.message,
      repair: compatibility.reason.repair,
    })
  }
  const permission = intersectAgentProfilePermissions(
    capability.permissionMode,
    capability.customPermissions,
    policy.permissionMode,
    policy.customPermissions,
  )
  if (permission.narrowed) {
    conflicts.push({
      code: "permission-narrowed",
      field: "permissionMode",
      message: "Profile permission was narrowed by current launch policy.",
      repair: "Use the existing explicit approval path to change task/project authority.",
    })
  }
  capability.permissionMode = permission.mode
  capability.customPermissions = permission.custom
  composed.sources["capability.permissionMode"] = source(
    "policy",
    profile,
    "Authority intersection",
  )
  composed.sources["capability.customPermissions"] = source(
    "policy",
    profile,
    "Authority intersection",
  )
  if (capability.maxDescendants > policy.maxDescendants) {
    capability.maxDescendants = policy.maxDescendants
    conflicts.push({
      code: "descendants-narrowed",
      field: "maxDescendants",
      message: "Profile descendant limit was narrowed by orchestration policy.",
      repair: "Use the existing orchestration policy approval path to widen descendants.",
    })
    composed.sources["capability.maxDescendants"] = source(
      "policy",
      profile,
      "Orchestration descendant limit",
    )
  }
  return conflicts
}

export function intersectAgentProfilePermissions(
  requestedMode: AgentCapabilityProfile["permissionMode"],
  requestedCustom: CustomPermissionCapabilities | null,
  policyMode: AgentProfileLaunchPolicy["permissionMode"],
  policyCustom: CustomPermissionCapabilities | null,
) {
  const requested = permissionCapabilities(requestedMode, requestedCustom)
  const allowed = permissionCapabilities(policyMode, policyCustom)
  const custom = {
    ...disabledCustomPermissions,
    ...Object.fromEntries(
      customPermissionCapabilityKeys.map((key) => [key, requested[key] && allowed[key]]),
    ),
  } as CustomPermissionCapabilities
  const narrowed = customPermissionCapabilityKeys.some((key) => requested[key] !== custom[key])
  if (!narrowed && requestedMode !== "custom") {
    return { mode: requestedMode, custom: null, narrowed: false }
  }
  return { mode: "custom" as const, custom, narrowed }
}

export function agentProfileSnapshotPolicyViolations(
  snapshot: ResolvedAgentProfileSnapshot,
  policy: AgentProfileLaunchPolicy,
) {
  const violations: string[] = []
  const permission = intersectAgentProfilePermissions(
    snapshot.capability.permissionMode,
    snapshot.capability.customPermissions,
    policy.permissionMode,
    policy.customPermissions,
  )
  if (
    permission.mode !== snapshot.capability.permissionMode ||
    canonicalJson(permission.custom) !== canonicalJson(snapshot.capability.customPermissions)
  ) {
    violations.push("permission")
  }
  if (
    policy.allowedTools !== null &&
    snapshot.capability.tools.some((tool) => !policy.allowedTools!.includes(tool))
  ) {
    violations.push("tools")
  }
  if (
    policy.allowedSkills !== null &&
    snapshot.capability.skills.some((skill) => !policy.allowedSkills!.includes(skill))
  ) {
    violations.push("skills")
  }
  if (
    snapshot.capability.modelPreference !== null &&
    policy.allowedModels !== null &&
    !policy.allowedModels.includes(snapshot.capability.modelPreference)
  ) {
    violations.push("model")
  }
  const runtime = resolvedRuntime(
    snapshot.capability.harness,
    snapshot.capability.runtimePreference,
  )
  if (policy.allowedRuntimes !== null && !policy.allowedRuntimes.includes(runtime)) {
    violations.push("runtime")
  }
  if (snapshot.capability.maxDescendants > policy.maxDescendants) {
    violations.push("descendants")
  }
  return violations
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
  if (mode === "full-access") for (const key of customPermissionCapabilityKeys) enabled.add(key)
  return {
    ...disabledCustomPermissions,
    ...Object.fromEntries(customPermissionCapabilityKeys.map((key) => [key, enabled.has(key)])),
  } as CustomPermissionCapabilities
}

function latestEvaluation(
  db: Sqlite,
  profile: AgentProfileVersionRef,
  runtime: string,
  model: string | null,
): ResolvedAgentProfileSnapshot["evaluation"] {
  const modelKey = model ?? "default-unpinned"
  const row = db
    .prepare(
      `SELECT state, evidence_digest FROM agent_profile_evaluations
       WHERE profile_id = ? AND profile_version = ? AND runtime = ? AND model = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(profile.profileId, profile.version, runtime, modelKey) as Row | undefined
  return {
    state: (row?.state as ResolvedAgentProfileSnapshot["evaluation"]["state"]) ?? "untested",
    runtime,
    model: modelKey,
    evidenceDigest: row ? String(row.evidence_digest) : null,
  }
}

function isBuiltIn(db: Sqlite, profileId: string) {
  const row = db.prepare("SELECT source FROM agent_profiles WHERE id = ?").get(profileId) as
    { source: string } | undefined
  return row?.source === "built-in"
}

function resolvedRuntime(harness: string, preference: string) {
  return preference === "auto"
    ? productRuntimeForHarness(harness)
    : (preference as "codex" | "claude-code" | "flapstack-native")
}

function source(
  layer: AgentProfileResolvedFieldSource["layer"],
  profile: AgentProfileVersionRef | null,
  note: string,
): AgentProfileResolvedFieldSource {
  return { layer, profileId: profile?.profileId ?? null, version: profile?.version ?? null, note }
}

function narrowed(field: string, removed: string[]) {
  return {
    code: `${field}-narrowed`,
    field,
    message: `Current policy disabled: ${removed.join(", ")}.`,
    repair: "Use the existing capability approval path to widen policy.",
  }
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  target[key] = structuredClone(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as unknown as { $client: Sqlite }).$client
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function epoch() {
  return Math.floor(Date.now() / 1_000)
}
