import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"
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
  pinnedAt: integer("pinned_at", { mode: "timestamp" }),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
  tasks: many(tasks),
}))

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
    status: text("status").notNull().default("active"),
    defaultPermissionMode: text("default_permission_mode").notNull().default("ask-before-edits"),
    primaryWorktreePath: text("primary_worktree_path"),
    primaryBranch: text("primary_branch"),
    pinnedAt: integer("pinned_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("tasks_project_id_idx").on(table.projectId)],
)

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  chats: many(chats),
  attachments: many(attachments),
}))

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
    harness: text("harness"),
    model: text("model"),
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
    worktreePath: text("worktree_path"),
    promptMessageId: text("prompt_message_id"),
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
}))

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
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    subChatId: text("sub_chat_id").references(() => subChats.id, { onDelete: "set null" }),
    messageId: text("message_id"),
    kind: text("kind").notNull(), // transcription | speech
    text: text("text").notNull(),
    adapterId: text("adapter_id").notNull(),
    audioPath: text("audio_path"),
    mimeType: text("mime_type"),
    byteLength: integer("byte_length").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    lastPlayedAt: integer("last_played_at", { mode: "timestamp" }),
  },
  (table) => [
    index("voice_artifacts_chat_created_idx").on(table.chatId, table.createdAt),
    index("voice_artifacts_message_idx").on(table.messageId),
    index("voice_artifacts_kind_created_idx").on(table.kind, table.createdAt),
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
