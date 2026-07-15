import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import {
  agentProfileArchiveInputSchema,
  agentProfileBundleSchema,
  agentProfileCreateInputSchema,
  agentProfileDuplicateInputSchema,
  agentProfileImportConfirmInputSchema,
  agentProfileImportPreviewInputSchema,
  agentProfileListInputSchema,
  agentProfileUpdateInputSchema,
  agentProfileVersionInputSchema,
  type AgentProfileDto,
  type AgentProfileScope,
  type AgentProfileVersionDto,
  type AgentProfileVersionInput,
  type AgentProfileVersionRef,
} from "../../../shared/agent-profiles"
import {
  AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
  agentProfileApprovalContextHash,
} from "./approval-authority"
import {
  classifyAgentProfileCapabilityChange,
  type AgentProfileCapabilityChange,
} from "./capability-change"
import { STARTER_AGENT_PROFILES } from "./starter-catalog"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export class AgentProfileServiceError extends Error {
  constructor(
    readonly code:
      | "profile-missing"
      | "profile-archived"
      | "built-in-read-only"
      | "version-conflict"
      | "scope-invalid"
      | "inheritance-cycle"
      | "secret-detected"
      | "import-expired"
      | "import-conflict"
      | "schema-incompatible"
      | "approval-required"
      | "invalid-approval",
    message: string,
  ) {
    super(message)
    this.name = "AgentProfileServiceError"
  }
}

export class AgentProfileService {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  ensureStarterCatalog(): void {
    this.sqlite
      .transaction(() => {
        for (const starter of STARTER_AGENT_PROFILES) {
          const exists = this.sqlite
            .prepare("SELECT id FROM agent_profiles WHERE id = ?")
            .get(starter.id)
          if (exists) continue
          const now = epoch()
          this.sqlite
            .prepare(
              `INSERT INTO agent_profiles
               (id, name, description, category, scope_type, project_id, source,
                current_version, created_at, updated_at, archived_at)
               VALUES (?, ?, ?, ?, 'built-in', NULL, 'built-in', 1, ?, ?, NULL)`,
            )
            .run(starter.id, starter.name, starter.description, starter.category, now, now)
          this.insertVersion(starter.id, 1, starter.definition, {
            kind: "built-in",
            sourceLabel: "Flapstack starter catalog",
            importedAt: null,
            trusted: true,
            disabledRequirements: [],
          })
          this.audit(starter.id, "starter-installed", { version: 1, name: starter.name })
        }
      })
      .immediate()
  }

  list(inputValue: unknown = {}): AgentProfileDto[] {
    this.ensureStarterCatalog()
    const input = agentProfileListInputSchema.parse(inputValue)
    const clauses = ["(scope_type IN ('built-in','user') OR project_id = ?)"]
    const params: unknown[] = [input.projectId ?? null]
    if (!input.includeArchived) clauses.push("archived_at IS NULL")
    if (input.source) {
      clauses.push("source = ?")
      params.push(input.source)
    }
    if (input.query) {
      clauses.push(
        "(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')",
      )
      const query = `%${escapeLike(input.query)}%`
      params.push(query, query, query)
    }
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM agent_profiles WHERE ${clauses.join(" AND ")}
         ORDER BY CASE source WHEN 'built-in' THEN 0 ELSE 1 END, lower(name), id`,
      )
      .all(...params) as Row[]
    return rows.map(profileDto)
  }

  get(ref: AgentProfileVersionRef): { profile: AgentProfileDto; version: AgentProfileVersionDto } {
    const row = this.requireVersion(ref)
    return { profile: profileDto(row), version: versionDto(row) }
  }

  previewCreateCapabilityChange(inputValue: unknown) {
    const input = agentProfileCreateInputSchema.parse(inputValue)
    const change = classifyAgentProfileCapabilityChange(null, input.definition)
    return this.approvalPreview("create", null, 0, input.scope, input, change)
  }

  previewUpdateCapabilityChange(inputValue: unknown) {
    const input = agentProfileUpdateInputSchema.parse(inputValue)
    const profile = this.requireProfile(input.profileId)
    if (String(profile.source) === "built-in") throw builtInReadOnly()
    if (Number(profile.current_version) !== input.expectedVersion) throw versionConflict()
    const current = this.get({ profileId: input.profileId, version: input.expectedVersion })
    const change = classifyAgentProfileCapabilityChange(
      current.version.definition,
      input.definition,
    )
    return this.approvalPreview(
      "update",
      input.profileId,
      input.expectedVersion,
      current.profile.scope,
      input,
      change,
    )
  }

  previewDuplicateCapabilityChange(inputValue: unknown) {
    const input = agentProfileDuplicateInputSchema.parse(inputValue)
    const source = this.get(input.profile)
    return this.previewCreateCapabilityChange({
      name: input.name,
      description: source.profile.description,
      category: source.profile.category,
      scope: input.scope,
      definition: { ...source.version.definition, base: null },
    })
  }

  create(
    inputValue: unknown,
    approvalAuditId: string | null = null,
  ): { profile: AgentProfileDto; version: AgentProfileVersionDto } {
    const input = agentProfileCreateInputSchema.parse(inputValue)
    this.assertScope(input.scope)
    assertAgentProfileSecretFree(input)
    this.assertBase(input.definition, null, input.scope)
    const id = randomUUID()
    const now = epoch()
    const preview = this.previewCreateCapabilityChange(input)
    this.sqlite
      .transaction(() => {
        this.assertScope(input.scope)
        this.verifyAndConsumeCapabilityApproval(preview, approvalAuditId, null)
        this.sqlite
          .prepare(
            `INSERT INTO agent_profiles
             (id, name, description, category, scope_type, project_id, source,
              current_version, created_at, updated_at, archived_at)
             VALUES (?, ?, ?, ?, ?, ?, 'user', 1, ?, ?, NULL)`,
          )
          .run(
            id,
            input.name,
            input.description,
            input.category,
            input.scope.type,
            input.scope.projectId,
            now,
            now,
          )
        this.insertVersion(id, 1, input.definition, localProvenance())
        this.audit(id, "created", { version: 1, scope: input.scope.type })
      })
      .immediate()
    return this.get({ profileId: id, version: 1 })
  }

  update(
    inputValue: unknown,
    approvalAuditId: string | null = null,
  ): { profile: AgentProfileDto; version: AgentProfileVersionDto } {
    const input = agentProfileUpdateInputSchema.parse(inputValue)
    assertAgentProfileSecretFree(input)
    return this.sqlite
      .transaction(() => {
        const profile = this.requireProfile(input.profileId)
        if (String(profile.source) === "built-in") throw builtInReadOnly()
        if (Number(profile.current_version) !== input.expectedVersion) throw versionConflict()
        const current = this.get({ profileId: input.profileId, version: input.expectedVersion })
        this.assertScope(current.profile.scope)
        this.assertBase(input.definition, input.profileId, profileScope(profile))
        const change = classifyAgentProfileCapabilityChange(
          current.version.definition,
          input.definition,
        )
        const preview = this.approvalPreview(
          "update",
          input.profileId,
          input.expectedVersion,
          current.profile.scope,
          input,
          change,
        )
        this.verifyAndConsumeCapabilityApproval(preview, approvalAuditId, input.profileId)
        const nextVersion = input.expectedVersion + 1
        this.insertVersion(input.profileId, nextVersion, input.definition, localProvenance())
        const changed = this.sqlite
          .prepare(
            `UPDATE agent_profiles SET
               name = COALESCE(?, name), description = COALESCE(?, description),
               category = COALESCE(?, category), current_version = ?, updated_at = ?
             WHERE id = ? AND current_version = ?`,
          )
          .run(
            input.identity?.name ?? null,
            input.identity?.description ?? null,
            input.identity?.category ?? null,
            nextVersion,
            epoch(),
            input.profileId,
            input.expectedVersion,
          )
        if (changed.changes !== 1) throw versionConflict()
        this.audit(input.profileId, "version-created", {
          previousVersion: input.expectedVersion,
          version: nextVersion,
        })
        return this.get({ profileId: input.profileId, version: nextVersion })
      })
      .immediate()
  }

  duplicate(inputValue: unknown, approvalAuditId: string | null = null) {
    const input = agentProfileDuplicateInputSchema.parse(inputValue)
    const source = this.get(input.profile)
    return this.create(
      {
        name: input.name,
        description: source.profile.description,
        category: source.profile.category,
        scope: input.scope,
        definition: { ...source.version.definition, base: null },
      },
      approvalAuditId,
    )
  }

  archive(inputValue: unknown, restore = false): AgentProfileDto {
    const input = agentProfileArchiveInputSchema.parse(inputValue)
    const profile = this.requireProfile(input.profileId)
    if (String(profile.source) === "built-in") throw builtInReadOnly()
    if (Number(profile.current_version) !== input.expectedVersion) throw versionConflict()
    const now = epoch()
    this.sqlite
      .prepare("UPDATE agent_profiles SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(restore ? null : now, now, input.profileId)
    this.audit(input.profileId, restore ? "restored" : "archived", {
      version: input.expectedVersion,
    })
    return profileDto(this.requireProfile(input.profileId))
  }

  export(refs: AgentProfileVersionRef[]): string {
    if (refs.length < 1 || refs.length > 256) throw new Error("Export requires 1-256 profiles.")
    const profiles = refs.map((ref) => {
      const item = this.get(ref)
      return {
        identity: {
          name: item.profile.name,
          description: item.profile.description,
          category: item.profile.category,
        },
        definition: item.version.definition,
        sourceProfileId: ref.profileId,
        sourceVersion: ref.version,
      }
    })
    const bundle = agentProfileBundleSchema.parse({
      kind: "flapstack-agent-profiles",
      bundleVersion: 1,
      exportedAt: new Date().toISOString(),
      profiles,
    })
    assertAgentProfileSecretFree(bundle)
    this.audit(null, "exported", { profileCount: refs.length })
    return JSON.stringify(bundle, null, 2)
  }

  previewImport(inputValue: unknown) {
    const input = agentProfileImportPreviewInputSchema.parse(inputValue)
    assertAgentProfileSecretFree(input.bundle)
    let bundle: ReturnType<typeof agentProfileBundleSchema.parse>
    try {
      bundle = agentProfileBundleSchema.parse(JSON.parse(input.bundle) as unknown)
    } catch {
      throw new AgentProfileServiceError(
        "schema-incompatible",
        "Agent Profile bundle schema is unsupported or malformed.",
      )
    }
    const canonical = canonicalJson(bundle)
    const digest = sha256(canonical)
    const unresolved = bundle.profiles.flatMap((profile, profileIndex) =>
      importedDisabledRequirements(profile.definition).map((requirement) => ({
        profile: profileIndex,
        ...requirement,
      })),
    )
    const preview = {
      previewId: randomUUID(),
      digest,
      sourceLabel: input.sourceLabel,
      provenance: "unverified" as const,
      profileCount: bundle.profiles.length,
      unresolved,
      warnings: [
        "Imported instructions are untrusted visible product data.",
        "Hooks, MCP, network, persistent memory, and hosted updates cannot be enabled by this bundle.",
      ],
    }
    const now = epoch()
    this.sqlite
      .prepare(
        `INSERT INTO agent_profile_import_previews
         (id, digest, source_label, bundle_json, preview_json, created_at, expires_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(digest) DO UPDATE SET
           id = excluded.id, source_label = excluded.source_label,
           bundle_json = excluded.bundle_json, preview_json = excluded.preview_json,
           created_at = excluded.created_at, expires_at = excluded.expires_at, confirmed_at = NULL`,
      )
      .run(
        preview.previewId,
        digest,
        input.sourceLabel,
        canonical,
        JSON.stringify(preview),
        now,
        now + 15 * 60,
      )
    this.audit(null, "import-previewed", { digest, profileCount: bundle.profiles.length })
    return preview
  }

  confirmImport(inputValue: unknown) {
    const input = agentProfileImportConfirmInputSchema.parse(inputValue)
    return this.sqlite
      .transaction(() => {
        const row = this.sqlite
          .prepare("SELECT * FROM agent_profile_import_previews WHERE id = ?")
          .get(input.previewId) as Row | undefined
        if (!row) throw new AgentProfileServiceError("import-expired", "Import preview is missing.")
        if (Number(row.expires_at) < epoch() || row.confirmed_at) {
          throw new AgentProfileServiceError(
            "import-expired",
            "Import preview expired or was used.",
          )
        }
        if (String(row.digest) !== input.expectedDigest) {
          throw new AgentProfileServiceError(
            "import-conflict",
            "Import digest changed after preview.",
          )
        }
        if (input.projectId) this.assertScope({ type: "project", projectId: input.projectId })
        const bundle = agentProfileBundleSchema.parse(JSON.parse(String(row.bundle_json)))
        const created: AgentProfileDto[] = []
        for (const entry of bundle.profiles) {
          const disabledRequirements = importedDisabledRequirements(entry.definition)
          const definition: AgentProfileVersionInput = {
            ...entry.definition,
            base: null,
            inheritCapabilityFields: [],
            inheritPresentationFields: [],
            capability: {
              ...entry.definition.capability,
              tools: [],
              skills: [],
              permissionMode: "read-only",
              customPermissions: null,
              memoryPolicy: { mode: "none" },
              allowedDescendantProfileIds: [],
              maxDescendants: 0,
            },
          }
          const existing = this.sqlite
            .prepare("SELECT * FROM agent_profiles WHERE id = ?")
            .get(entry.sourceProfileId) as Row | undefined
          const profileId =
            input.conflict === "new-version" && existing && String(existing.source) !== "built-in"
              ? entry.sourceProfileId
              : randomUUID()
          if (profileId === entry.sourceProfileId && existing) {
            const next = Number(existing.current_version) + 1
            this.insertVersion(profileId, next, definition, {
              kind: "import",
              sourceLabel: String(row.source_label),
              importedAt: new Date().toISOString(),
              trusted: false,
              disabledRequirements,
            })
            this.sqlite
              .prepare("UPDATE agent_profiles SET current_version = ?, updated_at = ? WHERE id = ?")
              .run(next, epoch(), profileId)
          } else {
            const now = epoch()
            this.sqlite
              .prepare(
                `INSERT INTO agent_profiles
                 (id, name, description, category, scope_type, project_id, source,
                  current_version, created_at, updated_at, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'imported', 1, ?, ?, NULL)`,
              )
              .run(
                profileId,
                entry.identity.name,
                entry.identity.description,
                entry.identity.category,
                input.projectId ? "project" : "user",
                input.projectId,
                now,
                now,
              )
            this.insertVersion(profileId, 1, definition, {
              kind: "import",
              sourceLabel: String(row.source_label),
              importedAt: new Date().toISOString(),
              trusted: false,
              disabledRequirements,
            })
          }
          this.audit(profileId, "imported", {
            digest: input.expectedDigest,
            trusted: false,
            disabledRequirementCount: disabledRequirements.length,
          })
          created.push(profileDto(this.requireProfile(profileId)))
        }
        this.sqlite
          .prepare("UPDATE agent_profile_import_previews SET confirmed_at = ? WHERE id = ?")
          .run(epoch(), input.previewId)
        return created
      })
      .immediate()
  }

  auditEvents(profileId?: string) {
    return this.sqlite
      .prepare(
        `SELECT id, profile_id profileId, action, summary_json summary, created_at createdAt
         FROM agent_profile_audit_events
         ${profileId ? "WHERE profile_id = ?" : ""} ORDER BY created_at DESC, id DESC LIMIT 200`,
      )
      .all(...(profileId ? [profileId] : []))
      .map((row) => {
        const value = row as Record<string, unknown>
        return { ...value, summary: JSON.parse(String(value.summary)) }
      })
  }

  getApprovalContext(scope: AgentProfileScope) {
    const row = this.sqlite
      .prepare(
        `SELECT c.id chat_id, r.id run_id
         FROM chats c
         LEFT JOIN agent_runs r ON r.chat_id = c.id
         WHERE c.archived_at IS NULL AND (? IS NULL OR c.project_id = ?)
         ORDER BY c.updated_at DESC, r.started_at DESC, r.id DESC LIMIT 1`,
      )
      .get(scope.type === "project" ? scope.projectId : null, scope.projectId) as
      { chat_id: string; run_id: string | null } | undefined
    if (!row) {
      throw new AgentProfileServiceError(
        "approval-required",
        "Capability widening requires an active durable caller chat for approval.",
      )
    }
    return { chatId: row.chat_id, runId: row.run_id }
  }

  private approvalPreview(
    action: "create" | "update",
    profileId: string | null,
    expectedVersion: number,
    scope: AgentProfileScope,
    input: unknown,
    change: AgentProfileCapabilityChange,
  ) {
    return {
      action,
      profileId,
      expectedVersion,
      scope,
      change,
      approvalRequired: change.kind === "widening",
      authority: {
        schemaVersion: 1,
        action,
        profileId,
        expectedVersion,
        scope,
        change,
        inputDigest: sha256(canonicalJson(input)),
      },
    }
  }

  private verifyAndConsumeCapabilityApproval(
    preview: ReturnType<AgentProfileService["previewCreateCapabilityChange"]>,
    approvalAuditId: string | null,
    profileId: string | null,
  ) {
    if (!preview.approvalRequired) return
    if (!approvalAuditId) {
      throw new AgentProfileServiceError(
        "approval-required",
        `Capability widening requires approval for: ${preview.change.widenedFields.join(", ")}.`,
      )
    }
    const caller = this.getApprovalContext(preview.scope)
    const row = this.sqlite
      .prepare(
        `SELECT a.invocation_id, a.status, a.caller_chat_id, a.caller_run_id,
                a.tool_name, a.tier, p.decision, p.input_summary
         FROM mcp_audit_records a
         JOIN mcp_approval_requests p ON p.invocation_id = a.invocation_id
         WHERE a.id = ? AND p.id = a.invocation_id`,
      )
      .get(approvalAuditId) as Row | undefined
    let contextHash: unknown = null
    try {
      contextHash = JSON.parse(String(row?.input_summary)).contextHash
    } catch {
      contextHash = null
    }
    const expectedContextHash = agentProfileApprovalContextHash({
      callerChatId: caller.chatId,
      callerRunId: caller.runId,
      authority: preview.authority,
    })
    if (
      !row ||
      row.status !== "completed" ||
      row.decision !== "approve" ||
      row.tool_name !== AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL ||
      Number(row.tier) !== 3 ||
      row.caller_chat_id !== caller.chatId ||
      (row.caller_run_id ?? null) !== caller.runId ||
      contextHash !== expectedContextHash
    ) {
      throw new AgentProfileServiceError(
        "invalid-approval",
        "Approval does not match this exact current Agent Profile capability change.",
      )
    }
    try {
      this.sqlite
        .prepare(
          `INSERT INTO agent_profile_audit_events
           (id, profile_id, action, summary_json, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          approvalAuditId,
          profileId,
          "capability-approval-consumed",
          JSON.stringify({ authority: preview.authority }),
          epoch(),
        )
    } catch (error) {
      if (error instanceof Error && /unique|primary key/i.test(error.message)) {
        throw new AgentProfileServiceError(
          "invalid-approval",
          "Capability approval was already consumed.",
        )
      }
      throw error
    }
  }

  private requireProfile(profileId: string): Row {
    const row = this.sqlite.prepare("SELECT * FROM agent_profiles WHERE id = ?").get(profileId) as
      Row | undefined
    if (!row) throw new AgentProfileServiceError("profile-missing", "Agent Profile is missing.")
    return row
  }

  private requireVersion(ref: AgentProfileVersionRef): Row {
    const row = this.sqlite
      .prepare(
        `SELECT p.*, v.version, v.base_profile_id, v.base_profile_version,
                v.capability_json, v.presentation_json, v.provenance_json,
                v.created_at version_created_at
         FROM agent_profiles p JOIN agent_profile_versions v ON v.profile_id = p.id
         WHERE p.id = ? AND v.version = ?`,
      )
      .get(ref.profileId, ref.version) as Row | undefined
    if (!row)
      throw new AgentProfileServiceError("profile-missing", "Agent Profile version is missing.")
    return row
  }

  private assertScope(scope: AgentProfileScope): void {
    if (scope.type !== "project") return
    const project = this.sqlite
      .prepare("SELECT id, archived_at FROM projects WHERE id = ?")
      .get(scope.projectId) as Row | undefined
    if (!project || project.archived_at !== null) {
      throw new AgentProfileServiceError(
        "scope-invalid",
        "Project Agent Profiles require an active durable project.",
      )
    }
  }

  private assertBase(
    definition: AgentProfileVersionInput,
    profileId: string | null,
    targetScope: AgentProfileScope,
  ): void {
    if (!definition.base) return
    const seen = new Set(profileId ? [profileId] : [])
    let cursor: AgentProfileVersionRef | null = definition.base
    let childScope = targetScope
    while (cursor) {
      if (seen.has(cursor.profileId)) {
        throw new AgentProfileServiceError("inheritance-cycle", "Agent Profile inheritance cycle.")
      }
      seen.add(cursor.profileId)
      const row = this.requireVersion(cursor)
      const baseScope = profileScope(row)
      if (row.archived_at !== null) {
        throw new AgentProfileServiceError(
          "profile-archived",
          "A new Agent Profile version cannot inherit from an archived base.",
        )
      }
      if (!scopeCanInherit(childScope, baseScope)) {
        throw new AgentProfileServiceError(
          "scope-invalid",
          "Agent Profile base scope is not visible from the child scope.",
        )
      }
      childScope = baseScope
      cursor = row.base_profile_id
        ? { profileId: String(row.base_profile_id), version: Number(row.base_profile_version) }
        : null
    }
  }

  private insertVersion(
    profileId: string,
    version: number,
    definitionValue: AgentProfileVersionInput,
    provenance: Record<string, unknown>,
  ): void {
    const definition = agentProfileVersionInputSchema.parse(definitionValue)
    const digest = sha256(
      canonicalJson({
        profileId,
        version,
        definition,
        provenance: { ...provenance, digest: undefined },
      }),
    )
    this.sqlite
      .prepare(
        `INSERT INTO agent_profile_versions
         (profile_id, version, base_profile_id, base_profile_version,
          capability_json, presentation_json, provenance_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        version,
        definition.base?.profileId ?? null,
        definition.base?.version ?? null,
        JSON.stringify(definition.capability),
        JSON.stringify(definition.presentation),
        JSON.stringify({
          ...provenance,
          digest,
          inheritCapabilityFields: definition.inheritCapabilityFields,
          inheritPresentationFields: definition.inheritPresentationFields,
        }),
        epoch(),
      )
  }

  private audit(profileId: string | null, action: string, summary: Record<string, unknown>): void {
    assertAgentProfileSecretFree(summary)
    this.sqlite
      .prepare(
        `INSERT INTO agent_profile_audit_events (id, profile_id, action, summary_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), profileId, action, JSON.stringify(summary), epoch())
  }
}

export function createAgentProfileService(database: DatabaseLike) {
  return new AgentProfileService(database)
}

function profileDto(row: Row): AgentProfileDto {
  const scopeType = String(row.scope_type) as AgentProfileScope["type"]
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    category: String(row.category),
    scope:
      scopeType === "project"
        ? { type: "project", projectId: String(row.project_id) }
        : { type: scopeType, projectId: null },
    source: String(row.source) as AgentProfileDto["source"],
    currentVersion: Number(row.current_version),
    archivedAt: timestamp(row.archived_at),
    createdAt: timestamp(row.created_at)!,
    updatedAt: timestamp(row.updated_at)!,
  }
}

function profileScope(row: Row): AgentProfileScope {
  const type = String(row.scope_type) as AgentProfileScope["type"]
  return type === "project"
    ? { type, projectId: String(row.project_id) }
    : { type, projectId: null }
}

function scopeCanInherit(child: AgentProfileScope, base: AgentProfileScope) {
  if (base.type !== "project") return true
  return child.type === "project" && child.projectId === base.projectId
}

function versionDto(row: Row): AgentProfileVersionDto {
  const provenance = JSON.parse(
    String(row.provenance_json),
  ) as AgentProfileVersionDto["provenance"] & {
    inheritCapabilityFields?: string[]
    inheritPresentationFields?: string[]
  }
  return {
    profileId: String(row.id),
    version: Number(row.version),
    definition: agentProfileVersionInputSchema.parse({
      base: row.base_profile_id
        ? { profileId: String(row.base_profile_id), version: Number(row.base_profile_version) }
        : null,
      capability: JSON.parse(String(row.capability_json)),
      presentation: JSON.parse(String(row.presentation_json)),
      inheritCapabilityFields: provenance.inheritCapabilityFields ?? [],
      inheritPresentationFields: provenance.inheritPresentationFields ?? [],
    }),
    provenance,
    createdAt: timestamp(row.version_created_at)!,
  }
}

function localProvenance() {
  return {
    kind: "local",
    sourceLabel: null,
    importedAt: null,
    trusted: true,
    disabledRequirements: [],
  }
}

function importedDisabledRequirements(definition: AgentProfileVersionInput) {
  return [
    ...definition.capability.tools.map((id) => ({
      kind: "tool",
      id,
      reason: "Imported tools stay disabled until selected through local capability policy.",
    })),
    ...definition.capability.skills.map((id) => ({
      kind: "skill",
      id,
      reason: "Imported skills stay disabled until the extension trust path approves them.",
    })),
    ...(definition.capability.permissionMode === "read-only"
      ? []
      : [
          {
            kind: "permission",
            id: definition.capability.permissionMode,
            reason: "Imported authority is narrowed to read-only.",
          },
        ]),
    ...(definition.capability.maxDescendants === 0
      ? []
      : [
          {
            kind: "descendants",
            id: String(definition.capability.maxDescendants),
            reason: "Imported descendant authority is disabled.",
          },
        ]),
  ]
}

export function assertAgentProfileSecretFree(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["']?[^\s,"']{8,}/i,
    /\b(?:session|authorization)\s*[:=]\s*["']?(?:bearer\s+)?[A-Za-z0-9._~+/=-]{16,}/i,
  ]
  if (patterns.some((pattern) => pattern.test(text))) {
    throw new AgentProfileServiceError(
      "secret-detected",
      "Agent Profile data contains a credential or session-like secret.",
    )
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
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

function epoch() {
  return Math.floor(Date.now() / 1_000)
}

function timestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function builtInReadOnly() {
  return new AgentProfileServiceError(
    "built-in-read-only",
    "Built-in Agent Profiles are read-only; duplicate first.",
  )
}

function versionConflict() {
  return new AgentProfileServiceError("version-conflict", "Agent Profile version conflict.")
}
