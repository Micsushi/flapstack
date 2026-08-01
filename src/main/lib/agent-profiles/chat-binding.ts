import type Database from "better-sqlite3"
import { resolve } from "node:path"
import {
  AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES,
  agentProfileLaunchPolicySchema,
  agentProfileVersionRefSchema,
  type AgentProfileLaunchPolicy,
  type AgentProfileVersionRef,
  type ResolvedAgentProfileSnapshot,
  type StoredResolvedAgentProfileSnapshot,
} from "../../../shared/agent-profiles"
import {
  type AgentRuntimePreference,
  runtimeAdapterForPreference,
} from "../../../shared/agent-runtime"
import { agentProfileSpeedCompatibility } from "../../../shared/agent-profile-speed"
import { customPermissionCapabilitiesSchema } from "../../../shared/permission-capabilities"
import {
  AgentProfileResolver,
  frozenAgentProfileRuntimeResolution,
  intersectAgentProfilePermissions,
  resolvedAgentProfileInstructions,
  type AgentProfileRuntimeResolution,
} from "./resolver"
import { createAgentProfileService } from "./service"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | { $client: Sqlite }

type ChatPolicyRow = {
  chat_id: string
  scope: "global" | "project" | "task"
  project_id: string | null
  task_id: string | null
  permission_mode: string
  custom_permissions: string | null
  runtime_preference: string | null
  project_permission_mode: string | null
  project_custom_permissions: string | null
  task_permission_mode: string | null
  task_custom_permissions: string | null
  project_path: string | null
  chat_worktree_path: string | null
  chat_branch: string | null
  task_primary_worktree_path: string | null
  task_primary_branch: string | null
}

export class AgentProfileChatBindingError extends Error {
  constructor(
    readonly code:
      | "chat-missing"
      | "chat-started"
      | "profile-missing"
      | "profile-archived"
      | "profile-incompatible"
      | "launch-blocked"
      | "run-conflict",
    message: string,
  ) {
    super(message)
    this.name = "AgentProfileChatBindingError"
  }
}

export class AgentProfileChatBindingService {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = "$client" in database ? database.$client : database
  }

  searchForChat(chatId: string, query = "") {
    const chat = this.requireChat(chatId)
    return createAgentProfileService(this.sqlite)
      .list({ projectId: chat.project_id ?? undefined, query, includeArchived: false })
      .filter((profile) => this.isScopeCompatible(chat, profile.scope))
      .map((profile) => ({
        profile: { profileId: profile.id, version: profile.currentVersion },
        name: profile.name,
        description: profile.description,
        category: profile.category,
        scope: profile.scope,
      }))
  }

  searchForNewChat(input: {
    scope: "global" | "project" | "task"
    projectId?: string
    taskId?: string
    query?: string
  }) {
    const chat = this.newChatPolicyRow({
      ...input,
      permissionMode: "read-only",
      runtimePreference: "auto",
    })
    return createAgentProfileService(this.sqlite)
      .list({
        projectId: chat.project_id ?? undefined,
        query: input.query ?? "",
        includeArchived: false,
      })
      .filter((profile) => this.isScopeCompatible(chat, profile.scope))
      .map((profile) => ({
        profile: { profileId: profile.id, version: profile.currentVersion },
        name: profile.name,
        description: profile.description,
        category: profile.category,
        scope: profile.scope,
      }))
  }

  previewForNewChat(input: {
    scope: "global" | "project" | "task"
    projectId?: string
    taskId?: string
    permissionMode: string
    runtimePreference: AgentRuntimePreference
    profile: AgentProfileVersionRef
  }) {
    const chat = this.newChatPolicyRow(input)
    const profile = agentProfileVersionRefSchema.parse(input.profile)
    this.assertProfileAvailable(chat, profile)
    const policy = this.currentPolicy(chat)
    const preview = new AgentProfileResolver(this.sqlite).preview(
      { profile, overrides: null, policy },
      "launch",
      this.currentRuntimeResolution(chat, profile),
    )
    if (preview.capability.worktreeStrategy === "task-primary" && !chat.task_id) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        "The Agent Profile requires a task-primary worktree. Create this Chat from a task.",
      )
    }
    return preview
  }

  preview(input: { chatId: string; profile: AgentProfileVersionRef }) {
    const chat = this.requireChat(input.chatId)
    const profile = agentProfileVersionRefSchema.parse(input.profile)
    this.assertProfileAvailable(chat, profile)
    const policy = this.currentPolicy(chat)
    const resolver = new AgentProfileResolver(this.sqlite)
    const draft = resolver.preview(
      { profile, overrides: null, policy },
      "launch",
      this.currentRuntimeResolution(chat, profile),
    )
    this.assertLaunchable(draft)
    this.assertWorktreeStrategy(draft, chat)
    return draft
  }

  bind(input: { chatId: string; profile: AgentProfileVersionRef; expectedDigest?: string }) {
    const chat = this.requireChat(input.chatId)
    const profile = agentProfileVersionRefSchema.parse(input.profile)
    this.assertProfileAvailable(chat, profile)
    if (this.hasStarted(input.chatId)) {
      throw new AgentProfileChatBindingError(
        "chat-started",
        "A started Chat cannot change Agent Profile. Start a new Chat to use another profile.",
      )
    }

    const policy = this.currentPolicy(chat)
    const resolver = new AgentProfileResolver(this.sqlite)
    const runtimeResolution = this.currentRuntimeResolution(chat, profile)
    const draft = resolver.preview(
      { profile, overrides: null, policy },
      "launch",
      runtimeResolution,
    )
    this.assertLaunchable(draft)
    if (input.expectedDigest && draft.digest !== input.expectedDigest) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        "Agent Profile preview changed before it could be bound. Review the exact version again.",
      )
    }
    const snapshot = resolver.snapshot(profile, null, policy, "launch", runtimeResolution)
    this.assertLaunchable(snapshot)
    const now = epoch()
    this.sqlite
      .transaction(() => {
        if (this.hasStarted(input.chatId)) {
          throw new AgentProfileChatBindingError(
            "chat-started",
            "A started Chat cannot change Agent Profile. Start a new Chat to use another profile.",
          )
        }
        this.sqlite
          .prepare(
            `INSERT INTO agent_profile_chat_bindings
             (chat_id, profile_id, profile_version, snapshot_id, bound_at, frozen_at)
             VALUES (?, ?, ?, ?, ?, NULL)
             ON CONFLICT(chat_id) DO UPDATE SET
               profile_id = excluded.profile_id,
               profile_version = excluded.profile_version,
               snapshot_id = excluded.snapshot_id,
               bound_at = excluded.bound_at,
               frozen_at = NULL`,
          )
          .run(
            input.chatId,
            snapshot.profile.profileId,
            snapshot.profile.version,
            snapshot.snapshotId,
            now,
          )
        this.sqlite
          .prepare(
            `UPDATE chats SET
               harness = ?, model = ?, runtime_preference = ?,
               permission_mode = ?, custom_permissions = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            snapshot.capability.harness,
            snapshot.capability.modelPreference,
            snapshot.runtimeResolution.preference,
            snapshot.capability.permissionMode,
            snapshot.capability.customPermissions
              ? JSON.stringify(snapshot.capability.customPermissions)
              : null,
            now,
            input.chatId,
          )
      })
      .immediate()
    return snapshot
  }

  get(chatId: string): {
    snapshot: StoredResolvedAgentProfileSnapshot
    frozen: boolean
    available: boolean
    invalidReason: string | null
  } | null {
    this.requireChat(chatId)
    const row = this.sqlite
      .prepare(
        `SELECT s.resolved_json, b.frozen_at, p.archived_at
         FROM agent_profile_chat_bindings b
         LEFT JOIN agent_profile_snapshots s ON s.id = b.snapshot_id
         LEFT JOIN agent_profiles p ON p.id = b.profile_id
         WHERE b.chat_id = ?`,
      )
      .get(chatId) as
      | {
          resolved_json: string | null
          frozen_at: number | null
          archived_at: number | null
        }
      | undefined
    if (!row) return null
    if (!row.resolved_json) {
      throw new AgentProfileChatBindingError(
        "profile-missing",
        "The Chat Agent Profile snapshot is missing.",
      )
    }
    const frozen = row.frozen_at !== null
    const archivedWhileIdle = !frozen && row.archived_at !== null
    return {
      snapshot: JSON.parse(row.resolved_json) as StoredResolvedAgentProfileSnapshot,
      frozen,
      available: !archivedWhileIdle,
      invalidReason: archivedWhileIdle
        ? "The selected Agent Profile is archived. Choose an active exact version."
        : null,
    }
  }

  clear(chatId: string) {
    this.requireChat(chatId)
    if (this.hasStarted(chatId)) {
      throw new AgentProfileChatBindingError(
        "chat-started",
        "A started Chat cannot clear Agent Profile provenance.",
      )
    }
    this.sqlite.prepare("DELETE FROM agent_profile_chat_bindings WHERE chat_id = ?").run(chatId)
    return { cleared: true as const }
  }

  materializeForRun(input: { chatId: string; runId: string; expectedHarness?: string }) {
    const chat = this.requireChat(input.chatId)
    if (!input.runId.trim() || input.runId.length > 512) {
      throw new AgentProfileChatBindingError("run-conflict", "Run identity is invalid.")
    }
    const existing = this.sqlite
      .prepare(
        `SELECT b.chat_id, s.resolved_json
         FROM agent_profile_run_bindings b
         LEFT JOIN agent_profile_snapshots s ON s.id = b.snapshot_id
         WHERE b.run_id = ?`,
      )
      .get(input.runId) as { chat_id: string; resolved_json: string | null } | undefined
    if (existing) {
      if (existing.chat_id !== input.chatId) {
        throw new AgentProfileChatBindingError(
          "run-conflict",
          "This run identity already belongs to another Chat.",
        )
      }
      if (!existing.resolved_json) {
        throw new AgentProfileChatBindingError(
          "profile-missing",
          "The run Agent Profile snapshot is missing.",
        )
      }
      const materialized = launchMaterialization(
        JSON.parse(existing.resolved_json) as StoredResolvedAgentProfileSnapshot,
      )
      assertExpectedHarness(materialized, input.expectedHarness)
      return materialized
    }

    const binding = this.sqlite
      .prepare(
        `SELECT b.profile_id, b.profile_version, b.snapshot_id, s.resolved_json,
                p.archived_at
         FROM agent_profile_chat_bindings b
         LEFT JOIN agent_profile_snapshots s ON s.id = b.snapshot_id
         LEFT JOIN agent_profiles p ON p.id = b.profile_id
         WHERE b.chat_id = ?`,
      )
      .get(input.chatId) as
      | {
          profile_id: string
          profile_version: number
          snapshot_id: string
          resolved_json: string | null
          archived_at: number | null
        }
      | undefined
    if (!binding) return null
    if (binding.archived_at !== null) {
      throw new AgentProfileChatBindingError(
        "profile-archived",
        "The selected Agent Profile is archived. Choose an active exact version.",
      )
    }
    if (!binding.resolved_json) {
      throw new AgentProfileChatBindingError(
        "profile-missing",
        "The Chat Agent Profile snapshot is missing.",
      )
    }
    const snapshot = JSON.parse(binding.resolved_json) as StoredResolvedAgentProfileSnapshot
    this.assertLaunchable(snapshot)
    this.assertSnapshotStillWithinPolicy(snapshot, this.currentPolicy(chat))
    this.assertWorktreeStrategy(snapshot, chat)
    const materialized = launchMaterialization(snapshot)
    assertExpectedHarness(materialized, input.expectedHarness)
    const now = epoch()
    this.sqlite
      .transaction(() => {
        const raced = this.sqlite
          .prepare("SELECT chat_id, snapshot_id FROM agent_profile_run_bindings WHERE run_id = ?")
          .get(input.runId) as { chat_id: string; snapshot_id: string } | undefined
        if (raced) {
          if (raced.chat_id !== input.chatId || raced.snapshot_id !== binding.snapshot_id) {
            throw new AgentProfileChatBindingError(
              "run-conflict",
              "This run identity already belongs to different frozen profile input.",
            )
          }
          return
        }
        this.sqlite
          .prepare(
            `INSERT INTO agent_profile_run_bindings (run_id, chat_id, snapshot_id, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(input.runId, input.chatId, binding.snapshot_id, now)
        this.sqlite
          .prepare(
            `UPDATE agent_profile_chat_bindings
             SET frozen_at = COALESCE(frozen_at, ?)
             WHERE chat_id = ? AND snapshot_id = ?`,
          )
          .run(now, input.chatId, binding.snapshot_id)
      })
      .immediate()
    return materialized
  }

  private requireChat(chatId: string): ChatPolicyRow {
    const row = this.sqlite
      .prepare(
        `SELECT c.id chat_id, c.scope, c.project_id, c.task_id, c.permission_mode,
                c.custom_permissions, c.runtime_preference,
                c.worktree_path chat_worktree_path, c.branch chat_branch,
                p.path project_path,
                p.default_permission_mode project_permission_mode,
                p.default_custom_permissions project_custom_permissions,
                t.default_permission_mode task_permission_mode,
                t.default_custom_permissions task_custom_permissions,
                t.primary_worktree_path task_primary_worktree_path,
                t.primary_branch task_primary_branch
         FROM chats c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN tasks t ON t.id = c.task_id
         WHERE c.id = ?`,
      )
      .get(chatId) as ChatPolicyRow | undefined
    if (!row) throw new AgentProfileChatBindingError("chat-missing", "Chat not found.")
    return row
  }

  private newChatPolicyRow(input: {
    scope: "global" | "project" | "task"
    projectId?: string
    taskId?: string
    permissionMode: string
    runtimePreference: AgentRuntimePreference
  }): ChatPolicyRow {
    if (input.scope === "global") {
      if (input.projectId || input.taskId) {
        throw new AgentProfileChatBindingError(
          "profile-incompatible",
          "Global Chat profile preview cannot carry project or task identity.",
        )
      }
      return {
        chat_id: "new-chat-preview",
        scope: "global",
        project_id: null,
        task_id: null,
        permission_mode: input.permissionMode,
        custom_permissions: null,
        runtime_preference: input.runtimePreference,
        project_permission_mode: null,
        project_custom_permissions: null,
        task_permission_mode: null,
        task_custom_permissions: null,
        project_path: null,
        chat_worktree_path: null,
        chat_branch: null,
        task_primary_worktree_path: null,
        task_primary_branch: null,
      }
    }
    const project = input.projectId
      ? (this.sqlite
          .prepare(
            `SELECT id, path, default_permission_mode, default_custom_permissions
             FROM projects WHERE id = ? AND archived_at IS NULL`,
          )
          .get(input.projectId) as
          | {
              id: string
              path: string
              default_permission_mode: string
              default_custom_permissions: string | null
            }
          | undefined)
      : undefined
    if (!project) {
      throw new AgentProfileChatBindingError(
        "profile-incompatible",
        "Project Chat profile preview requires an active project.",
      )
    }
    let task:
      | {
          id: string
          project_id: string
          default_permission_mode: string
          default_custom_permissions: string | null
          primary_worktree_path: string | null
          primary_branch: string | null
        }
      | undefined
    if (input.scope === "task") {
      task = input.taskId
        ? (this.sqlite
            .prepare(
              `SELECT id, project_id, default_permission_mode, default_custom_permissions,
                      primary_worktree_path, primary_branch
               FROM tasks WHERE id = ? AND archived_at IS NULL`,
            )
            .get(input.taskId) as typeof task)
        : undefined
      if (!task || task.project_id !== project.id) {
        throw new AgentProfileChatBindingError(
          "profile-incompatible",
          "Task Chat profile preview requires a task in the selected project.",
        )
      }
    } else if (input.taskId) {
      throw new AgentProfileChatBindingError(
        "profile-incompatible",
        "Project Chat profile preview cannot carry task identity.",
      )
    }
    return {
      chat_id: "new-chat-preview",
      scope: input.scope,
      project_id: project.id,
      task_id: task?.id ?? null,
      permission_mode: input.permissionMode,
      custom_permissions: null,
      runtime_preference: input.runtimePreference,
      project_permission_mode: project.default_permission_mode,
      project_custom_permissions: project.default_custom_permissions,
      task_permission_mode: task?.default_permission_mode ?? null,
      task_custom_permissions: task?.default_custom_permissions ?? null,
      project_path: project.path,
      chat_worktree_path: null,
      chat_branch: null,
      task_primary_worktree_path: task?.primary_worktree_path ?? null,
      task_primary_branch: task?.primary_branch ?? null,
    }
  }

  private assertProfileAvailable(chat: ChatPolicyRow, ref: AgentProfileVersionRef) {
    const row = this.sqlite
      .prepare(
        `SELECT p.scope_type, p.project_id, p.archived_at
         FROM agent_profiles p
         JOIN agent_profile_versions v ON v.profile_id = p.id
         WHERE p.id = ? AND v.version = ?`,
      )
      .get(ref.profileId, ref.version) as
      | {
          scope_type: "built-in" | "user" | "project"
          project_id: string | null
          archived_at: number | null
        }
      | undefined
    if (!row) {
      throw new AgentProfileChatBindingError(
        "profile-missing",
        "The exact Agent Profile version is missing.",
      )
    }
    if (row.archived_at !== null) {
      throw new AgentProfileChatBindingError(
        "profile-archived",
        "The selected Agent Profile is archived.",
      )
    }
    if (
      !this.isScopeCompatible(chat, {
        type: row.scope_type,
        projectId: row.project_id,
      } as Parameters<AgentProfileChatBindingService["isScopeCompatible"]>[1])
    ) {
      throw new AgentProfileChatBindingError(
        "profile-incompatible",
        "The selected Agent Profile does not belong to this Chat project.",
      )
    }
  }

  private isScopeCompatible(
    chat: ChatPolicyRow,
    scope:
      | { type: "built-in"; projectId: null }
      | { type: "user"; projectId: null }
      | { type: "project"; projectId: string },
  ) {
    return (
      scope.type !== "project" || (chat.project_id !== null && scope.projectId === chat.project_id)
    )
  }

  private currentPolicy(chat: ChatPolicyRow): AgentProfileLaunchPolicy {
    let permission = parsePermission(
      chat.project_permission_mode ?? chat.permission_mode,
      chat.project_custom_permissions,
    )
    if (chat.task_id) {
      const task = parsePermission(
        chat.task_permission_mode ?? "read-only",
        chat.task_custom_permissions,
      )
      permission = intersectAgentProfilePermissions(
        permission.mode,
        permission.custom,
        task.mode,
        task.custom,
      )
    }
    const chatPermission = parsePermission(chat.permission_mode, chat.custom_permissions)
    permission = intersectAgentProfilePermissions(
      permission.mode,
      permission.custom,
      chatPermission.mode,
      chatPermission.custom,
    )
    return agentProfileLaunchPolicySchema.parse({
      permissionMode: permission.mode,
      customPermissions: permission.custom,
      allowedTools: null,
      allowedSkills: null,
      allowedModels: null,
      allowedRuntimes: null,
      maxDescendants: 64,
    })
  }

  private currentRuntimeResolution(
    chat: ChatPolicyRow,
    ref: AgentProfileVersionRef,
  ): AgentProfileRuntimeResolution | undefined {
    const item = createAgentProfileService(this.sqlite).get(ref)
    if (item.version.definition.capability.runtimePreference !== "auto") return undefined
    if (chat.runtime_preference && chat.runtime_preference !== "auto") {
      return runtimeResolution(chat.runtime_preference as AgentRuntimePreference, "chat", null)
    }
    const row = this.sqlite
      .prepare(
        `SELECT scope_type, preference, version
         FROM agent_runtime_defaults
         WHERE harness = ? AND preference <> 'auto' AND (
           (scope_type = 'project' AND scope_id = ?) OR scope_type = 'global'
         )
         ORDER BY CASE scope_type WHEN 'project' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(item.version.definition.capability.harness, chat.project_id) as
      | { scope_type: "project" | "global"; preference: AgentRuntimePreference; version: number }
      | undefined
    if (row) return runtimeResolution(row.preference, row.scope_type, row.version)
    const harness = item.version.definition.capability.harness
    return runtimeResolution(
      harness === "codex"
        ? "codex"
        : harness === "claude-code"
          ? "claude-code"
          : "flapstack-native",
      "product",
      null,
    )
  }

  private assertLaunchable(snapshot: StoredResolvedAgentProfileSnapshot) {
    const blocker = snapshot.conflicts.find((conflict) =>
      (AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES as readonly string[]).includes(conflict.code),
    )
    if (blocker) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        `${blocker.message} ${blocker.repair}`,
      )
    }
    if (snapshot.unresolvedRequirements.length) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        `Agent Profile has unresolved requirements: ${snapshot.unresolvedRequirements
          .map((item) => item.id)
          .join(", ")}.`,
      )
    }
  }

  private assertSnapshotStillWithinPolicy(
    snapshot: StoredResolvedAgentProfileSnapshot,
    policy: AgentProfileLaunchPolicy,
  ) {
    const permission = intersectAgentProfilePermissions(
      snapshot.capability.permissionMode,
      snapshot.capability.customPermissions,
      policy.permissionMode,
      policy.customPermissions,
    )
    if (
      permission.mode !== snapshot.capability.permissionMode ||
      JSON.stringify(permission.custom) !== JSON.stringify(snapshot.capability.customPermissions)
    ) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        "Chat permission policy became narrower than the frozen Agent Profile snapshot.",
      )
    }
  }

  private hasStarted(chatId: string) {
    return Boolean(
      this.sqlite
        .prepare(
          `SELECT 1 FROM agent_runs WHERE chat_id = ?
           UNION ALL
           SELECT 1 FROM agent_profile_run_bindings WHERE chat_id = ?
           LIMIT 1`,
        )
        .get(chatId, chatId),
    )
  }

  private assertWorktreeStrategy(
    snapshot: Pick<StoredResolvedAgentProfileSnapshot, "capability">,
    chat: ChatPolicyRow,
  ) {
    const strategy = snapshot.capability.worktreeStrategy
    if (strategy === "inherit") return
    if (strategy === "none") {
      if (
        chat.chat_worktree_path &&
        chat.project_path &&
        !samePath(chat.chat_worktree_path, chat.project_path)
      ) {
        throw new AgentProfileChatBindingError(
          "launch-blocked",
          "The Agent Profile requires no isolated worktree, but this Chat uses one.",
        )
      }
      return
    }
    if (strategy === "task-primary") {
      if (
        !chat.task_id ||
        !chat.task_primary_worktree_path ||
        !chat.chat_worktree_path ||
        !samePath(chat.chat_worktree_path, chat.task_primary_worktree_path)
      ) {
        throw new AgentProfileChatBindingError(
          "launch-blocked",
          "The Agent Profile requires the task-primary worktree, but this Chat is not attached to that exact checkout.",
        )
      }
      return
    }
    if (!chat.chat_worktree_path) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        "The Agent Profile requires an existing worktree, but this Chat has none.",
      )
    }
    if (strategy === "attached-branch" && !chat.chat_branch) {
      throw new AgentProfileChatBindingError(
        "launch-blocked",
        "The Agent Profile requires an attached branch, but this Chat has no branch.",
      )
    }
  }
}

function launchMaterialization(snapshot: StoredResolvedAgentProfileSnapshot) {
  const runtime = frozenAgentProfileRuntimeResolution(snapshot)
  const speed = agentProfileSpeedCompatibility(snapshot.capability, runtime)
  if (!speed.compatible) {
    throw new AgentProfileChatBindingError("launch-blocked", `${speed.message} ${speed.repair}`)
  }
  return {
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.digest,
    profile: structuredClone(snapshot.profile),
    displayName: snapshot.displayName,
    instructions: resolvedAgentProfileInstructions(snapshot),
    capability: structuredClone(snapshot.capability),
    presentation: structuredClone(snapshot.presentation),
    personality: structuredClone(snapshot.personality),
    launch: {
      harness: snapshot.capability.harness,
      model: snapshot.capability.modelPreference,
      runtimePreference: runtime.preference,
      resolvedRuntime: runtime.resolvedRuntime,
      permissionMode: snapshot.capability.permissionMode,
      customPermissions: structuredClone(snapshot.capability.customPermissions),
      reasoningEffort: snapshot.capability.reasoningEffort,
      speedPreference: snapshot.capability.speedPreference,
      serviceTier: speed.serviceTier,
      worktreeStrategy: snapshot.capability.worktreeStrategy,
      skills: [...snapshot.capability.skills],
      tools: [...snapshot.capability.tools],
    },
  }
}

function assertExpectedHarness(
  materialized: ReturnType<typeof launchMaterialization>,
  expectedHarness: string | undefined,
) {
  if (expectedHarness && materialized.launch.harness !== expectedHarness) {
    throw new AgentProfileChatBindingError(
      "launch-blocked",
      `The frozen Agent Profile requires ${materialized.launch.harness}; this launch selected ${expectedHarness}.`,
    )
  }
}

function parsePermission(mode: string, raw: string | null) {
  const parsedMode = [
    "read-only",
    "ask-before-edits",
    "auto-edit-project-only",
    "full-access",
    "custom",
  ].includes(mode)
    ? (mode as AgentProfileLaunchPolicy["permissionMode"])
    : "read-only"
  if (parsedMode !== "custom") return { mode: parsedMode, custom: null }
  try {
    return {
      mode: parsedMode,
      custom: customPermissionCapabilitiesSchema.parse(JSON.parse(raw ?? "{}")),
    }
  } catch {
    return { mode: "read-only" as const, custom: null }
  }
}

function runtimeResolution(
  preference: AgentRuntimePreference,
  source: AgentProfileRuntimeResolution["source"],
  defaultVersion: number | null,
): AgentProfileRuntimeResolution {
  const resolvedRuntime = runtimeAdapterForPreference(preference)
  if (!resolvedRuntime || preference === "auto") {
    throw new AgentProfileChatBindingError(
      "launch-blocked",
      "The effective Agent Profile Runtime is invalid.",
    )
  }
  return { preference, source, defaultVersion, resolvedRuntime }
}

function epoch() {
  return Math.floor(Date.now() / 1000)
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => {
    const normalized = resolve(value).replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
  }
  return normalize(left) === normalize(right)
}
