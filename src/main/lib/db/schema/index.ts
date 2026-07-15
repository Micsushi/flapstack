import {
  check,
  index,
  sqliteTable,
  text,
  integer,
  foreignKey,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
  // Custom project icon (absolute path to local image file)
  iconPath: text("icon_path"),
  defaultPermissionMode: text("default_permission_mode").notNull().default("ask-before-edits"),
  defaultCustomPermissions: text("default_custom_permissions"),
  // Null is the fixed opt-in default: no vault context. A JSON array is an
  // explicit project selection, including [] when the user selected none.
  vaultContextSections: text("vault_context_sections"),
  pinnedAt: integer("pinned_at", { mode: "timestamp" }),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
})

export const projectsRelations = relations(projects, ({ one, many }) => ({
  chats: many(chats),
  tasks: many(tasks),
  savedWorkspaces: many(savedWorkspaces),
  taskProposals: many(taskProposals),
  agentRuntimeDefaults: many(agentRuntimeDefaults),
  coordinationEngineDefaults: many(coordinationEngineDefaults),
  vault: one(projectVaults),
  planSourceRegistrations: many(planSourceRegistrations),
}))

// OpenSpec is discovered from the registered project root. Only explicitly
// selected Markdown needs durable configuration.
export const planSourceRegistrations = sqliteTable(
  "plan_source_registrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull().default("markdown"),
    relativePath: text("relative_path").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("plan_source_registrations_project_path_idx").on(
      table.projectId,
      table.relativePath,
    ),
    check("plan_source_registrations_type_check", sql`${table.sourceType} = 'markdown'`),
  ],
)

export const planSourceRegistrationsRelations = relations(planSourceRegistrations, ({ one }) => ({
  project: one(projects, {
    fields: [planSourceRegistrations.projectId],
    references: [projects.id],
  }),
}))

// Project knowledge remains shared across every worktree for a project. Paths
// are captured when a location is selected so later worktree or project-path
// changes cannot silently move the vault.
export const projectVaultPolicies = sqliteTable("project_vault_policies", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  locationMode: text("location_mode").notNull().default("app-managed"),
  centralPath: text("central_path").notNull(),
  projectOwnedPath: text("project_owned_path"),
  gitTrackingEnabled: integer("git_tracking_enabled", { mode: "boolean" }).notNull().default(false),
  portabilityMode: text("portability_mode").notNull().default("export-required"),
  worktreeMode: text("worktree_mode").notNull().default("shared-across-worktrees"),
  deletionMode: text("deletion_mode").notNull().default("retain-until-explicit-delete"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// Vault content stays readable Markdown on disk. SQLite owns the stable typed
// index, optimistic versions, content hashes, and backup inventory.
export const projectVaults = sqliteTable(
  "project_vaults",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    rootPath: text("root_path").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_vaults_root_path_idx").on(table.rootPath),
    check("project_vaults_schema_version_check", sql`${table.schemaVersion} >= 1`),
  ],
)

export const projectVaultSections = sqliteTable(
  "project_vault_sections",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projectVaults.projectId, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    sectionType: text("section_type").notNull(),
    title: text("title").notNull(),
    relativePath: text("relative_path").notNull(),
    version: integer("version").notNull().default(1),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.sectionId] }),
    uniqueIndex("project_vault_sections_path_idx").on(table.projectId, table.relativePath),
    check("project_vault_sections_version_check", sql`${table.version} >= 1`),
    check("project_vault_sections_byte_length_check", sql`${table.byteLength} >= 0`),
  ],
)

export const projectVaultBackups = sqliteTable(
  "project_vault_backups",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id").notNull(),
    sectionId: text("section_id").notNull(),
    version: integer("version").notNull(),
    relativePath: text("relative_path").notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_vault_backups_version_idx").on(
      table.projectId,
      table.sectionId,
      table.version,
    ),
    index("project_vault_backups_section_idx").on(
      table.projectId,
      table.sectionId,
      table.createdAt,
    ),
    check("project_vault_backups_version_check", sql`${table.version} >= 1`),
    check("project_vault_backups_byte_length_check", sql`${table.byteLength} >= 0`),
    foreignKey({
      columns: [table.projectId, table.sectionId],
      foreignColumns: [projectVaultSections.projectId, projectVaultSections.sectionId],
    }).onDelete("cascade"),
  ],
)

export const projectVaultsRelations = relations(projectVaults, ({ one, many }) => ({
  project: one(projects, { fields: [projectVaults.projectId], references: [projects.id] }),
  sections: many(projectVaultSections),
  backups: many(projectVaultBackups),
}))

export const projectVaultSectionsRelations = relations(projectVaultSections, ({ one, many }) => ({
  vault: one(projectVaults, {
    fields: [projectVaultSections.projectId],
    references: [projectVaults.projectId],
  }),
  backups: many(projectVaultBackups),
}))

export const projectVaultBackupsRelations = relations(projectVaultBackups, ({ one }) => ({
  vault: one(projectVaults, {
    fields: [projectVaultBackups.projectId],
    references: [projectVaults.projectId],
  }),
  section: one(projectVaultSections, {
    fields: [projectVaultBackups.projectId, projectVaultBackups.sectionId],
    references: [projectVaultSections.projectId, projectVaultSections.sectionId],
  }),
}))

// Durable filesystem identity for project and worktree roots. The pathname is
// only the lookup key; security decisions also require the canonical path and,
// where the platform exposes them, the device/inode pair captured at binding.
export const filesystemRootRegistrations = sqliteTable("filesystem_root_registrations", {
  path: text("path").primaryKey(),
  canonicalPath: text("canonical_path").notNull(),
  deviceId: text("device_id"),
  inodeId: text("inode_id"),
  boundAt: integer("bound_at", { mode: "timestamp" }).notNull(),
})

// ============ TASKS ============
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("backlog"),
    boardOrder: text("board_order").notNull().default("a0"),
    version: integer("version").notNull().default(1),
    sourceType: text("source_type"),
    sourcePath: text("source_path"),
    sourceCandidateId: text("source_candidate_id"),
    sourceFingerprint: text("source_fingerprint"),
    defaultPermissionMode: text("default_permission_mode").notNull().default("ask-before-edits"),
    defaultCustomPermissions: text("default_custom_permissions"),
    // Null inherits the project selection. A JSON array is an exact task override.
    vaultContextSections: text("vault_context_sections"),
    primaryWorktreePath: text("primary_worktree_path"),
    primaryBranch: text("primary_branch"),
    pinnedAt: integer("pinned_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_project_status_order_idx").on(table.projectId, table.status, table.boardOrder),
    uniqueIndex("tasks_source_candidate_idx").on(
      table.projectId,
      table.sourcePath,
      table.sourceCandidateId,
    ),
    check(
      "tasks_status_check",
      sql`${table.status} in ('backlog', 'planned', 'in-progress', 'review', 'done')`,
    ),
    check("tasks_version_check", sql`${table.version} >= 1`),
  ],
)

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  chats: many(chats),
  savedWorkspaces: many(savedWorkspaces),
  attachments: many(attachments),
  orchestration: one(taskOrchestrations, {
    fields: [tasks.id],
    references: [taskOrchestrations.taskId],
  }),
}))

// Provider-native extension content remains on disk. SQLite stores only the
// user's additive enablement decisions so restart cannot change policy or
// rewrite a harness configuration file.
export const extensionEnablementPolicies = sqliteTable(
  "extension_enablement_policies",
  {
    extensionId: text("extension_id").notNull(),
    harness: text("harness").notNull(),
    kind: text("kind").notNull(),
    nativeScope: text("native_scope").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.extensionId, table.scopeType, table.scopeId] }),
    index("extension_enablement_policies_project_idx").on(table.projectId, table.extensionId),
    index("extension_enablement_policies_task_idx").on(table.taskId, table.extensionId),
    check(
      "extension_enablement_policies_harness_check",
      sql`${table.harness} in ('claude-code', 'codex', 'cursor-agent', 'opencode')`,
    ),
    check(
      "extension_enablement_policies_kind_check",
      sql`${table.kind} in ('skill', 'command', 'plugin', 'custom-agent', 'mcp', 'hook')`,
    ),
    check(
      "extension_enablement_policies_native_scope_check",
      sql`${table.nativeScope} in ('user', 'project', 'plugin')`,
    ),
    check(
      "extension_enablement_policies_scope_check",
      sql`(
        (${table.scopeType} = 'user' and ${table.scopeId} = 'user' and ${table.projectId} is null and ${table.taskId} is null) or
        (${table.scopeType} = 'project' and ${table.scopeId} = ${table.projectId} and ${table.projectId} is not null and ${table.taskId} is null) or
        (${table.scopeType} = 'task' and ${table.scopeId} = ${table.taskId} and ${table.projectId} is not null and ${table.taskId} is not null)
      )`,
    ),
  ],
)

export const extensionEnablementPoliciesRelations = relations(
  extensionEnablementPolicies,
  ({ one }) => ({
    project: one(projects, {
      fields: [extensionEnablementPolicies.projectId],
      references: [projects.id],
    }),
    task: one(tasks, {
      fields: [extensionEnablementPolicies.taskId],
      references: [tasks.id],
    }),
  }),
)

// AI-authored work stays inert here until a later approval transaction creates
// real task/chat state. Caller identity is stored as evidence rather than a
// foreign key so deleting a chat cannot erase who proposed the work.
export const taskProposals = sqliteTable(
  "task_proposals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    proposedByChatId: text("proposed_by_chat_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    targetStatus: text("target_status").notNull().default("backlog"),
    status: text("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    sourceType: text("source_type"),
    sourcePath: text("source_path"),
    sourceCandidateId: text("source_candidate_id"),
    sourceFingerprint: text("source_fingerprint"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
  },
  (table) => [
    index("task_proposals_project_status_idx").on(table.projectId, table.status, table.createdAt),
    index("task_proposals_caller_idx").on(table.proposedByChatId, table.createdAt),
    check(
      "task_proposals_target_status_check",
      sql`${table.targetStatus} in ('backlog', 'planned')`,
    ),
    check(
      "task_proposals_status_check",
      sql`${table.status} in ('pending', 'approved', 'denied', 'cancelled')`,
    ),
    check("task_proposals_version_check", sql`${table.version} >= 1`),
    check("task_proposals_name_check", sql`length(trim(${table.name})) between 1 and 256`),
  ],
)

export const taskProposalsRelations = relations(taskProposals, ({ one }) => ({
  project: one(projects, {
    fields: [taskProposals.projectId],
    references: [projects.id],
  }),
}))

// ============ AGENT TASK ORCHESTRATION ============
// The task remains the user-facing container. These rows own durable queue,
// budgets, worker definitions, and lineage so restart never loses control state.
export const taskOrchestrations = sqliteTable(
  "task_orchestrations",
  {
    taskId: text("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    initiatingChatId: text("initiating_chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    maxParallelAgents: integer("max_parallel_agents").notNull().default(1),
    maxDepth: integer("max_depth").notNull().default(8),
    stopConditions: text("stop_conditions").notNull().default("{}"),
    stopReason: text("stop_reason"),
    blockerCount: integer("blocker_count").notNull().default(0),
    // Version 0 preserves Stage 3 history as workflow-legacy-graph. New rows
    // write version 1 before scheduler/provider work starts.
    engineSnapshotVersion: integer("engine_snapshot_version").notNull().default(0),
    coordinationEngine: text("coordination_engine").notNull().default("workflow"),
    coordinationEngineVersion: text("coordination_engine_version")
      .notNull()
      .default("workflow-legacy-graph"),
    coordinationEngineSource: text("coordination_engine_source").notNull().default("legacy"),
    coordinationEngineCapabilitySnapshot: text("coordination_engine_capability_snapshot")
      .notNull()
      .default(
        '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-legacy-graph","status":"legacy","capturedAt":null,"capabilities":["durable-workflow"],"limitations":["Historical Stage 3 graph orchestration."],"unavailableReason":null}',
      ),
    coordinationEngineProviderIdentity: text("coordination_engine_provider_identity")
      .notNull()
      .default("null"),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("task_orchestrations_status_idx").on(table.status),
    index("task_orchestrations_engine_idx").on(table.coordinationEngine, table.status),
    check(
      "task_orchestrations_engine_check",
      sql`${table.coordinationEngine} in ('workflow', 'codex-v2', 'codex-v1')`,
    ),
    check(
      "task_orchestrations_engine_source_check",
      sql`${table.coordinationEngineSource} in ('per-launch', 'project', 'global', 'product', 'legacy')`,
    ),
    check(
      "task_orchestrations_engine_snapshot_check",
      sql`coalesce((
        ${table.engineSnapshotVersion} = 0
        and ${table.coordinationEngine} = 'workflow'
        and ${table.coordinationEngineVersion} = 'workflow-legacy-graph'
        and ${table.coordinationEngineSource} = 'legacy'
        and ${table.coordinationEngineCapabilitySnapshot} = '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-legacy-graph","status":"legacy","capturedAt":null,"capabilities":["durable-workflow"],"limitations":["Historical Stage 3 graph orchestration."],"unavailableReason":null}'
        and ${table.coordinationEngineProviderIdentity} = 'null'
      ) or (
        ${table.engineSnapshotVersion} = 1
        and ${table.coordinationEngineSource} in ('per-launch', 'project', 'global', 'product')
        and length(trim(${table.coordinationEngineVersion})) between 1 and 128
        and (
          (${table.coordinationEngine} = 'workflow' and ${table.coordinationEngineVersion} = 'workflow-v1') or
          (${table.coordinationEngine} = 'codex-v2' and ${table.coordinationEngineVersion} = 'codex-v2-v1') or
          (${table.coordinationEngine} = 'codex-v1' and ${table.coordinationEngineVersion} = 'codex-v1-v1')
        )
        and json_valid(${table.coordinationEngineCapabilitySnapshot}) = 1
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$') = 'object'
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$.schemaVersion') = 'integer'
        and json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.schemaVersion') = 1
        and json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.engine') = ${table.coordinationEngine}
        and json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.engineVersion') = ${table.coordinationEngineVersion}
        and json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.status') = 'available'
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$.capturedAt') = 'text'
        and length(trim(json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.capturedAt'))) between 1 and 128
        and julianday(json_extract(${table.coordinationEngineCapabilitySnapshot}, '$.capturedAt')) is not null
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$.capabilities') = 'array'
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$.limitations') = 'array'
        and json_type(${table.coordinationEngineCapabilitySnapshot}, '$.unavailableReason') = 'null'
        and json_valid(${table.coordinationEngineProviderIdentity}) = 1
        and (
          json_type(${table.coordinationEngineProviderIdentity}, '$') = 'null' or
          (
            json_type(${table.coordinationEngineProviderIdentity}, '$') = 'object'
            and json_type(${table.coordinationEngineProviderIdentity}, '$.schemaVersion') = 'integer'
            and json_extract(${table.coordinationEngineProviderIdentity}, '$.schemaVersion') = 1
            and json_extract(${table.coordinationEngineProviderIdentity}, '$.engine') = ${table.coordinationEngine}
            and (
              (${table.coordinationEngine} = 'workflow'
                and json_type(${table.coordinationEngineProviderIdentity}, '$.workflowRunId') = 'text'
                and length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.workflowRunId'))) between 1 and 512) or
              (${table.coordinationEngine} = 'codex-v2'
                and json_type(${table.coordinationEngineProviderIdentity}, '$.canonicalTaskPath') = 'text'
                and length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.canonicalTaskPath'))) between 1 and 1024
                and json_type(${table.coordinationEngineProviderIdentity}, '$.taskName') = 'text'
                and length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.taskName'))) between 1 and 200
                and json_type(${table.coordinationEngineProviderIdentity}, '$.providerTaskId') in ('null', 'text')
                and (json_type(${table.coordinationEngineProviderIdentity}, '$.providerTaskId') = 'null'
                  or length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.providerTaskId'))) between 1 and 512)) or
              (${table.coordinationEngine} = 'codex-v1'
                and json_type(${table.coordinationEngineProviderIdentity}, '$.providerAgentId') = 'text'
                and length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.providerAgentId'))) between 1 and 512
                and json_type(${table.coordinationEngineProviderIdentity}, '$.nickname') in ('null', 'text')
                and (json_type(${table.coordinationEngineProviderIdentity}, '$.nickname') = 'null'
                  or length(trim(json_extract(${table.coordinationEngineProviderIdentity}, '$.nickname'))) between 1 and 160))
            )
          )
        )
      ), 0)`,
    ),
  ],
)

export const taskOrchestrationsRelations = relations(taskOrchestrations, ({ one, many }) => ({
  task: one(tasks, { fields: [taskOrchestrations.taskId], references: [tasks.id] }),
  initiatingChat: one(chats, {
    fields: [taskOrchestrations.initiatingChatId],
    references: [chats.id],
  }),
  agents: many(orchestrationAgents),
}))

export const orchestrationAgents = sqliteTable(
  "orchestration_agents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    parentAgentId: text("parent_agent_id"),
    replacedAgentId: text("replaced_agent_id"),
    ancestorAgentIds: text("ancestor_agent_ids").notNull().default("[]"),
    depth: integer("depth").notNull().default(1),
    definition: text("definition").notNull(),
    dependencyAgentIds: text("dependency_agent_ids").notNull().default("[]"),
    status: text("status").notNull().default("queued"),
    progressPercent: integer("progress_percent").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsdMicros: integer("cost_usd_micros"),
    costQuality: text("cost_quality").notNull().default("unknown"),
    resultSummary: text("result_summary"),
    stopReason: text("stop_reason"),
    blockerCount: integer("blocker_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
    queuedAt: integer("queued_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("orchestration_agents_task_status_idx").on(table.taskId, table.status),
    index("orchestration_agents_chat_idx").on(table.chatId),
    index("orchestration_agents_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
)

export const orchestrationAgentsRelations = relations(orchestrationAgents, ({ one }) => ({
  orchestration: one(taskOrchestrations, {
    fields: [orchestrationAgents.taskId],
    references: [taskOrchestrations.taskId],
  }),
  chat: one(chats, { fields: [orchestrationAgents.chatId], references: [chats.id] }),
  run: one(agentRuns, { fields: [orchestrationAgents.runId], references: [agentRuns.id] }),
}))

// ============ SAVED WORKSPACES ============
// `SavedWorkspace` is the durable multi-surface product object. Legacy
// workspace IDs elsewhere still identify chats or terminal process scopes and
// are intentionally not migrated into this table.
export const savedWorkspaces = sqliteTable(
  "saved_workspaces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    scopeType: text("scope_type").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    ownerKind: text("owner_kind").notNull().default("manual"),
    // Stage 3 orchestration rows are keyed by task_id. Do not treat that task
    // identity as the stable orchestration identity. T6 resolves this opaque
    // link against authoritative orchestration data before writing it.
    orchestrationId: text("orchestration_id"),
    layoutVersion: integer("layout_version").notNull().default(1),
    layoutJson: text("layout_json").notNull(),
    sortOrder: text("sort_order").notNull().default("a0"),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
  },
  (table) => [
    index("saved_workspaces_project_order_idx").on(
      table.projectId,
      table.archivedAt,
      table.sortOrder,
    ),
    index("saved_workspaces_task_order_idx").on(table.taskId, table.archivedAt, table.sortOrder),
    uniqueIndex("saved_workspaces_orchestration_idx").on(table.orchestrationId),
    check("saved_workspaces_name_check", sql`length(trim(${table.name})) between 1 and 256`),
    check(
      "saved_workspaces_scope_check",
      sql`(
        (${table.scopeType} = 'project' and ${table.projectId} is not null and ${table.taskId} is null) or
        (${table.scopeType} = 'task' and ${table.projectId} is null and ${table.taskId} is not null)
      )`,
    ),
    check(
      "saved_workspaces_owner_check",
      sql`(
        (${table.ownerKind} = 'manual' and ${table.orchestrationId} is null) or
        (${table.ownerKind} = 'orchestration' and ${table.scopeType} = 'task' and ${table.taskId} is not null and ${table.orchestrationId} is not null)
      )`,
    ),
    check("saved_workspaces_layout_version_check", sql`${table.layoutVersion} = 1`),
    check("saved_workspaces_version_check", sql`${table.version} >= 1`),
    check(
      "saved_workspaces_sort_order_check",
      sql`length(trim(${table.sortOrder})) between 1 and 512`,
    ),
    check(
      "saved_workspaces_layout_json_check",
      sql`json_valid(${table.layoutJson}) = 1 and json_extract(${table.layoutJson}, '$.version') = ${table.layoutVersion} and length(cast(${table.layoutJson} as blob)) <= 262144`,
    ),
  ],
)

export const savedWorkspacesRelations = relations(savedWorkspaces, ({ one }) => ({
  project: one(projects, {
    fields: [savedWorkspaces.projectId],
    references: [projects.id],
  }),
  task: one(tasks, {
    fields: [savedWorkspaces.taskId],
    references: [tasks.id],
  }),
}))

// ============ AGENT RUNTIME DEFAULTS ============
// Runtime selection is keyed by harness, not model vendor. Global defaults use
// a null scope ID; project rows cascade with their owning project.
export const agentRuntimeDefaults = sqliteTable(
  "agent_runtime_defaults",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").references(() => projects.id, { onDelete: "cascade" }),
    harness: text("harness").notNull(),
    preference: text("preference").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("agent_runtime_defaults_global_idx")
      .on(table.harness)
      .where(sql`${table.scopeType} = 'global'`),
    uniqueIndex("agent_runtime_defaults_project_idx")
      .on(table.scopeId, table.harness)
      .where(sql`${table.scopeType} = 'project'`),
    check(
      "agent_runtime_defaults_scope_check",
      sql`(
        (${table.scopeType} = 'global' and ${table.scopeId} is null) or
        (${table.scopeType} = 'project' and ${table.scopeId} is not null)
      )`,
    ),
    check(
      "agent_runtime_defaults_preference_check",
      sql`${table.preference} in ('auto', 'codex', 'claude-code', 'flapstack-native')`,
    ),
    check("agent_runtime_defaults_version_check", sql`${table.version} >= 1`),
  ],
)

export const agentRuntimeDefaultsRelations = relations(agentRuntimeDefaults, ({ one }) => ({
  project: one(projects, {
    fields: [agentRuntimeDefaults.scopeId],
    references: [projects.id],
  }),
}))

// ============ COORDINATION ENGINE DEFAULTS ============
// Selection is independent from Agent Runtime. Global and project defaults are
// resolved before one immutable orchestration snapshot is written.
export const coordinationEngineDefaults = sqliteTable(
  "coordination_engine_defaults",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").references(() => projects.id, { onDelete: "cascade" }),
    engine: text("engine").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("coordination_engine_defaults_global_idx")
      .on(table.scopeType)
      .where(sql`${table.scopeType} = 'global'`),
    uniqueIndex("coordination_engine_defaults_project_idx")
      .on(table.scopeId)
      .where(sql`${table.scopeType} = 'project'`),
    check(
      "coordination_engine_defaults_scope_check",
      sql`(
        (${table.scopeType} = 'global' and ${table.scopeId} is null) or
        (${table.scopeType} = 'project' and ${table.scopeId} is not null)
      )`,
    ),
    check(
      "coordination_engine_defaults_engine_check",
      sql`${table.engine} in ('workflow', 'codex-v2', 'codex-v1')`,
    ),
    check("coordination_engine_defaults_version_check", sql`${table.version} >= 1`),
  ],
)

export const coordinationEngineDefaultsRelations = relations(
  coordinationEngineDefaults,
  ({ one }) => ({
    project: one(projects, {
      fields: [coordinationEngineDefaults.scopeId],
      references: [projects.id],
    }),
  }),
)

// ============ MULTI-AGENT OPERATIONS ============
export const orchestrationAuthorityApprovals = sqliteTable(
  "orchestration_authority_approvals",
  {
    auditId: text("audit_id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    consumedAt: integer("consumed_at").notNull(),
  },
  (table) => [
    index("orchestration_authority_task_idx").on(table.taskId, table.consumedAt),
    check(
      "orchestration_authority_tool_check",
      sql`${table.toolName} in ('orchestration.policy.relax','orchestration.template.launch')`,
    ),
  ],
)

export const orchestrationPolicyVersions = sqliteTable(
  "orchestration_policy_versions",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    policyJson: text("policy_json").notNull(),
    changeKind: text("change_kind").notNull(),
    approvalAuditId: text("approval_audit_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.version] }),
    index("orchestration_policy_task_idx").on(table.taskId, table.version),
    uniqueIndex("orchestration_policy_approval_once_idx")
      .on(table.approvalAuditId)
      .where(sql`${table.approvalAuditId} is not null`),
    check(
      "orchestration_policy_json_check",
      sql`json_valid(${table.policyJson}) = 1 and length(cast(${table.policyJson} as blob)) <= 65536`,
    ),
    check(
      "orchestration_policy_change_check",
      sql`${table.changeKind} in ('initial','tighten','relax','mixed','unchanged')`,
    ),
    check(
      "orchestration_policy_approval_check",
      sql`(${table.changeKind} in ('relax','mixed') and ${table.approvalAuditId} is not null) or ${table.changeKind} not in ('relax','mixed')`,
    ),
  ],
)

export const orchestrationTemplates = sqliteTable(
  "orchestration_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    definitionJson: text("definition_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [
    check("orchestration_templates_name_check", sql`length(trim(${table.name})) between 1 and 256`),
    check("orchestration_templates_version_check", sql`${table.version} >= 1`),
    check(
      "orchestration_templates_json_check",
      sql`json_valid(${table.definitionJson}) = 1 and json_extract(${table.definitionJson}, '$.schemaVersion') = 1 and length(cast(${table.definitionJson} as blob)) <= 262144`,
    ),
  ],
)

export const orchestrationMessages = sqliteTable(
  "orchestration_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => orchestrationAgents.id, { onDelete: "set null" }),
    direction: text("direction").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    body: text("body"),
    providerMessageId: text("provider_message_id"),
    actionIntentId: text("action_intent_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("orchestration_messages_task_order_idx").on(table.taskId, table.createdAt, table.id),
    uniqueIndex("orchestration_messages_action_intent_idx")
      .on(table.actionIntentId)
      .where(sql`${table.actionIntentId} is not null`),
    check(
      "orchestration_messages_direction_check",
      sql`${table.direction} in ('inbound','outbound')`,
    ),
    check(
      "orchestration_messages_kind_check",
      sql`${table.kind} in ('message','follow-up','interrupt','mailbox')`,
    ),
    check(
      "orchestration_messages_state_check",
      sql`${table.state} in ('recorded','queued','delivered','failed','uncertain')`,
    ),
    check(
      "orchestration_messages_body_check",
      sql`${table.body} is null or length(cast(${table.body} as blob)) <= 40000`,
    ),
  ],
)

export const orchestrationWorkflowRuns = sqliteTable(
  "orchestration_workflow_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    status: text("status").notNull(),
    definitionJson: text("definition_json").notNull(),
    approvalAuditId: text("approval_audit_id"),
    stopIntent: integer("stop_intent", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("orchestration_workflow_approval_once_idx")
      .on(table.approvalAuditId)
      .where(sql`${table.approvalAuditId} is not null`),
    check(
      "orchestration_workflow_status_check",
      sql`${table.status} in ('queued','running','waiting','blocked','paused','completed','failed','stopped','uncertain')`,
    ),
    check(
      "orchestration_workflow_definition_check",
      sql`json_valid(${table.definitionJson}) = 1 and length(cast(${table.definitionJson} as blob)) <= 262144`,
    ),
  ],
)

export const orchestrationWorkflowCheckpoints = sqliteTable(
  "orchestration_workflow_checkpoints",
  {
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => orchestrationWorkflowRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    status: text("status").notNull(),
    outputJson: text("output_json"),
    error: text("error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workflowRunId, table.stepId] }),
    check(
      "orchestration_workflow_checkpoint_status_check",
      sql`${table.status} in ('pending','running','waiting','blocked','completed','failed','uncertain','skipped')`,
    ),
    check(
      "orchestration_workflow_checkpoint_output_check",
      sql`${table.outputJson} is null or (json_valid(${table.outputJson}) = 1 and length(cast(${table.outputJson} as blob)) <= 65536)`,
    ),
  ],
)

export const coordinationActionIntents = sqliteTable(
  "coordination_action_intents",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    engine: text("engine").notNull(),
    action: text("action").notNull(),
    targetAgentId: text("target_agent_id"),
    payloadJson: text("payload_json").notNull(),
    state: text("state").notNull(),
    providerIdentityJson: text("provider_identity_json").notNull(),
    resultJson: text("result_json"),
    claimOwner: text("claim_owner"),
    claimExpiresAt: integer("claim_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("coordination_action_idempotency_idx").on(table.idempotencyKey),
    index("coordination_action_task_state_idx").on(table.taskId, table.state, table.createdAt),
    index("coordination_action_claim_idx").on(table.state, table.claimExpiresAt),
    check("coordination_action_engine_check", sql`${table.engine} in ('codex-v2','codex-v1')`),
    check(
      "coordination_action_state_check",
      sql`${table.state} in ('dispatching','running','waiting','completed','cancelled','uncertain','failed')`,
    ),
    check(
      "coordination_action_payload_check",
      sql`json_valid(${table.payloadJson}) = 1 and length(cast(${table.payloadJson} as blob)) <= 65536`,
    ),
    check("coordination_action_identity_check", sql`json_valid(${table.providerIdentityJson}) = 1`),
    check(
      "coordination_action_result_check",
      sql`${table.resultJson} is null or (json_valid(${table.resultJson}) = 1 and length(cast(${table.resultJson} as blob)) <= 65536)`,
    ),
    check(
      "coordination_action_claim_check",
      sql`(${table.claimOwner} is null and ${table.claimExpiresAt} is null) or (length(${table.claimOwner}) between 1 and 200 and ${table.claimExpiresAt} is not null)`,
    ),
  ],
)

export const orchestrationTransitionEvents = sqliteTable(
  "orchestration_transition_events",
  {
    id: text("id").primaryKey(),
    dedupKey: text("dedup_key").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    agentId: text("agent_id"),
    runId: text("run_id"),
    kind: text("kind").notNull(),
    phase: text("phase").notNull(),
    summary: text("summary"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("orchestration_transition_dedup_idx").on(table.dedupKey),
    index("orchestration_transition_task_order_idx").on(table.taskId, table.createdAt, table.id),
    check(
      "orchestration_transition_summary_check",
      sql`${table.summary} is null or (substr(${table.summary},1,17) = 'Activity summary:' and length(cast(${table.summary} as blob)) <= 4096)`,
    ),
  ],
)

export const orchestrationControlIntents = sqliteTable(
  "orchestration_control_intents",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    action: text("action").notNull(),
    state: text("state").notNull(),
    previewJson: text("preview_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("orchestration_control_action_check", sql`${table.action} in ('pause','resume','stop')`),
    check(
      "orchestration_control_state_check",
      sql`${table.state} in ('pending','partial','completed')`,
    ),
    check(
      "orchestration_control_preview_check",
      sql`json_valid(${table.previewJson}) = 1 and length(cast(${table.previewJson} as blob)) <= 262144`,
    ),
  ],
)

export const orchestrationControlTargets = sqliteTable(
  "orchestration_control_targets",
  {
    intentId: text("intent_id")
      .notNull()
      .references(() => orchestrationControlIntents.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    runId: text("run_id"),
    state: text("state").notNull(),
    error: text("error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.intentId, table.agentId] }),
    check(
      "orchestration_control_target_state_check",
      sql`${table.state} in ('pending','processing','no-run','reconciled','failed')`,
    ),
    check(
      "orchestration_control_target_error_check",
      sql`${table.error} is null or length(cast(${table.error} as blob)) <= 1024`,
    ),
  ],
)

export const orchestrationActivityEvents = sqliteTable(
  "orchestration_activity_events",
  {
    id: text("id").primaryKey(),
    dedupKey: text("dedup_key").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskOrchestrations.taskId, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => orchestrationAgents.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    sourceActivityEventId: text("source_activity_event_id").references(
      () => agentActivityEvents.eventId,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    phase: text("phase").notNull(),
    summary: text("summary"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("orchestration_activity_dedup_idx").on(table.dedupKey),
    index("orchestration_activity_task_order_idx").on(table.taskId, table.createdAt, table.id),
    check(
      "orchestration_activity_kind_check",
      sql`${table.kind} in ('workflow-phase','checkpoint','dependency','spawn','replacement','mailbox','coordination','warning','usage','aggregate-status')`,
    ),
    check(
      "orchestration_activity_summary_check",
      sql`${table.summary} is null or (substr(${table.summary},1,17) = 'Activity summary:' and length(cast(${table.summary} as blob)) <= 4096)`,
    ),
  ],
)

// ============ CHATS ============
export const chats = sqliteTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("project"),
    permissionMode: text("permission_mode").notNull().default("ask-before-edits"),
    customPermissions: text("custom_permissions"),
    mcpExposureEnabled: integer("mcp_exposure_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    harness: text("harness"),
    model: text("model"),
    runtimePreference: text("runtime_preference"),
    // Cross-harness spawning keeps enough durable lineage to reject loops and
    // explain where a thread came from without depending on a live process.
    parentChatId: text("parent_chat_id"),
    initiatorChatId: text("initiator_chat_id"),
    parentRunId: text("parent_run_id"),
    ancestorChatIds: text("ancestor_chat_ids"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    pinnedAt: integer("pinned_at", { mode: "timestamp" }),
    // Worktree fields (for git isolation per chat)
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    // PR tracking fields
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
  },
  (table) => [
    index("chats_worktree_path_idx").on(table.worktreePath),
    index("chats_task_id_idx").on(table.taskId),
    index("chats_scope_idx").on(table.scope),
  ],
)

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  task: one(tasks, {
    fields: [chats.taskId],
    references: [tasks.id],
  }),
  subChats: many(subChats),
  runs: many(agentRuns),
  attachments: many(attachments),
}))

// ============ SUB-CHATS ============
export const subChats = sqliteTable("sub_chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "agent"
  harness: text("harness"),
  model: text("model"),
  permissionMode: text("permission_mode"),
  worktreePath: text("worktree_path"),
  runStatus: text("run_status"),
  messages: text("messages").notNull().default("[]"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

export const subChatsRelations = relations(subChats, ({ one, many }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id],
  }),
  runs: many(agentRuns),
}))

// ============ AGENT RUNS ============
export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    subChatId: text("sub_chat_id").references(() => subChats.id, { onDelete: "set null" }),
    harness: text("harness").notNull(),
    model: text("model"),
    permissionMode: text("permission_mode").notNull(),
    customPermissions: text("custom_permissions"),
    worktreePath: text("worktree_path"),
    promptMessageId: text("prompt_message_id"),
    initialPrompt: text("initial_prompt"),
    // Exact run override and the immutable provenance report for the context used.
    vaultContextSections: text("vault_context_sections"),
    vaultContextManifest: text("vault_context_manifest"),
    // Version 0 is reserved for rows migrated from Stage 3. Every new launch
    // writes version 1 before pending/running intent.
    runtimeSnapshotVersion: integer("runtime_snapshot_version").notNull().default(0),
    runtimePreference: text("runtime_preference").notNull().default("flapstack-native"),
    runtimePreferenceSource: text("runtime_preference_source").notNull().default("legacy"),
    resolvedRuntime: text("resolved_runtime").notNull().default("flapstack-native"),
    runtimeAdapterVersion: text("runtime_adapter_version").notNull().default("legacy-stage3"),
    runtimeProtocolVersion: text("runtime_protocol_version").notNull().default("legacy-stage3"),
    runtimeCapabilitySnapshot: text("runtime_capability_snapshot")
      .notNull()
      .default('{"schemaVersion":1,"status":"legacy"}'),
    runtimeControlSnapshot: text("runtime_control_snapshot")
      .notNull()
      .default('{"schemaVersion":1}'),
    status: text("status").notNull().default("running"),
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    beforeCheckpointId: text("before_checkpoint_id"),
    afterCheckpointId: text("after_checkpoint_id"),
  },
  (table) => [index("agent_runs_chat_id_idx").on(table.chatId)],
)

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  chat: one(chats, {
    fields: [agentRuns.chatId],
    references: [chats.id],
  }),
  subChat: one(subChats, {
    fields: [agentRuns.subChatId],
    references: [subChats.id],
  }),
  checkpoints: many(checkpoints),
  manifest: many(fileChangeManifests),
  activityEvents: many(agentActivityEvents),
  activitySequence: one(agentActivitySequences),
}))

// ============ AGENT RUNTIME ACTIVITY ============
// Provider events are append-only during normal operation. Explicit retention
// and redaction maintenance preserve identity and order while removing payload.
export const agentActivitySequences = sqliteTable(
  "agent_activity_sequences",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    nextSequence: integer("next_sequence").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [check("agent_activity_sequences_next_check", sql`${table.nextSequence} >= 1`)],
)

export const agentActivitySequencesRelations = relations(agentActivitySequences, ({ one }) => ({
  run: one(agentRuns, {
    fields: [agentActivitySequences.runId],
    references: [agentRuns.id],
  }),
}))

export const agentActivityEvents = sqliteTable(
  "agent_activity_events",
  {
    storageId: integer("storage_id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    subChatId: text("sub_chat_id"),
    orchestrationAgentId: text("orchestration_agent_id"),
    runtime: text("runtime").notNull(),
    harness: text("harness").notNull(),
    provider: text("provider").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    phase: text("phase").notNull(),
    displayClass: text("display_class").notNull(),
    privacyClass: text("privacy_class").notNull(),
    redactionState: text("redaction_state").notNull().default("none"),
    redactionReason: text("redaction_reason"),
    providerTimestamp: integer("provider_timestamp"),
    receivedAt: integer("received_at").notNull(),
    providerEventId: text("provider_event_id"),
    providerSessionId: text("provider_session_id"),
    providerThreadId: text("provider_thread_id"),
    providerTurnId: text("provider_turn_id"),
    providerItemId: text("provider_item_id"),
    providerParentItemId: text("provider_parent_item_id"),
    providerMessageId: text("provider_message_id"),
    providerToolId: text("provider_tool_id"),
    summaryIndex: integer("summary_index"),
    contentIndex: integer("content_index"),
    partIndex: integer("part_index"),
    sectionBoundary: text("section_boundary"),
    dedupKey: text("dedup_key"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_events_event_id_idx").on(table.eventId),
    uniqueIndex("agent_activity_events_run_sequence_idx").on(table.runId, table.sequence),
    uniqueIndex("agent_activity_events_run_dedup_idx")
      .on(table.runId, table.dedupKey)
      .where(sql`${table.dedupKey} is not null`),
    index("agent_activity_events_chat_storage_idx").on(table.chatId, table.storageId),
    index("agent_activity_events_run_storage_idx").on(table.runId, table.storageId),
    index("agent_activity_events_received_idx").on(table.receivedAt, table.storageId),
    check("agent_activity_events_sequence_check", sql`${table.sequence} >= 1`),
    check(
      "agent_activity_events_runtime_check",
      sql`${table.runtime} in ('codex', 'claude-code', 'flapstack-native')`,
    ),
    check(
      "agent_activity_events_kind_check",
      sql`${table.kind} in ('lifecycle', 'status', 'agent-text', 'reasoning-summary', 'provider-visible-reasoning', 'plan', 'tool', 'command', 'patch', 'permission', 'hook', 'subagent', 'warning', 'compaction', 'usage', 'opaque-metadata', 'private-metadata')`,
    ),
    check(
      "agent_activity_events_phase_check",
      sql`${table.phase} in ('queued', 'started', 'delta', 'updated', 'completed', 'failed', 'cancelled', 'snapshot')`,
    ),
    check(
      "agent_activity_events_display_check",
      sql`${table.displayClass} in ('summary', 'provider-visible', 'status', 'tool', 'private', 'metadata')`,
    ),
    check(
      "agent_activity_events_privacy_check",
      sql`${table.privacyClass} in ('public', 'sensitive', 'private', 'encrypted')`,
    ),
    check(
      "agent_activity_events_redaction_check",
      sql`${table.redactionState} in ('none', 'redacted', 'retained-redaction', 'corrupt')`,
    ),
    check(
      "agent_activity_events_payload_check",
      sql`json_valid(${table.payloadJson}) = 1 and length(cast(${table.payloadJson} as blob)) <= 65536`,
    ),
  ],
)

export const agentActivityEventsRelations = relations(agentActivityEvents, ({ one }) => ({
  run: one(agentRuns, {
    fields: [agentActivityEvents.runId],
    references: [agentRuns.id],
  }),
}))

// ============ LOCAL AUTOMATION ============
// Automation rows are inert by default. Scheduler and control services may
// only make an approved row active; the database rejects partial authority and
// target combinations even when a caller bypasses the TypeScript contracts.
export const automations = sqliteTable(
  "automations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    description: text("description"),
    scopeType: text("scope_type").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    actionConfig: text("action_config").notNull().default("{}"),
    prompt: text("prompt").notNull(),
    harness: text("harness").notNull(),
    model: text("model"),
    permissionMode: text("permission_mode").notNull(),
    customPermissions: text("custom_permissions"),
    worktreeStrategy: text("worktree_strategy").notNull().default("inherit"),
    worktreePath: text("worktree_path"),
    state: text("state").notNull().default("draft"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    approvalState: text("approval_state").notNull().default("pending"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    approvalAuditId: text("approval_audit_id"),
    createdByType: text("created_by_type").notNull().default("user"),
    createdByChatId: text("created_by_chat_id"),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
  },
  (table) => [
    index("automations_scope_idx").on(table.scopeType, table.projectId, table.taskId, table.chatId),
    index("automations_state_enabled_idx").on(table.state, table.enabled),
    index("automations_approval_idx").on(table.approvalState, table.createdByType),
    check("automations_name_check", sql`length(trim(${table.name})) between 1 and 256`),
    check(
      "automations_scope_check",
      sql`(
        (${table.scopeType} = 'global' and ${table.projectId} is null and ${table.taskId} is null and ${table.chatId} is null) or
        (${table.scopeType} = 'project' and ${table.projectId} is not null and ${table.taskId} is null and ${table.chatId} is null) or
        (${table.scopeType} = 'task' and ${table.projectId} is null and ${table.taskId} is not null and ${table.chatId} is null) or
        (${table.scopeType} = 'chat' and ${table.projectId} is null and ${table.taskId} is null and ${table.chatId} is not null)
      )`,
    ),
    check(
      "automations_action_check",
      sql`(
        (${table.actionType} = 'run-chat' and ${table.scopeType} = 'chat') or
        (${table.actionType} = 'create-chat-run' and ${table.scopeType} in ('global', 'project', 'task')) or
        (${table.actionType} = 'create-task-run' and ${table.scopeType} = 'project')
      )`,
    ),
    check(
      "automations_harness_check",
      sql`${table.harness} in ('codex', 'claude-code', 'cursor-agent', 'openrouter', 'nanogpt', 'local')`,
    ),
    check(
      "automations_permission_check",
      sql`(
        (${table.permissionMode} = 'custom' and ${table.customPermissions} is not null) or
        (${table.permissionMode} in ('read-only', 'ask-before-edits', 'auto-edit-project-only', 'full-access') and ${table.customPermissions} is null)
      )`,
    ),
    check(
      "automations_worktree_check",
      sql`(
        (${table.worktreeStrategy} = 'existing' and ${table.worktreePath} is not null) or
        (${table.worktreeStrategy} in ('inherit', 'task-primary', 'none') and ${table.worktreePath} is null)
      )`,
    ),
    check(
      "automations_state_check",
      sql`${table.state} in ('draft', 'active', 'paused', 'archived')`,
    ),
    check(
      "automations_approval_state_check",
      sql`${table.approvalState} in ('pending', 'approved', 'denied', 'revoked')`,
    ),
    check(
      "automations_enabled_approval_check",
      sql`(${table.enabled} = 0 and ${table.state} in ('draft', 'paused', 'archived')) or (
        ${table.enabled} = 1 and
        ${table.state} = 'active' and ${table.approvalState} = 'approved' and
        ${table.approvedBy} is not null and ${table.approvedAt} is not null
      )`,
    ),
    check(
      "automations_approval_provenance_check",
      sql`(
        (${table.approvalState} = 'pending' and ${table.approvedBy} is null and ${table.approvedAt} is null and ${table.approvalAuditId} is null) or
        (${table.approvalState} in ('approved', 'denied', 'revoked') and ${table.approvedBy} is not null and ${table.approvedAt} is not null and ${table.approvalAuditId} is not null)
      )`,
    ),
    check(
      "automations_creator_check",
      sql`(
        (${table.createdByType} = 'user') or
        (${table.createdByType} = 'agent' and ${table.createdByChatId} is not null)
      )`,
    ),
    check("automations_version_check", sql`${table.version} >= 1`),
  ],
)

export const automationTriggers = sqliteTable(
  "automation_triggers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    cron: text("cron"),
    timezone: text("timezone"),
    catchUp: text("catch_up"),
    runProjectId: text("run_project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    runTaskId: text("run_task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runChatId: text("run_chat_id").references(() => chats.id, { onDelete: "cascade" }),
    runStatuses: text("run_statuses"),
    rootPath: text("root_path").references(() => filesystemRootRegistrations.path, {
      onDelete: "restrict",
    }),
    includeGlobs: text("include_globs"),
    excludeGlobs: text("exclude_globs"),
    debounceMs: integer("debounce_ms"),
    nextFireAt: integer("next_fire_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("automation_triggers_automation_type_idx").on(table.automationId, table.type),
    index("automation_triggers_due_idx").on(table.enabled, table.nextFireAt),
    index("automation_triggers_run_project_idx").on(table.runProjectId),
    index("automation_triggers_run_task_idx").on(table.runTaskId),
    index("automation_triggers_run_chat_idx").on(table.runChatId),
    index("automation_triggers_root_idx").on(table.rootPath),
    check(
      "automation_triggers_config_check",
      sql`(
        (${table.type} = 'manual' and
          ${table.cron} is null and ${table.timezone} is null and ${table.catchUp} is null and
          ${table.runProjectId} is null and ${table.runTaskId} is null and ${table.runChatId} is null and ${table.runStatuses} is null and
          ${table.rootPath} is null and ${table.includeGlobs} is null and ${table.excludeGlobs} is null and ${table.debounceMs} is null) or
        (${table.type} = 'schedule' and
          ${table.cron} is not null and ${table.timezone} is not null and ${table.catchUp} in ('none', 'one') and
          ${table.runProjectId} is null and ${table.runTaskId} is null and ${table.runChatId} is null and ${table.runStatuses} is null and
          ${table.rootPath} is null and ${table.includeGlobs} is null and ${table.excludeGlobs} is null and ${table.debounceMs} is null) or
        (${table.type} = 'run-complete' and
          ((${table.runProjectId} is not null) + (${table.runTaskId} is not null) + (${table.runChatId} is not null)) = 1 and
          ${table.runStatuses} is not null and
          ${table.cron} is null and ${table.timezone} is null and ${table.catchUp} is null and
          ${table.rootPath} is null and ${table.includeGlobs} is null and ${table.excludeGlobs} is null and ${table.debounceMs} is null) or
        (${table.type} = 'file-change' and
          ${table.rootPath} is not null and ${table.includeGlobs} is not null and ${table.excludeGlobs} is not null and
          ${table.debounceMs} between 100 and 60000 and
          ${table.cron} is null and ${table.timezone} is null and ${table.catchUp} is null and
          ${table.runProjectId} is null and ${table.runTaskId} is null and ${table.runChatId} is null and ${table.runStatuses} is null)
      )`,
    ),
  ],
)

export const automationOccurrences = sqliteTable(
  "automation_occurrences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    triggerId: text("trigger_id")
      .notNull()
      .references(() => automationTriggers.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state").notNull().default("pending"),
    scheduledFor: integer("scheduled_for", { mode: "timestamp" }).notNull(),
    payload: text("payload").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    terminalAt: integer("terminal_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("automation_occurrences_dedupe_idx").on(table.automationId, table.dedupeKey),
    index("automation_occurrences_state_due_idx").on(table.state, table.scheduledFor),
    index("automation_occurrences_trigger_idx").on(table.triggerId, table.createdAt),
    check(
      "automation_occurrences_state_check",
      sql`${table.state} in ('pending', 'leased', 'running', 'completed', 'cancelled', 'skipped')`,
    ),
    check(
      "automation_occurrences_terminal_check",
      sql`(
        (${table.state} in ('completed', 'cancelled', 'skipped') and ${table.terminalAt} is not null) or
        (${table.state} in ('pending', 'leased', 'running') and ${table.terminalAt} is null)
      )`,
    ),
  ],
)

export const automationExecutions = sqliteTable(
  "automation_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => automationOccurrences.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(1),
    state: text("state").notNull().default("pending"),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    authoritySnapshot: text("authority_snapshot").notNull(),
    budgetSnapshot: text("budget_snapshot").notNull(),
    resultSummary: text("result_summary"),
    stopReason: text("stop_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("automation_executions_attempt_idx").on(table.occurrenceId, table.attempt),
    index("automation_executions_state_idx").on(table.state, table.createdAt),
    index("automation_executions_run_idx").on(table.runId),
    check("automation_executions_attempt_check", sql`${table.attempt} between 1 and 10`),
    check(
      "automation_executions_state_check",
      sql`${table.state} in ('pending', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'timed-out')`,
    ),
    check(
      "automation_executions_time_check",
      sql`(
        (${table.state} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null) or
        (${table.state} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or
        (${table.state} in ('succeeded', 'failed', 'denied', 'cancelled', 'timed-out') and ${table.completedAt} is not null)
      )`,
    ),
  ],
)

export const automationLeases = sqliteTable(
  "automation_leases",
  {
    occurrenceId: text("occurrence_id")
      .primaryKey()
      .references(() => automationOccurrences.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    token: text("token").notNull(),
    acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("automation_leases_token_idx").on(table.token),
    index("automation_leases_expiry_idx").on(table.expiresAt),
    check("automation_leases_expiry_check", sql`${table.expiresAt} > ${table.acquiredAt}`),
  ],
)

export const automationRetryPolicies = sqliteTable(
  "automation_retry_policies",
  {
    automationId: text("automation_id")
      .primaryKey()
      .references(() => automations.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("none"),
    maxAttempts: integer("max_attempts").notNull().default(1),
    initialDelayMs: integer("initial_delay_ms").notNull().default(0),
    maxDelayMs: integer("max_delay_ms").notNull().default(0),
    deadlineMs: integer("deadline_ms").notNull().default(0),
  },
  (table) => [
    check(
      "automation_retry_policies_check",
      sql`(
        (${table.mode} = 'none' and ${table.maxAttempts} = 1 and ${table.initialDelayMs} = 0 and ${table.maxDelayMs} = 0 and ${table.deadlineMs} = 0) or
        (${table.mode} = 'exponential' and ${table.maxAttempts} between 2 and 10 and
          ${table.initialDelayMs} between 100 and 86400000 and
          ${table.maxDelayMs} between ${table.initialDelayMs} and 86400000 and
          ${table.deadlineMs} between ${table.initialDelayMs} and 2678400000)
      )`,
    ),
  ],
)

export const automationBudgets = sqliteTable(
  "automation_budgets",
  {
    automationId: text("automation_id")
      .primaryKey()
      .references(() => automations.id, { onDelete: "cascade" }),
    maxDurationMs: integer("max_duration_ms").default(3_600_000),
    maxTotalTokens: integer("max_total_tokens"),
    maxCostUsdMicros: integer("max_cost_usd_micros"),
    maxConcurrentRuns: integer("max_concurrent_runs").notNull().default(1),
  },
  (table) => [
    check(
      "automation_budgets_values_check",
      sql`(${table.maxDurationMs} is null or ${table.maxDurationMs} between 1000 and 2678400000) and
        (${table.maxTotalTokens} is null or ${table.maxTotalTokens} > 0) and
        (${table.maxCostUsdMicros} is null or ${table.maxCostUsdMicros} > 0) and
        (${table.maxCostUsdMicros} is null or ${table.maxDurationMs} is not null or ${table.maxTotalTokens} is not null) and
        ${table.maxConcurrentRuns} = 1`,
    ),
  ],
)

export const automationInboxItems = sqliteTable(
  "automation_inbox_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    occurrenceId: text("occurrence_id").references(() => automationOccurrences.id, {
      onDelete: "set null",
    }),
    executionId: text("execution_id").references(() => automationExecutions.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    unread: integer("unread", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    readAt: integer("read_at", { mode: "timestamp" }),
  },
  (table) => [
    index("automation_inbox_unread_idx").on(table.unread, table.createdAt),
    index("automation_inbox_automation_idx").on(table.automationId, table.createdAt),
    check(
      "automation_inbox_kind_check",
      sql`${table.kind} in ('completed', 'failed', 'denied', 'budget-exhausted', 'cancelled')`,
    ),
    check("automation_inbox_title_check", sql`length(trim(${table.title})) between 1 and 256`),
    check(
      "automation_inbox_read_check",
      sql`(${table.unread} = 1 and ${table.readAt} is null) or (${table.unread} = 0 and ${table.readAt} is not null)`,
    ),
  ],
)

export const automationsRelations = relations(automations, ({ one, many }) => ({
  project: one(projects, { fields: [automations.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [automations.taskId], references: [tasks.id] }),
  chat: one(chats, { fields: [automations.chatId], references: [chats.id] }),
  createdByChat: one(chats, {
    fields: [automations.createdByChatId],
    references: [chats.id],
    relationName: "automationCreatorChat",
  }),
  triggers: many(automationTriggers),
  occurrences: many(automationOccurrences),
  retryPolicy: one(automationRetryPolicies),
  budget: one(automationBudgets),
  inboxItems: many(automationInboxItems),
}))

export const automationTriggersRelations = relations(automationTriggers, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationTriggers.automationId],
    references: [automations.id],
  }),
  occurrences: many(automationOccurrences),
}))

export const automationOccurrencesRelations = relations(automationOccurrences, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationOccurrences.automationId],
    references: [automations.id],
  }),
  trigger: one(automationTriggers, {
    fields: [automationOccurrences.triggerId],
    references: [automationTriggers.id],
  }),
  executions: many(automationExecutions),
  lease: one(automationLeases),
}))

export const automationExecutionsRelations = relations(automationExecutions, ({ one }) => ({
  occurrence: one(automationOccurrences, {
    fields: [automationExecutions.occurrenceId],
    references: [automationOccurrences.id],
  }),
  run: one(agentRuns, { fields: [automationExecutions.runId], references: [agentRuns.id] }),
}))

export const automationLeasesRelations = relations(automationLeases, ({ one }) => ({
  occurrence: one(automationOccurrences, {
    fields: [automationLeases.occurrenceId],
    references: [automationOccurrences.id],
  }),
}))

export const automationRetryPoliciesRelations = relations(automationRetryPolicies, ({ one }) => ({
  automation: one(automations, {
    fields: [automationRetryPolicies.automationId],
    references: [automations.id],
  }),
}))

export const automationBudgetsRelations = relations(automationBudgets, ({ one }) => ({
  automation: one(automations, {
    fields: [automationBudgets.automationId],
    references: [automations.id],
  }),
}))

export const automationInboxItemsRelations = relations(automationInboxItems, ({ one }) => ({
  automation: one(automations, {
    fields: [automationInboxItems.automationId],
    references: [automations.id],
  }),
  occurrence: one(automationOccurrences, {
    fields: [automationInboxItems.occurrenceId],
    references: [automationOccurrences.id],
  }),
  execution: one(automationExecutions, {
    fields: [automationInboxItems.executionId],
    references: [automationExecutions.id],
  }),
}))

// ============ MCP AUDIT RECORDS ============
// Deliberately no foreign keys: audit history must survive chat/run lifecycle changes.
export const mcpAuditRecords = sqliteTable(
  "mcp_audit_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    invocationId: text("invocation_id").notNull(),
    status: text("status").notNull(),
    callerChatId: text("caller_chat_id").notNull(),
    callerRunId: text("caller_run_id"),
    toolName: text("tool_name").notNull(),
    tier: integer("tier").notNull(),
    callerSnapshot: text("caller_snapshot").notNull(),
    chatSnapshot: text("chat_snapshot").notNull(),
    runSnapshot: text("run_snapshot").notNull(),
    inputSummary: text("input_summary").notNull(),
    resultSummary: text("result_summary").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("mcp_audit_records_created_at_idx").on(table.createdAt),
    index("mcp_audit_records_caller_chat_id_idx").on(table.callerChatId),
    index("mcp_audit_records_tool_name_idx").on(table.toolName),
    index("mcp_audit_records_status_idx").on(table.status),
    index("mcp_audit_records_invocation_id_idx").on(table.invocationId),
  ],
)

// ============ MCP APPROVAL REQUESTS ============
// Cross-process coordination only. The harness-owned MCP child keeps grants in
// memory; this table lets the renderer see and resolve one pending decision.
export const mcpApprovalRequests = sqliteTable(
  "mcp_approval_requests",
  {
    id: text("id").primaryKey(),
    invocationId: text("invocation_id").notNull(),
    callerChatId: text("caller_chat_id").notNull(),
    callerRunId: text("caller_run_id"),
    toolName: text("tool_name").notNull(),
    tier: integer("tier").notNull(),
    targetSummary: text("target_summary").notNull(),
    inputSummary: text("input_summary").notNull(),
    decision: text("decision"),
    grantSession: integer("grant_session", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("mcp_approval_requests_pending_idx").on(table.decision, table.expiresAt),
    index("mcp_approval_requests_chat_id_idx").on(table.callerChatId),
  ],
)

// ============ CHECKPOINTS ============
export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    worktreePath: text("worktree_path"),
    gitCommit: text("git_commit"),
    gitStatusJson: text("git_status_json"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("checkpoints_run_id_idx").on(table.runId)],
)

export const checkpointsRelations = relations(checkpoints, ({ one }) => ({
  run: one(agentRuns, {
    fields: [checkpoints.runId],
    references: [agentRuns.id],
  }),
}))

// ============ FILE CHANGE MANIFESTS ============
export const fileChangeManifests = sqliteTable(
  "file_change_manifests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    changeType: text("change_type").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    beforeHash: text("before_hash"),
    afterHash: text("after_hash"),
  },
  (table) => [index("file_change_manifests_run_id_idx").on(table.runId)],
)

export const fileChangeManifestsRelations = relations(fileChangeManifests, ({ one }) => ({
  run: one(agentRuns, {
    fields: [fileChangeManifests.runId],
    references: [agentRuns.id],
  }),
}))

// ============ ATTACHMENTS ============
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sourcePath: text("source_path"),
    storedPath: text("stored_path"),
    contentText: text("content_text"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("attachments_chat_id_idx").on(table.chatId),
    index("attachments_task_id_idx").on(table.taskId),
  ],
)

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  chat: one(chats, {
    fields: [attachments.chatId],
    references: [chats.id],
  }),
  task: one(tasks, {
    fields: [attachments.taskId],
    references: [tasks.id],
  }),
}))

// ============ VOICE HISTORY ============
// Speech metadata remains queryable in SQLite while generated TTS audio stays
// in local files under userData/voice-history.
export const voiceArtifacts = sqliteTable(
  "voice_artifacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    subChatId: text("sub_chat_id").references(() => subChats.id, { onDelete: "set null" }),
    messageId: text("message_id"),
    kind: text("kind").notNull(), // transcription | speech
    text: text("text").notNull(),
    adapterId: text("adapter_id").notNull(),
    modelId: text("model_id"),
    originKind: text("origin_kind"),
    originId: text("origin_id"),
    originLabel: text("origin_label"),
    synthesisKey: text("synthesis_key"),
    voiceId: text("voice_id"),
    rate: integer("rate_milli"),
    audioPath: text("audio_path"),
    mimeType: text("mime_type"),
    byteLength: integer("byte_length").notNull().default(0),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    lastPlayedAt: integer("last_played_at", { mode: "timestamp" }),
  },
  (table) => [
    index("voice_artifacts_chat_created_idx").on(table.chatId, table.createdAt),
    index("voice_artifacts_message_idx").on(table.messageId),
    index("voice_artifacts_synthesis_idx").on(table.messageId, table.synthesisKey),
    index("voice_artifacts_kind_created_idx").on(table.kind, table.createdAt),
    index("voice_artifacts_origin_idx").on(table.originKind, table.originId),
  ],
)

export const voiceArtifactsRelations = relations(voiceArtifacts, ({ one }) => ({
  chat: one(chats, { fields: [voiceArtifacts.chatId], references: [chats.id] }),
  subChat: one(subChats, { fields: [voiceArtifacts.subChatId], references: [subChats.id] }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable("anthropic_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text("email"), // User's email from OAuth (if available)
  displayName: text("display_name"), // User-editable label
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  desktopUserId: text("desktop_user_id"), // Reference to flapstack.dev user
})

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable("anthropic_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  activeAccountId: text("active_account_id"), // References anthropicAccounts.id
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// ============ USAGE TRACKING (Stage 2 Track B - replaces onWatch) ============
// Shared usage store written by the background daemon and read by the app.
// See src/main/lib/usage/* for the engine, providers, and store helpers.

// Normalized per-poll usage samples. One row = one observation of a provider's
// usage/cost at a point in time. Raw provider payloads are preserved for drift
// debugging; credentials must never be written into rawPayload.
export const usageSamples = sqliteTable(
  "usage_samples",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    providerId: text("provider_id").notNull(), // "codex" | "anthropic" | "cursor" | "openrouter" | "nanogpt"
    accountTag: text("account_tag").notNull().default(""), // account/profile/key identifier for multi-account debugging
    // Sample origin: "daemon-poll" | "app-poll" | "startup-reconcile" | "flapstack-run" | "external-provider"
    source: text("source").notNull(),
    // Cost quality: "exact" | "provider-reported" | "estimated" | "unknown"
    costQuality: text("cost_quality").notNull().default("unknown"),
    // Provider sub-source tag, e.g. Cursor "internal" | "admin" | "cli"
    sourceTag: text("source_tag"),
    // Stable provider metric/quota key, e.g. "five_hour" | "credits".
    metricKey: text("metric_key"),
    capturedAt: integer("captured_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    windowStart: integer("window_start", { mode: "timestamp" }),
    windowEnd: integer("window_end", { mode: "timestamp" }),
    // Token + request counts (nullable - providers may only expose some)
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    requestCount: integer("request_count"),
    // Cost. costUsd = exact/provider-reported; costUsdEstimated = derived estimate.
    costUsd: integer("cost_usd_micros"), // stored as integer micro-dollars to avoid float drift
    costUsdEstimated: integer("cost_usd_estimated_micros"),
    currency: text("currency").notNull().default("USD"),
    // Subscription/quota providers
    percentUsed: integer("percent_used"), // 0-100 integer
    quotaUsed: integer("quota_used"),
    quotaLimit: integer("quota_limit"),
    quotaUnit: text("quota_unit"),
    resetAt: integer("reset_at", { mode: "timestamp" }),
    // Provider-specific correlation ids
    model: text("model"),
    generationId: text("generation_id"), // OpenRouter generation id for later reconciliation
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    // Immutable product-scope attribution. Null means unavailable, never an
    // inferred current value. Snapshot ids deliberately have no foreign keys so
    // rename/archive/delete cannot rewrite historical attribution.
    attributionState: text("attribution_state").notNull().default("unknown"),
    attributionHarness: text("attribution_harness"),
    attributionProjectId: text("attribution_project_id"),
    attributionProjectName: text("attribution_project_name"),
    attributionTaskId: text("attribution_task_id"),
    attributionTaskName: text("attribution_task_name"),
    attributionChatId: text("attribution_chat_id"),
    attributionChatName: text("attribution_chat_name"),
    attributionAutomationId: text("attribution_automation_id"),
    attributionAutomationName: text("attribution_automation_name"),
    attributionOrchestrationId: text("attribution_orchestration_id"),
    attributionOrchestrationName: text("attribution_orchestration_name"),
    attributionRunId: text("attribution_run_id"),
    // Source class separates provider totals from run facts. A dedupe group
    // only exists when later reconciliation must compare overlapping classes.
    sourceClass: text("source_class").notNull().default("unknown"),
    dedupeStrategy: text("dedupe_strategy").notNull().default("unknown"),
    dedupeGroupKey: text("dedupe_group_key"),
    rawPayload: text("raw_payload"), // JSON string of the normalized-from provider payload
    // Deterministic dedup key (providerId/accountTag/window/source) to prevent double-counting.
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("usage_samples_provider_idx").on(table.providerId),
    index("usage_samples_captured_at_idx").on(table.capturedAt),
    index("usage_samples_source_class_captured_idx").on(table.sourceClass, table.capturedAt),
    index("usage_samples_project_captured_idx").on(table.attributionProjectId, table.capturedAt),
    index("usage_samples_task_captured_idx").on(table.attributionTaskId, table.capturedAt),
    index("usage_samples_chat_captured_idx").on(table.attributionChatId, table.capturedAt),
    index("usage_samples_automation_captured_idx").on(
      table.attributionAutomationId,
      table.capturedAt,
    ),
    index("usage_samples_orchestration_captured_idx").on(
      table.attributionOrchestrationId,
      table.capturedAt,
    ),
    index("usage_samples_dedupe_group_idx").on(table.dedupeGroupKey),
    uniqueIndex("usage_samples_dedupe_key_idx").on(table.dedupeKey),
    check(
      "usage_samples_attribution_check",
      sql`(
        (${table.attributionState} = 'unknown' and
          ${table.attributionHarness} is null and ${table.attributionProjectId} is null and ${table.attributionProjectName} is null and
          ${table.attributionTaskId} is null and ${table.attributionTaskName} is null and
          ${table.attributionChatId} is null and ${table.attributionChatName} is null and
          ${table.attributionAutomationId} is null and ${table.attributionAutomationName} is null and
          ${table.attributionOrchestrationId} is null and ${table.attributionOrchestrationName} is null and
          ${table.attributionRunId} is null) or
        (${table.attributionState} = 'attributed' and
          (${table.attributionHarness} is not null or ${table.attributionProjectId} is not null or ${table.attributionProjectName} is not null or
           ${table.attributionTaskId} is not null or ${table.attributionTaskName} is not null or
           ${table.attributionChatId} is not null or ${table.attributionChatName} is not null or
           ${table.attributionAutomationId} is not null or ${table.attributionAutomationName} is not null or
           ${table.attributionOrchestrationId} is not null or ${table.attributionOrchestrationName} is not null or
           ${table.attributionRunId} is not null))
      )`,
    ),
    check(
      "usage_samples_source_class_check",
      sql`${table.sourceClass} in ('provider-account-total', 'flapstack-run', 'external-provider', 'unknown')`,
    ),
    check(
      "usage_samples_dedupe_strategy_check",
      sql`(
        (${table.dedupeStrategy} = 'overlap-group' and ${table.dedupeGroupKey} is not null and length(trim(${table.dedupeGroupKey})) between 1 and 512) or
        (${table.dedupeStrategy} in ('exact-fact', 'unknown') and ${table.dedupeGroupKey} is null)
      )`,
    ),
  ],
)

// Saved policy only. Enforcement, alerting, precedence, and reset scheduling
// belong to later S4-F7 tasks.
export const usageBudgets = sqliteTable(
  "usage_budgets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    scopeType: text("scope_type").notNull(),
    providerId: text("provider_id"),
    accountTag: text("account_tag"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    automationId: text("automation_id").references(() => automations.id, { onDelete: "cascade" }),
    orchestrationId: text("orchestration_id").references(() => taskOrchestrations.taskId, {
      onDelete: "cascade",
    }),
    thresholdType: text("threshold_type").notNull(),
    thresholdValue: integer("threshold_value").notNull(),
    action: text("action").notNull(),
    resetType: text("reset_type").notNull().default("none"),
    resetTimezone: text("reset_timezone"),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("usage_budgets_scope_idx").on(
      table.scopeType,
      table.providerId,
      table.accountTag,
      table.projectId,
      table.taskId,
      table.automationId,
      table.orchestrationId,
    ),
    index("usage_budgets_enabled_action_idx").on(table.enabled, table.action),
    check("usage_budgets_name_check", sql`length(trim(${table.name})) between 1 and 256`),
    check(
      "usage_budgets_scope_check",
      sql`(
        (${table.scopeType} = 'global' and ${table.providerId} is null and ${table.accountTag} is null and ${table.projectId} is null and ${table.taskId} is null and ${table.automationId} is null and ${table.orchestrationId} is null) or
        (${table.scopeType} = 'provider-account' and length(trim(${table.providerId})) between 1 and 200 and (${table.accountTag} is null or length(trim(${table.accountTag})) between 1 and 256) and ${table.projectId} is null and ${table.taskId} is null and ${table.automationId} is null and ${table.orchestrationId} is null) or
        (${table.scopeType} = 'project' and ${table.providerId} is null and ${table.accountTag} is null and ${table.projectId} is not null and ${table.taskId} is null and ${table.automationId} is null and ${table.orchestrationId} is null) or
        (${table.scopeType} = 'task' and ${table.providerId} is null and ${table.accountTag} is null and ${table.projectId} is null and ${table.taskId} is not null and ${table.automationId} is null and ${table.orchestrationId} is null) or
        (${table.scopeType} = 'automation' and ${table.providerId} is null and ${table.accountTag} is null and ${table.projectId} is null and ${table.taskId} is null and ${table.automationId} is not null and ${table.orchestrationId} is null) or
        (${table.scopeType} = 'orchestration' and ${table.providerId} is null and ${table.accountTag} is null and ${table.projectId} is null and ${table.taskId} is null and ${table.automationId} is null and ${table.orchestrationId} is not null)
      )`,
    ),
    check(
      "usage_budgets_threshold_check",
      sql`(
        (${table.thresholdType} in ('cost-usd-micros', 'total-tokens', 'request-count') and ${table.thresholdValue} > 0) or
        (${table.thresholdType} = 'quota-percent-micros' and ${table.thresholdValue} between 1 and 100000000 and ${table.scopeType} = 'provider-account')
      )`,
    ),
    check(
      "usage_budgets_action_check",
      sql`${table.action} = 'soft-alert' or (${table.action} = 'hard-stop' and ${table.scopeType} != 'provider-account')`,
    ),
    check(
      "usage_budgets_reset_check",
      sql`(
        (${table.resetType} = 'none' and ${table.resetTimezone} is null) or
        (${table.resetType} in ('daily', 'weekly', 'monthly') and ${table.resetTimezone} is not null and length(trim(${table.resetTimezone})) between 1 and 200) or
        (${table.resetType} = 'provider-cycle' and ${table.resetTimezone} is null and ${table.scopeType} = 'provider-account')
      )`,
    ),
    check("usage_budgets_version_check", sql`${table.version} >= 1`),
  ],
)

// Retry state for provider generation reconciliation. Kept separate from
// samples so unavailable ids can become terminal without mutating usage facts.
export const usageGenerationReconciliation = sqliteTable(
  "usage_generation_reconciliation",
  {
    providerId: text("provider_id").notNull(),
    generationId: text("generation_id").notNull(),
    state: text("state").notNull().default("pending"), // pending | retry | unavailable | resolved
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    detail: text("detail"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.generationId] }),
    index("usage_generation_reconcile_state_idx").on(
      table.providerId,
      table.state,
      table.nextAttemptAt,
    ),
  ],
)

// Aggregated billing/reset cycles per provider (rolled up from samples or
// provider cost APIs). Kept separate so historical cycles survive sample pruning.
export const usageCycles = sqliteTable(
  "usage_cycles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    providerId: text("provider_id").notNull(),
    accountTag: text("account_tag").notNull().default(""),
    cycleStart: integer("cycle_start", { mode: "timestamp" }),
    cycleEnd: integer("cycle_end", { mode: "timestamp" }),
    resetAt: integer("reset_at", { mode: "timestamp" }),
    totalCostUsd: integer("total_cost_usd_micros"),
    totalCostUsdEstimated: integer("total_cost_usd_estimated_micros"),
    totalTokens: integer("total_tokens"),
    costQuality: text("cost_quality").notNull().default("unknown"),
    rawPayload: text("raw_payload"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("usage_cycles_provider_idx").on(table.providerId),
    uniqueIndex("usage_cycles_dedupe_key_idx").on(table.dedupeKey),
  ],
)

// Current health/status of each provider (+ account). One row per provider/account.
export const usageProviderStates = sqliteTable(
  "usage_provider_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    providerId: text("provider_id").notNull(),
    accountTag: text("account_tag").notNull().default(""),
    // "not-configured" | "ok" | "auth-failed" | "rate-limited" | "source-unavailable"
    // | "run-usage-only" | "estimate-only" | "not-installed" | "not-logged-in"
    status: text("status").notNull().default("not-configured"),
    statusDetail: text("status_detail"),
    configured: integer("configured", { mode: "boolean" }).notNull().default(false),
    supportsDaemon: integer("supports_daemon", { mode: "boolean" }).notNull().default(false),
    supportsHistorical: integer("supports_historical", { mode: "boolean" })
      .notNull()
      .default(false),
    lastPollAt: integer("last_poll_at", { mode: "timestamp" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastErrorAt: integer("last_error_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("usage_provider_states_key_idx").on(table.providerId, table.accountTag)],
)

// Alert events raised by the threshold evaluator + Discord webhook delivery log.
export const usageAlertEvents = sqliteTable(
  "usage_alert_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    providerId: text("provider_id").notNull(),
    accountTag: text("account_tag").notNull().default(""),
    // "quota-percent" | "quota-reset" | "throttle-risk" | "api-dollar-budget"
    // | "api-spend-rate" | "api-spend-spike" | "estimated-spend"
    alertType: text("alert_type").notNull(),
    // Micro-units: USD values use micro-dollars; ratios/multipliers use 1e6.
    thresholdValue: integer("threshold_value"),
    observedValue: integer("observed_value"),
    costQuality: text("cost_quality").notNull().default("unknown"),
    channel: text("channel").notNull().default("discord"),
    // "pending" | "sent" | "failed"
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryError: text("delivery_error"), // never contains the webhook URL
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("usage_alert_events_provider_idx").on(table.providerId),
    index("usage_alert_events_created_at_idx").on(table.createdAt),
  ],
)

// Debounce/re-arm state for alerts so an alert fires once until usage resets.
export const usageAlertArmStates = sqliteTable(
  "usage_alert_arm_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    providerId: text("provider_id").notNull(),
    // Empty string is the canonical default account tag. SQLite unique indexes
    // treat NULL values as distinct, which would otherwise allow duplicate
    // provider/account/threshold arm rows for the default account.
    accountTag: text("account_tag").notNull().default(""),
    alertType: text("alert_type").notNull(),
    // Same micro-unit convention as usage_alert_events. Converted back to the
    // evaluator's decimal number at the store boundary.
    thresholdValue: integer("threshold_value"),
    armed: integer("armed", { mode: "boolean" }).notNull().default(true),
    lastFiredAt: integer("last_fired_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("usage_alert_arm_states_key_idx").on(
      table.providerId,
      table.accountTag,
      table.alertType,
      table.thresholdValue,
    ),
  ],
)

// Background daemon heartbeat/status. Singleton row keyed by host.
export const usageDaemonStatus = sqliteTable("usage_daemon_status", {
  id: text("id").primaryKey().default("singleton"),
  host: text("host"),
  pid: integer("pid"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  running: integer("running", { mode: "boolean" }).notNull().default(false),
  cadenceSeconds: integer("cadence_seconds").notNull().default(300),
  startedAt: integer("started_at", { mode: "timestamp" }),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp" }),
  lastPollAt: integer("last_poll_at", { mode: "timestamp" }),
  lastAlertAt: integer("last_alert_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type SubChat = typeof subChats.$inferSelect
export type NewSubChat = typeof subChats.$inferInsert
export type AgentRun = typeof agentRuns.$inferSelect
export type NewAgentRun = typeof agentRuns.$inferInsert
export type Automation = typeof automations.$inferSelect
export type NewAutomation = typeof automations.$inferInsert
export type AutomationTrigger = typeof automationTriggers.$inferSelect
export type NewAutomationTrigger = typeof automationTriggers.$inferInsert
export type AutomationOccurrence = typeof automationOccurrences.$inferSelect
export type NewAutomationOccurrence = typeof automationOccurrences.$inferInsert
export type AutomationExecution = typeof automationExecutions.$inferSelect
export type NewAutomationExecution = typeof automationExecutions.$inferInsert
export type AutomationLease = typeof automationLeases.$inferSelect
export type NewAutomationLease = typeof automationLeases.$inferInsert
export type AutomationRetryPolicy = typeof automationRetryPolicies.$inferSelect
export type NewAutomationRetryPolicy = typeof automationRetryPolicies.$inferInsert
export type AutomationBudget = typeof automationBudgets.$inferSelect
export type NewAutomationBudget = typeof automationBudgets.$inferInsert
export type AutomationInboxItem = typeof automationInboxItems.$inferSelect
export type NewAutomationInboxItem = typeof automationInboxItems.$inferInsert
export type Checkpoint = typeof checkpoints.$inferSelect
export type NewCheckpoint = typeof checkpoints.$inferInsert
export type FileChangeManifest = typeof fileChangeManifests.$inferSelect
export type NewFileChangeManifest = typeof fileChangeManifests.$inferInsert
export type Attachment = typeof attachments.$inferSelect
export type NewAttachment = typeof attachments.$inferInsert
export type VoiceArtifact = typeof voiceArtifacts.$inferSelect
export type NewVoiceArtifact = typeof voiceArtifacts.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert
export type AnthropicSettings = typeof anthropicSettings.$inferSelect
export type UsageSample = typeof usageSamples.$inferSelect
export type NewUsageSample = typeof usageSamples.$inferInsert
export type UsageBudget = typeof usageBudgets.$inferSelect
export type NewUsageBudget = typeof usageBudgets.$inferInsert
export type UsageCycle = typeof usageCycles.$inferSelect
export type NewUsageCycle = typeof usageCycles.$inferInsert
export type UsageProviderState = typeof usageProviderStates.$inferSelect
export type NewUsageProviderState = typeof usageProviderStates.$inferInsert
export type UsageAlertEvent = typeof usageAlertEvents.$inferSelect
export type NewUsageAlertEvent = typeof usageAlertEvents.$inferInsert
export type UsageAlertArmState = typeof usageAlertArmStates.$inferSelect
export type NewUsageAlertArmState = typeof usageAlertArmStates.$inferInsert
export type UsageDaemonStatus = typeof usageDaemonStatus.$inferSelect
export type NewUsageDaemonStatus = typeof usageDaemonStatus.$inferInsert
