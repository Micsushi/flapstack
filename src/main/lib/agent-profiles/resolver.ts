import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "../agent-runtime/compatibility"
import {
  runtimeAdapterForPreference,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type RuntimePreferenceSource,
} from "../../../shared/agent-runtime"
import {
  agentProfileResolveInputSchema,
  agentProfileVersionInputSchema,
  DEFAULT_AGENT_CAPABILITY,
  DEFAULT_AGENT_PRESENTATION,
  type AgentCapabilityProfile,
  type AgentPresentationStyle,
  type AgentProfileBoundedOverride,
  type AgentProfileLaunchPolicy,
  type AgentProfileRuntimeAuthority,
  type AgentProfileResolvedFieldSource,
  type AgentProfileVersionInput,
  type AgentProfileVersionRef,
  type ResolvedAgentProfileSnapshot,
  type StoredResolvedAgentProfileSnapshot,
} from "../../../shared/agent-profiles"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
  type CustomPermissionCapabilities,
} from "../../../shared/permission-capabilities"
import {
  canonicalJson,
  epochSeconds as epoch,
  optionalString as stringOrNull,
  sha256Text as sha256,
} from "./values"
import { resolveConfiguredAgentPersonality } from "./personality-resolution"
import type { ResolvedAgentPersonalityDocument } from "../../../shared/agent-personalities"
import { agentProfileSpeedCompatibility } from "../../../shared/agent-profile-speed"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export type AgentProfileRuntimeResolution = {
  preference: Exclude<AgentRuntimePreference, "auto">
  source: RuntimePreferenceSource | "profile"
  defaultVersion: number | null
  resolvedRuntime: ResolvedAgentRuntime
}

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
  personality: ResolvedAgentProfileSnapshot["personality"]
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
  "speedPreference",
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

  preview(
    inputValue: unknown,
    overrideLayer: "launch" | "workflow" = "launch",
    runtimeResolution?: AgentProfileRuntimeResolution,
  ) {
    const input = agentProfileResolveInputSchema.parse(inputValue)
    return this.resolve(
      input.profile,
      input.overrides,
      input.policy,
      overrideLayer,
      false,
      runtimeResolution,
    )
  }

  snapshot(
    profile: AgentProfileVersionRef,
    overrides: AgentProfileBoundedOverride | null,
    policy: AgentProfileLaunchPolicy,
    overrideLayer: "launch" | "workflow" = "launch",
    runtimeResolution?: AgentProfileRuntimeResolution,
  ): ResolvedAgentProfileSnapshot {
    return this.resolve(profile, overrides, policy, overrideLayer, true, runtimeResolution)
  }

  getSnapshot(snapshotId: string): StoredResolvedAgentProfileSnapshot {
    const row = this.sqlite
      .prepare("SELECT resolved_json FROM agent_profile_snapshots WHERE id = ?")
      .get(snapshotId) as { resolved_json: string } | undefined
    if (!row)
      throw new AgentProfileResolutionError("profile-missing", "Profile snapshot is missing.")
    return JSON.parse(row.resolved_json) as StoredResolvedAgentProfileSnapshot
  }

  private resolve(
    profile: AgentProfileVersionRef,
    overrides: AgentProfileBoundedOverride | null,
    policy: AgentProfileLaunchPolicy,
    overrideLayer: "launch" | "workflow",
    persist: boolean,
    runtimeResolutionInput?: AgentProfileRuntimeResolution,
  ): ResolvedAgentProfileSnapshot {
    const displayName = this.profileDisplayName(profile.profileId)
    const composed = this.compose(profile, [], null)
    applyOverrides(composed, overrides, overrideLayer, profile)
    const runtimeResolution = resolvedProfileRuntime(
      composed.capability.harness,
      composed.capability.runtimePreference,
      runtimeResolutionInput,
    )
    const conflicts = intersectPolicy(composed, policy, profile, runtimeResolution)
    const speed = agentProfileSpeedCompatibility(composed.capability, runtimeResolution)
    if (!speed.compatible) {
      conflicts.push({
        code: speed.code,
        field: "speedPreference",
        message: speed.message,
        repair: speed.repair,
      })
    }
    const evaluation = latestEvaluation(
      this.sqlite,
      profile,
      runtimeResolution.preference,
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
      schemaVersion: 2 as const,
      profile,
      displayName,
      capability: composed.capability,
      presentation: composed.presentation,
      personality: composed.personality,
      sources: composed.sources,
      conflicts,
      unresolvedRequirements: composed.unresolvedRequirements,
      runtimeResolution,
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
        personality: provenance.personalityRef ?? null,
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
    composed.personality = resolvePersonality(definition.personality, scope, identity)
    if (composed.personality) {
      applyPersonalityPresentation(composed, composed.personality, ref)
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
    personality: null,
    sources,
    unresolvedRequirements: [],
  }
}

function resolvePersonality(
  ref: AgentProfileVersionInput["personality"],
  scopeValue: { type: string; projectId: string | null },
  profileIdentity: string,
): ResolvedAgentProfileSnapshot["personality"] {
  if (!ref) return null
  const scope =
    scopeValue.type === "project"
      ? ({ type: "project", projectId: scopeValue.projectId! } as const)
      : scopeValue.type === "built-in"
        ? ({ type: "built-in", projectId: null } as const)
        : ({ type: "user", projectId: null } as const)
  let personality: ResolvedAgentPersonalityDocument
  try {
    personality = resolveConfiguredAgentPersonality(ref, scope)
  } catch (error) {
    throw new AgentProfileResolutionError(
      "profile-corrupt",
      `Agent Profile ${profileIdentity} references an unavailable exact Personality version: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  return {
    ref,
    metadata: personality.metadata,
    body: personality.body,
    digest: personality.digest,
    chain: personality.chain,
  }
}

function applyPersonalityPresentation(
  composed: Composed,
  personality: NonNullable<ResolvedAgentProfileSnapshot["personality"]>,
  profile: AgentProfileVersionRef,
): void {
  const traits = personality.metadata.traits
  composed.presentation.tone = traits.tone
  composed.presentation.verbosity = traits.verbosity
  composed.presentation.formatting = traits.formatting
  composed.presentation.responseStructure = traits.responseStructure
  composed.presentation.color = traits.color
  for (const field of ["tone", "verbosity", "formatting", "responseStructure", "color"] as const) {
    composed.sources[`presentation.${field}`] = source(
      "profile",
      profile,
      `Exact Personality ${personality.ref.personalityId}@${personality.ref.version}`,
    )
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
  if (overrides.speedPreference !== null) {
    composed.capability.speedPreference = overrides.speedPreference
    composed.sources["capability.speedPreference"] = source(
      layer,
      profile,
      "Bounded speed preference",
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
  runtimeResolution: AgentProfileRuntimeResolution,
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
  if (policy.allowedRuntimes && !policy.allowedRuntimes.includes(runtimeResolution.preference)) {
    conflicts.push({
      code: "runtime-policy-blocked",
      field: "runtimePreference",
      message: `Runtime ${runtimeResolution.preference} is outside the current durable Runtime policy.`,
      repair: "Choose the current project/chat Runtime or confirm a newly narrowed snapshot.",
    })
  }
  const compatibility = checkRuntimeCompatibility(
    capability.harness,
    runtimeResolution.resolvedRuntime,
  )
  if (!compatibility.compatible) {
    conflicts.push({
      code: compatibility.reason.code,
      field: "runtimePreference",
      message: compatibility.reason.message,
      repair: compatibility.reason.repair,
    })
  }
  if (runtimeResolution.resolvedRuntime === "codex") {
    conflicts.push({
      code: "runtime-tool-policy-unsupported",
      field: "tools",
      message:
        "Codex Agent Profile launch is unavailable because the Codex Runtime cannot prove enforcement of the frozen tool allowlist for no-approval tools.",
      repair:
        "Create a new Agent Profile version using the Claude Code harness, or wait for a Codex Runtime with complete per-tool enforcement.",
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
  snapshot: StoredResolvedAgentProfileSnapshot,
  policy: AgentProfileLaunchPolicy,
  frozenRuntimePreference: AgentRuntimePreference | null = null,
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
  const runtimePreference =
    frozenRuntimePreference ?? frozenAgentProfileRuntimeResolution(snapshot).preference
  if (policy.allowedRuntimes !== null && !policy.allowedRuntimes.includes(runtimePreference)) {
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

export function frozenAgentProfileRuntimeResolution(
  snapshot: StoredResolvedAgentProfileSnapshot,
): AgentProfileRuntimeResolution {
  if (snapshot.runtimeResolution) return snapshot.runtimeResolution
  const preference =
    snapshot.capability.runtimePreference === "auto"
      ? (snapshot.evaluation.runtime as AgentRuntimePreference)
      : snapshot.capability.runtimePreference
  const resolvedRuntime = runtimeAdapterForPreference(preference)
  if (!resolvedRuntime || preference === "auto") {
    throw new AgentProfileResolutionError(
      "profile-corrupt",
      "Legacy Agent Profile snapshot has no valid frozen Runtime evidence.",
    )
  }
  return {
    preference,
    source: snapshot.capability.runtimePreference === "auto" ? "product" : "profile",
    defaultVersion: null,
    resolvedRuntime,
  }
}

export function frozenAgentProfileRuntimeAuthority(
  snapshot: StoredResolvedAgentProfileSnapshot,
): AgentProfileRuntimeAuthority {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.digest,
    profile: structuredClone(snapshot.profile),
    allowedTools: [...snapshot.capability.tools],
    allowedSkills: [...snapshot.capability.skills],
    memoryPolicy: structuredClone(snapshot.capability.memoryPolicy),
    allowedDescendantProfileIds: [...snapshot.capability.allowedDescendantProfileIds],
    maxDescendants: snapshot.capability.maxDescendants,
  }
}

export function resolvedAgentProfileInstructions(
  snapshot: Pick<ResolvedAgentProfileSnapshot, "capability" | "personality" | "presentation">,
): string {
  return [
    snapshot.capability.instructions.trim(),
    snapshot.personality
      ? [
          `Exact Personality ${snapshot.personality.ref.personalityId}@${snapshot.personality.ref.version} (behavior and presentation only; this does not grant authority):`,
          snapshot.personality.body.trim(),
        ].join("\n")
      : null,
    `Presentation style only (no authority): tone=${snapshot.presentation.tone}; verbosity=${snapshot.presentation.verbosity}; formatting=${snapshot.presentation.formatting}; ${snapshot.presentation.responseStructure}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function resolvedProfileRuntime(
  harness: string,
  preference: AgentRuntimePreference,
  supplied?: AgentProfileRuntimeResolution,
): AgentProfileRuntimeResolution {
  if (preference !== "auto") {
    return {
      preference,
      source: "profile",
      defaultVersion: null,
      resolvedRuntime: runtimeAdapterForPreference(preference)!,
    }
  }
  if (supplied) {
    const expectedRuntime = runtimeAdapterForPreference(supplied.preference)
    if (expectedRuntime !== supplied.resolvedRuntime) {
      throw new Error("Resolved Agent Profile Runtime binding is inconsistent.")
    }
    return supplied
  }
  const productRuntime = productRuntimeForHarness(harness)
  return {
    preference: productRuntime,
    source: "product",
    defaultVersion: null,
    resolvedRuntime: productRuntime,
  }
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

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as unknown as { $client: Sqlite }).$client
}
