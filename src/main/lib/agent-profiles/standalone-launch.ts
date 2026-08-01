import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { formatVisiblePartForHandoff } from "../../../shared/chat-visible-content"
import {
  AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES,
  agentProfileLaunchPolicySchema,
  standaloneAgentLaunchInputSchema,
  type AgentProfileLaunchPolicy,
  type ResolvedAgentProfileSnapshot,
} from "../../../shared/agent-profiles"
import {
  resolvedLaunchFromSnapshotRow,
  runtimePermissionSnapshot,
  runtimeSnapshotColumns,
  runtimeSnapshotSqlValues,
} from "../agent-runtime/snapshot"
import { assertResolvedAgentRuntime } from "../agent-runtime/resolver"
import { agentProfileSpeedCompatibility } from "../../../shared/agent-profile-speed"
import {
  runtimeAdapterForPreference,
  type AgentRuntimePreference,
} from "../../../shared/agent-runtime"
import { productRuntimeForHarness } from "../agent-runtime/compatibility"
import type { QueuedAgentRun } from "../run-launch-service"
import { normalizeChatMode } from "../../../shared/chat-mode"
import { ensureOperationWorkspaceInTransaction } from "../saved-workspaces/operations"
import { isProductMcpEnabledByDefault } from "../mcp-control/exposure"
import {
  AgentProfileResolver,
  type AgentProfileRuntimeResolution,
  agentProfileSnapshotPolicyViolations,
  frozenAgentProfileRuntimeAuthority,
  intersectAgentProfilePermissions,
  resolvedAgentProfileInstructions,
} from "./resolver"
import { assertAgentProfileSecretFree } from "./service"
import {
  canonicalJson,
  epochSeconds as epoch,
  optionalString as stringOrNull,
  sha256Text,
} from "./values"

type Row = Record<string, unknown>

export class StandaloneAgentLaunchError extends Error {
  constructor(
    readonly code:
      | "source-missing"
      | "source-archived"
      | "preview-changed"
      | "launch-blocked"
      | "request-conflict"
      | "worktree-invalid"
      | "run-active",
    message: string,
  ) {
    super(message)
    this.name = "StandaloneAgentLaunchError"
  }
}

export class StandaloneAgentLaunchService {
  constructor(private readonly databasePath: string) {}

  preview(inputValue: unknown) {
    const input = standaloneAgentLaunchInputSchema.parse(inputValue)
    assertAgentProfileSecretFree(input.overrides)
    const db = this.open()
    try {
      const source = this.resolveSource(db, input.source)
      const resolver = new AgentProfileResolver(db)
      const draftPolicy = this.currentPolicy(db, source, input.orchestrationTaskId, null)
      const draft = resolver.preview({
        profile: input.profile,
        overrides: input.overrides,
        policy: draftPolicy,
      })
      const runtimeResolution = currentRuntimeResolution(db, source, draft.capability.harness)
      const launchPolicy = this.currentPolicy(
        db,
        source,
        input.orchestrationTaskId,
        draft.capability.harness,
      )
      return resolver.preview(
        {
          profile: input.profile,
          overrides: input.overrides,
          policy: launchPolicy,
        },
        "launch",
        runtimeResolution,
      )
    } finally {
      db.close()
    }
  }

  async launch(inputValue: unknown, dispatch = true) {
    const input = standaloneAgentLaunchInputSchema.parse(inputValue)
    assertAgentProfileSecretFree(input.overrides)
    const db = this.open()
    let queued: QueuedAgentRun
    let result: ReturnType<StandaloneAgentLaunchService["get"]>
    try {
      const existing = this.existingRequest(db, input)
      if (existing) return existing
      const source = this.resolveSource(db, input.source)
      const resolver = new AgentProfileResolver(db)
      const draft = resolver.preview({
        profile: input.profile,
        overrides: input.overrides,
        policy: this.currentPolicy(db, source, input.orchestrationTaskId, null),
      })
      const runtimeResolution = currentRuntimeResolution(db, source, draft.capability.harness)
      const launchPolicy = this.currentPolicy(
        db,
        source,
        input.orchestrationTaskId,
        draft.capability.harness,
      )
      const snapshot = resolver.snapshot(
        input.profile,
        input.overrides,
        launchPolicy,
        "launch",
        runtimeResolution,
      )
      if (snapshot.digest !== input.confirmedSnapshotDigest) {
        throw new StandaloneAgentLaunchError(
          "preview-changed",
          "Resolved Agent Profile changed after preview. Review and confirm the new digest.",
        )
      }
      assertLaunchable(snapshot)
      const ids = {
        launchId: randomUUID(),
        chatId: randomUUID(),
        subChatId: randomUUID(),
        runId: randomUUID(),
        orchestrationAgentId: input.orchestrationTaskId ? randomUUID() : null,
      }
      const context = buildContext(db, source, input.context)
      const prompt = profilePrompt(snapshot, context)
      const worktree = resolveWorktree(source, snapshot)
      const launchTaskId = input.orchestrationTaskId ?? source.taskId
      const now = epoch()
      db.transaction(() => {
        if (input.orchestrationTaskId) {
          this.assertOrchestrationMembership(db, input.orchestrationTaskId, source)
          ensureOperationWorkspaceInTransaction(db, input.orchestrationTaskId)
        }
        db.prepare(
          `INSERT INTO chats (
             id, name, project_id, task_id, scope, permission_mode, custom_permissions,
             mcp_exposure_enabled, harness, model, runtime_preference,
             parent_chat_id, initiator_chat_id, parent_run_id, ancestor_chat_ids,
             worktree_path, branch, base_branch, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          ids.chatId,
          snapshot.displayName,
          source.projectId,
          launchTaskId,
          launchTaskId ? "task" : "project",
          snapshot.capability.permissionMode,
          snapshot.capability.customPermissions
            ? JSON.stringify(snapshot.capability.customPermissions)
            : null,
          isProductMcpEnabledByDefault(snapshot.capability.harness) ? 1 : 0,
          snapshot.capability.harness,
          snapshot.capability.modelPreference,
          snapshot.capability.runtimePreference,
          source.parentChatId,
          source.initiatorChatId ?? ids.chatId,
          source.parentRunId,
          JSON.stringify(source.ancestorChatIds),
          worktree.path,
          worktree.branch,
          source.baseBranch,
          now,
          now,
        )
        // The profile can remain "auto" on the new chat, but this run must use
        // the effective Runtime confirmed in the preview. Re-resolving from
        // the new chat would lose an explicit source-chat preference.
        const speed = agentProfileSpeedCompatibility(
          snapshot.capability,
          snapshot.runtimeResolution,
        )
        if (!speed.compatible) {
          throw new StandaloneAgentLaunchError("launch-blocked", speed.message)
        }
        const runtimeSnapshot = runtimeSnapshotColumns(
          assertResolvedAgentRuntime({
            harness: snapshot.capability.harness,
            model: snapshot.capability.modelPreference,
            chatPreference: snapshot.runtimeResolution.preference,
            permission: runtimePermissionSnapshot(
              snapshot.capability.permissionMode,
              snapshot.capability.customPermissions,
            ),
            controls: {
              modelEffort: snapshot.capability.reasoningEffort,
              serviceTier: speed.serviceTier,
            },
          }),
        )
        if (runtimeSnapshot.resolvedRuntime !== snapshot.runtimeResolution.resolvedRuntime) {
          throw new StandaloneAgentLaunchError(
            "launch-blocked",
            "Confirmed Agent Profile Runtime no longer resolves to the reviewed adapter.",
          )
        }
        runtimeSnapshot.runtimePreferenceSource =
          snapshot.runtimeResolution.source === "profile"
            ? "chat"
            : snapshot.runtimeResolution.source
        db.prepare(
          `INSERT INTO sub_chats
           (id, chat_id, name, mode, harness, model, permission_mode, worktree_path,
            run_status, messages, created_at, updated_at)
           VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, 'pending', '[]', ?, ?)`,
        ).run(
          ids.subChatId,
          ids.chatId,
          snapshot.displayName,
          snapshot.capability.harness,
          snapshot.capability.modelPreference,
          snapshot.capability.permissionMode,
          worktree.path,
          now,
          now,
        )
        db.prepare(
          `INSERT INTO agent_runs (
             id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
             worktree_path, prompt_message_id, initial_prompt, runtime_snapshot_version,
             runtime_preference, runtime_preference_source, resolved_runtime,
             runtime_adapter_version, runtime_protocol_version,
             runtime_capability_snapshot, runtime_control_snapshot,
             status, started_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(
          ids.runId,
          ids.chatId,
          ids.subChatId,
          snapshot.capability.harness,
          snapshot.capability.modelPreference,
          snapshot.capability.permissionMode,
          snapshot.capability.customPermissions
            ? JSON.stringify(snapshot.capability.customPermissions)
            : null,
          worktree.path,
          `profile-launch-${ids.launchId}`,
          prompt,
          ...runtimeSnapshotSqlValues(runtimeSnapshot),
          now,
        )
        if (input.orchestrationTaskId && ids.orchestrationAgentId) {
          const definition = JSON.stringify({
            agentId: ids.orchestrationAgentId,
            definitionId: `profile-snapshot:${snapshot.snapshotId}`,
            role: snapshot.capability.role,
            name: snapshot.displayName,
            prompt: resolvedAgentProfileInstructions(snapshot),
            harness: snapshot.capability.harness,
            model: snapshot.capability.modelPreference ?? undefined,
            runtimePreference: snapshot.runtimeResolution.preference,
            reasoningEffort: snapshot.capability.reasoningEffort ?? undefined,
            speedPreference: snapshot.capability.speedPreference ?? undefined,
            profileRuntimeAuthority: frozenAgentProfileRuntimeAuthority(snapshot),
            permissionMode: snapshot.capability.permissionMode,
            customPermissions: snapshot.capability.customPermissions ?? undefined,
            worktreeStrategy: snapshot.capability.worktreeStrategy,
            dependencyAgentIds: [],
            completionCriteria: "Complete the standalone named-agent assignment.",
          })
          db.prepare(
            `INSERT INTO orchestration_agents
             (id, task_id, chat_id, run_id, parent_agent_id, replaced_agent_id,
              ancestor_agent_ids, depth, definition, dependency_agent_ids, status,
              progress_percent, input_tokens, output_tokens, reasoning_tokens, total_tokens,
              cost_quality, blocker_count, queued_at, started_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, NULL, '[]', 1, ?, '[]', 'active',
               0, 0, 0, 0, 0, 'unknown', 0, ?, ?, ?)`,
          ).run(
            ids.orchestrationAgentId,
            input.orchestrationTaskId,
            ids.chatId,
            ids.runId,
            definition,
            now,
            now,
            now,
          )
        }
        db.prepare(
          `INSERT INTO agent_profile_standalone_launches
           (id, request_id, request_fingerprint, source_kind, source_id, snapshot_id, chat_id, sub_chat_id,
            run_id, orchestration_task_id, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(
          ids.launchId,
          input.requestId,
          standaloneRequestFingerprint(input),
          input.source.kind,
          source.sourceId,
          snapshot.snapshotId,
          ids.chatId,
          ids.subChatId,
          ids.runId,
          input.orchestrationTaskId,
          now,
          now,
        )
        this.audit(db, snapshot.profile.profileId, "standalone-launched", {
          launchId: ids.launchId,
          snapshotId: snapshot.snapshotId,
          sourceKind: input.source.kind,
          orchestrationMembership: Boolean(input.orchestrationTaskId),
        })
      }).immediate()
      result = this.get(ids.launchId, db)
      queued = queuedRun(db, ids.runId)
    } catch (error) {
      if (isConstraintError(error)) {
        const raced = this.existingRequest(db, input)
        if (raced) return raced
      }
      throw error
    } finally {
      db.close()
    }
    if (!dispatch) return result
    return await this.dispatch(result.id, queued)
  }

  async followUp(
    launchId: string,
    requestId: string,
    prompt: string,
    dispatch = true,
    auditAction = "standalone-follow-up",
  ) {
    if (!prompt.trim() || prompt.length > 100_000) throw new Error("Follow-up prompt is required.")
    const db = this.open()
    let queued: QueuedAgentRun
    let result: ReturnType<StandaloneAgentLaunchService["get"]>
    try {
      const prior = this.get(launchId, db)
      const followUpFingerprint = requestFingerprint({
        kind: "follow-up",
        priorLaunchId: prior.id,
        sourceChatId: prior.chatId,
        snapshotId: prior.snapshotId,
        orchestrationTaskId: prior.orchestrationTaskId,
        prompt: prompt.trim(),
        auditAction,
      })
      const existing = db
        .prepare(
          "SELECT id, request_fingerprint FROM agent_profile_standalone_launches WHERE request_id = ?",
        )
        .get(requestId) as { id: string; request_fingerprint: string } | undefined
      if (existing) {
        const repeated = this.get(existing.id, db)
        if (existing.request_fingerprint !== followUpFingerprint) {
          throw new StandaloneAgentLaunchError(
            "request-conflict",
            "Standalone follow-up request ID was already used with different input.",
          )
        }
        return repeated
      }
      const source = this.resolveSource(db, { kind: "chat", chatId: prior.chatId })
      const snapshot = new AgentProfileResolver(db).getSnapshot(prior.snapshotId)
      const priorRun = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(prior.runId) as Row
      const violations = agentProfileSnapshotPolicyViolations(
        snapshot,
        this.currentPolicy(db, source, prior.orchestrationTaskId, snapshot.capability.harness),
        priorRun.runtime_preference as AgentRuntimePreference,
      )
      if (violations.length > 0) {
        throw new StandaloneAgentLaunchError(
          "launch-blocked",
          `Frozen Agent Profile snapshot exceeds current ${violations.join(", ")} policy. Continue with a newly confirmed profile snapshot.`,
        )
      }
      const id = randomUUID()
      const runId = randomUUID()
      const now = epoch()
      db.transaction(() => {
        const active = db
          .prepare(
            "SELECT id FROM agent_runs WHERE chat_id = ? AND status IN ('pending','running') LIMIT 1",
          )
          .get(prior.chatId)
        if (active) {
          throw new StandaloneAgentLaunchError(
            "run-active",
            "Named agent already has an active run.",
          )
        }
        db.prepare(
          `INSERT INTO agent_runs (
             id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
             worktree_path, prompt_message_id, initial_prompt, runtime_snapshot_version,
             runtime_preference, runtime_preference_source, resolved_runtime,
             runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
             runtime_control_snapshot, status, started_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(
          runId,
          prior.chatId,
          prior.subChatId,
          priorRun.harness,
          priorRun.model,
          priorRun.permission_mode,
          priorRun.custom_permissions,
          priorRun.worktree_path,
          `profile-follow-up-${id}`,
          prompt.trim(),
          priorRun.runtime_snapshot_version,
          priorRun.runtime_preference,
          priorRun.runtime_preference_source,
          priorRun.resolved_runtime,
          priorRun.runtime_adapter_version,
          priorRun.runtime_protocol_version,
          priorRun.runtime_capability_snapshot,
          priorRun.runtime_control_snapshot,
          now,
        )
        if (prior.orchestrationTaskId) {
          db.prepare(
            `UPDATE orchestration_agents
             SET run_id = ?, status = 'active', updated_at = ?
             WHERE task_id = ? AND chat_id = ?`,
          ).run(runId, now, prior.orchestrationTaskId, prior.chatId)
        }
        db.prepare("UPDATE sub_chats SET run_status = 'pending', updated_at = ? WHERE id = ?").run(
          now,
          prior.subChatId,
        )
        db.prepare(
          `INSERT INTO agent_profile_standalone_launches
           (id, request_id, request_fingerprint, source_kind, source_id, snapshot_id, chat_id, sub_chat_id,
            run_id, orchestration_task_id, state, created_at, updated_at)
           VALUES (?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(
          id,
          requestId,
          followUpFingerprint,
          prior.chatId,
          prior.snapshotId,
          prior.chatId,
          prior.subChatId,
          runId,
          prior.orchestrationTaskId,
          now,
          now,
        )
        this.audit(db, prior.profile.profileId, auditAction, {
          launchId: id,
          previousLaunchId: prior.id,
          snapshotId: prior.snapshotId,
          runId,
        })
      }).immediate()
      result = this.get(id, db)
      queued = queuedRun(db, runId)
    } finally {
      db.close()
    }
    if (!dispatch) return result
    return await this.dispatch(result.id, queued)
  }

  async retry(launchId: string, requestId: string, dispatch = true) {
    const prior = this.get(launchId)
    if (["pending", "running"].includes(prior.runStatus)) {
      throw new StandaloneAgentLaunchError("run-active", "Named agent already has an active run.")
    }
    const db = this.open()
    let prompt: string
    try {
      const run = db
        .prepare("SELECT initial_prompt FROM agent_runs WHERE id = ?")
        .get(prior.runId) as { initial_prompt: string }
      prompt = run.initial_prompt
    } finally {
      db.close()
    }
    return await this.followUp(launchId, requestId, prompt, dispatch, "standalone-retried")
  }

  async continueWithUpdatedProfile(launchId: string, inputValue: unknown, dispatch = true) {
    const prior = this.get(launchId)
    const input = standaloneAgentLaunchInputSchema.parse(inputValue)
    if (["pending", "running"].includes(prior.runStatus)) {
      throw new StandaloneAgentLaunchError(
        "run-active",
        "Stop the active named-agent run before continuing with an updated profile.",
      )
    }
    if (input.source.kind !== "chat" || input.source.chatId !== prior.chatId) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Continue with updated profile must start from the named agent's chat.",
      )
    }
    if (
      input.profile.profileId === prior.profile.profileId &&
      input.profile.version === prior.profile.version
    ) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Continue with updated profile requires a different profile or newer profile version.",
      )
    }
    return await this.launch(input, dispatch)
  }

  async stop(launchId: string, reason = "named-agent-stopped") {
    const launch = this.get(launchId)
    const runtime = await runtimeLaunchService(this.databasePath)
    await runtime.cancel(launch.runId, reason)
    await runtime.reconcileRun(launch.runId)
    const db = this.open()
    let state!: string
    try {
      db.transaction(() => {
        state = this.projectLaunchState(db, launchId)
        this.audit(db, launch.profile.profileId, "standalone-stopped", {
          launchId,
          runId: launch.runId,
          reason,
          state,
        })
      }).immediate()
    } finally {
      db.close()
    }
    const current = this.get(launchId)
    return { ...current, stopped: current.state === "cancelled" }
  }

  reconcile(): Array<ReturnType<StandaloneAgentLaunchService["get"]>> {
    const db = this.open()
    try {
      const rows = db
        .prepare(
          `SELECT l.id FROM agent_profile_standalone_launches l
           WHERE l.state IN ('pending','launching','running','uncertain')`,
        )
        .all() as Array<{ id: string }>
      for (const row of rows) {
        this.projectLaunchState(db, row.id)
      }
      return rows.map((row) => this.get(row.id, db))
    } finally {
      db.close()
    }
  }

  get(launchId: string, existingDb?: Database.Database) {
    const db = existingDb ?? this.open()
    try {
      const row = db
        .prepare(
          `SELECT l.*, r.status run_status, s.profile_id, s.profile_version
           FROM agent_profile_standalone_launches l
           JOIN agent_runs r ON r.id = l.run_id
           JOIN agent_profile_snapshots s ON s.id = l.snapshot_id
           WHERE l.id = ?`,
        )
        .get(launchId) as Row | undefined
      if (!row)
        throw new StandaloneAgentLaunchError("source-missing", "Named-agent launch is missing.")
      const snapshotId = String(row.snapshot_id)
      return {
        id: String(row.id),
        requestId: String(row.request_id),
        source: { kind: String(row.source_kind), id: String(row.source_id) },
        profile: { profileId: String(row.profile_id), version: Number(row.profile_version) },
        snapshotId,
        snapshot: new AgentProfileResolver(db).getSnapshot(snapshotId),
        chatId: String(row.chat_id),
        subChatId: String(row.sub_chat_id),
        runId: String(row.run_id),
        orchestrationTaskId:
          typeof row.orchestration_task_id === "string" ? row.orchestration_task_id : null,
        state: String(row.state),
        runStatus: String(row.run_status),
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
      }
    } finally {
      if (!existingDb) db.close()
    }
  }

  private async dispatch(launchId: string, queued: QueuedAgentRun) {
    const db = this.open()
    try {
      db.prepare(
        "UPDATE agent_profile_standalone_launches SET state = 'launching', updated_at = ? WHERE id = ?",
      ).run(epoch(), launchId)
    } finally {
      db.close()
    }
    try {
      await (await runtimeLaunchService(this.databasePath)).launch(queued)
      const next = this.open()
      try {
        this.projectLaunchState(next, launchId)
      } finally {
        next.close()
      }
    } catch (error) {
      const reconciled = this.open()
      try {
        this.projectLaunchState(reconciled, launchId)
      } finally {
        reconciled.close()
      }
      throw error
    }
    return this.get(launchId)
  }

  private projectLaunchState(db: Database.Database, launchId: string) {
    const result = db
      .prepare(
        `UPDATE agent_profile_standalone_launches SET
           state = CASE (SELECT status FROM agent_runs WHERE id = run_id)
             WHEN 'success' THEN 'completed'
             WHEN 'failure' THEN 'failed'
             WHEN 'cancelled' THEN 'cancelled'
             WHEN 'running' THEN 'running'
             WHEN 'pending' THEN 'pending'
             ELSE 'uncertain'
           END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(epoch(), launchId)
    if (result.changes !== 1) {
      throw new StandaloneAgentLaunchError("source-missing", "Named-agent launch is missing.")
    }
    return String(
      (
        db
          .prepare("SELECT state FROM agent_profile_standalone_launches WHERE id = ?")
          .get(launchId) as { state: string }
      ).state,
    )
  }

  private resolveSource(
    db: Database.Database,
    source:
      | { kind: "task"; taskId: string }
      | { kind: "chat"; chatId: string }
      | { kind: "studio"; projectId: string },
  ) {
    if (source.kind === "chat") {
      const row = db
        .prepare(
          `SELECT c.*, p.path project_path, p.archived_at project_archived,
                  p.default_permission_mode project_permission_mode,
                  p.default_custom_permissions project_custom_permissions,
                  t.name task_name, t.description task_description,
                  t.default_permission_mode task_permission_mode,
                  t.default_custom_permissions task_custom_permissions,
                  t.primary_worktree_path, t.primary_branch
           FROM chats c LEFT JOIN projects p ON p.id = c.project_id
           LEFT JOIN tasks t ON t.id = c.task_id WHERE c.id = ?`,
        )
        .get(source.chatId) as Row | undefined
      if (!row) throw missingSource()
      if (row.archived_at !== null || row.project_archived !== null) throw archivedSource()
      return sourceDto(row, source.chatId, source.chatId, true)
    }
    if (source.kind === "task") {
      const row = db
        .prepare(
          `SELECT t.*, p.path project_path, p.archived_at project_archived,
                  p.default_permission_mode project_permission_mode,
                  p.default_custom_permissions project_custom_permissions,
                  t.default_permission_mode task_permission_mode,
                  t.default_custom_permissions task_custom_permissions,
                  c.id parent_chat_id, c.initiator_chat_id, c.parent_run_id,
                  c.ancestor_chat_ids, c.worktree_path, c.branch, c.base_branch,
                  c.permission_mode chat_permission_mode,
                  c.custom_permissions chat_custom_permissions, c.model chat_model
           FROM tasks t JOIN projects p ON p.id = t.project_id
           LEFT JOIN chats c ON c.id = (
             SELECT id FROM chats WHERE task_id = t.id AND archived_at IS NULL
             ORDER BY updated_at DESC, id DESC LIMIT 1
           ) WHERE t.id = ?`,
        )
        .get(source.taskId) as Row | undefined
      if (!row) throw missingSource()
      if (row.archived_at !== null || row.project_archived !== null) throw archivedSource()
      return sourceDto(row, source.taskId, stringOrNull(row.parent_chat_id), false)
    }
    const row = db
      .prepare(
        `SELECT *, path project_path,
                default_permission_mode project_permission_mode,
                default_custom_permissions project_custom_permissions
         FROM projects WHERE id = ?`,
      )
      .get(source.projectId) as Row | undefined
    if (!row) throw missingSource()
    if (row.archived_at !== null) throw archivedSource()
    return sourceDto(row, source.projectId, null, false)
  }

  private assertOrchestrationMembership(db: Database.Database, taskId: string, source: SourceDto) {
    if (source.taskId && source.taskId !== taskId) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Named agent cannot join an orchestration owned by another task.",
      )
    }
    const row = db
      .prepare(
        `SELECT o.status, t.project_id FROM task_orchestrations o
         JOIN tasks t ON t.id = o.task_id WHERE o.task_id = ?`,
      )
      .get(taskId) as Row | undefined
    if (
      !row ||
      String(row.project_id) !== source.projectId ||
      ["completed", "failed", "stopped"].includes(String(row.status))
    ) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Operation workspace membership requires an active same-project orchestration.",
      )
    }
  }

  private existingRequest(
    db: Database.Database,
    input: ReturnType<typeof standaloneAgentLaunchInputSchema.parse>,
  ) {
    const row = db
      .prepare(
        `SELECT l.id, l.request_fingerprint
         FROM agent_profile_standalone_launches l
         WHERE l.request_id = ?`,
      )
      .get(input.requestId) as Row | undefined
    if (!row) return null
    if (row.request_fingerprint !== standaloneRequestFingerprint(input)) {
      throw new StandaloneAgentLaunchError(
        "request-conflict",
        "Standalone launch request ID was already used with different confirmed input.",
      )
    }
    return this.get(String(row.id), db)
  }

  private currentPolicy(
    db: Database.Database,
    source: SourceDto,
    orchestrationTaskId: string | null,
    harness: string | null,
  ): AgentProfileLaunchPolicy {
    let permission = parseDurablePermission(
      source.projectPermissionMode,
      source.projectCustomPermissions,
    )
    if (source.taskId) {
      const task = parseDurablePermission(source.taskPermissionMode, source.taskCustomPermissions)
      permission = intersectAgentProfilePermissions(
        permission.mode,
        permission.custom,
        task.mode,
        task.custom,
      )
    }
    if (source.chatPermissionMode) {
      const chat = parseDurablePermission(source.chatPermissionMode, source.chatCustomPermissions)
      permission = intersectAgentProfilePermissions(
        permission.mode,
        permission.custom,
        chat.mode,
        chat.custom,
      )
    }
    let maxDescendants = 0
    if (orchestrationTaskId) {
      this.assertOrchestrationMembership(db, orchestrationTaskId, source)
      if (orchestrationTaskId !== source.taskId) {
        const task = db
          .prepare(
            `SELECT default_permission_mode, default_custom_permissions
             FROM tasks WHERE id = ? AND project_id = ?`,
          )
          .get(orchestrationTaskId, source.projectId) as
          | {
              default_permission_mode: string
              default_custom_permissions: string | null
            }
          | undefined
        if (!task) {
          throw new StandaloneAgentLaunchError(
            "launch-blocked",
            "Operation workspace task permission policy is missing.",
          )
        }
        const taskPermission = parseDurablePermission(
          task.default_permission_mode,
          parseObject(task.default_custom_permissions),
        )
        permission = intersectAgentProfilePermissions(
          permission.mode,
          permission.custom,
          taskPermission.mode,
          taskPermission.custom,
        )
      }
      maxDescendants = currentOrchestrationMaxDepth(db, orchestrationTaskId)
    }
    return agentProfileLaunchPolicySchema.parse({
      permissionMode: permission.mode,
      customPermissions: permission.custom,
      allowedTools: null,
      allowedSkills: null,
      allowedModels: source.chatModel ? [source.chatModel] : null,
      allowedRuntimes: harness ? currentRuntimeCeiling(db, source, harness) : null,
      maxDescendants,
    })
  }

  private audit(db: Database.Database, profileId: string, action: string, summary: object) {
    db.prepare(
      `INSERT INTO agent_profile_audit_events (id, profile_id, action, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), profileId, action, JSON.stringify(summary), epoch())
  }

  private open() {
    const db = new Database(this.databasePath)
    db.pragma("foreign_keys = ON")
    db.pragma("busy_timeout = 5000")
    return db
  }
}

type SourceDto = {
  sourceId: string
  projectId: string
  projectPath: string
  taskId: string | null
  taskName: string | null
  taskDescription: string | null
  primaryWorktreePath: string | null
  primaryBranch: string | null
  parentChatId: string | null
  initiatorChatId: string | null
  parentRunId: string | null
  ancestorChatIds: string[]
  worktreePath: string | null
  branch: string | null
  baseBranch: string | null
  projectPermissionMode: string | null
  projectCustomPermissions: unknown
  taskPermissionMode: string | null
  taskCustomPermissions: unknown
  chatPermissionMode: string | null
  chatCustomPermissions: unknown
  chatModel: string | null
  chatRuntimePreference: string | null
}

function sourceDto(
  row: Row,
  sourceId: string,
  parentChatId: string | null,
  chatSource: boolean,
): SourceDto {
  return {
    sourceId,
    projectId: String(row.project_id ?? row.id),
    projectPath: String(row.project_path),
    taskId: chatSource
      ? stringOrNull(row.task_id)
      : stringOrNull(row.task_id ?? (row.project_id ? row.id : null)),
    taskName: stringOrNull(row.task_id ? row.task_name : row.name),
    taskDescription: stringOrNull(row.task_description ?? row.description),
    primaryWorktreePath: stringOrNull(row.primary_worktree_path),
    primaryBranch: stringOrNull(row.primary_branch),
    parentChatId,
    initiatorChatId: stringOrNull(row.initiator_chat_id),
    parentRunId: stringOrNull(row.parent_run_id),
    ancestorChatIds: [
      ...parseIds(row.ancestor_chat_ids),
      ...(parentChatId && !parseIds(row.ancestor_chat_ids).includes(parentChatId)
        ? [parentChatId]
        : []),
    ],
    worktreePath: stringOrNull(row.worktree_path),
    branch: stringOrNull(row.branch),
    baseBranch: stringOrNull(row.base_branch),
    projectPermissionMode: stringOrNull(row.project_permission_mode),
    projectCustomPermissions: parseObject(row.project_custom_permissions),
    taskPermissionMode: stringOrNull(row.task_permission_mode),
    taskCustomPermissions: parseObject(row.task_custom_permissions),
    chatPermissionMode: chatSource ? stringOrNull(row.permission_mode) : null,
    chatCustomPermissions: chatSource ? parseObject(row.custom_permissions) : null,
    chatModel: chatSource ? stringOrNull(row.model) : null,
    chatRuntimePreference: chatSource ? stringOrNull(row.runtime_preference) : null,
  }
}

function parseDurablePermission(mode: string | null, custom: unknown) {
  const parsed = agentProfileLaunchPolicySchema.safeParse({
    permissionMode: mode,
    customPermissions: custom,
    allowedTools: [],
    allowedSkills: [],
    allowedModels: null,
    allowedRuntimes: null,
    maxDescendants: 0,
  })
  return parsed.success
    ? { mode: parsed.data.permissionMode, custom: parsed.data.customPermissions }
    : { mode: "read-only" as const, custom: null }
}

function currentRuntimeResolution(
  db: Database.Database,
  source: SourceDto,
  harness: string,
): AgentProfileRuntimeResolution {
  if (source.chatRuntimePreference && source.chatRuntimePreference !== "auto") {
    const preference = source.chatRuntimePreference as AgentRuntimePreference
    const resolvedRuntime = runtimeAdapterForPreference(preference)
    if (!resolvedRuntime) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Current chat Runtime preference is invalid.",
      )
    }
    return {
      preference: preference as Exclude<AgentRuntimePreference, "auto">,
      source: "chat",
      defaultVersion: null,
      resolvedRuntime,
    }
  }
  const row = db
    .prepare(
      `SELECT d.scope_type, d.preference, d.version
       FROM agent_runtime_defaults d
       WHERE d.harness = ? AND d.preference <> 'auto' AND (
         (d.scope_type = 'project' AND d.scope_id = ?) OR d.scope_type = 'global'
       )
       ORDER BY CASE d.scope_type WHEN 'project' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(harness, source.projectId) as
    | { scope_type: "project" | "global"; preference: AgentRuntimePreference; version: number }
    | undefined
  if (row) {
    const resolvedRuntime = runtimeAdapterForPreference(row.preference)
    if (!resolvedRuntime) {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Current durable Runtime default is invalid.",
      )
    }
    return {
      preference: row.preference as Exclude<AgentRuntimePreference, "auto">,
      source: row.scope_type,
      defaultVersion: row.version,
      resolvedRuntime,
    }
  }
  const productRuntime = productRuntimeForHarness(harness)
  return {
    preference: productRuntime,
    source: "product",
    defaultVersion: null,
    resolvedRuntime: productRuntime,
  }
}

function currentRuntimeCeiling(
  db: Database.Database,
  source: SourceDto,
  harness: string,
): AgentRuntimePreference[] | null {
  if (source.chatRuntimePreference && source.chatRuntimePreference !== "auto") {
    return [source.chatRuntimePreference as AgentRuntimePreference]
  }
  const row = db
    .prepare(
      `SELECT d.preference
       FROM agent_runtime_defaults d
       WHERE d.harness = ? AND d.preference <> 'auto' AND (
         (d.scope_type = 'project' AND d.scope_id = ?) OR d.scope_type = 'global'
       )
       ORDER BY CASE d.scope_type WHEN 'project' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(harness, source.projectId) as { preference: AgentRuntimePreference } | undefined
  return row ? [row.preference] : null
}

function currentOrchestrationMaxDepth(db: Database.Database, taskId: string) {
  const row = db
    .prepare(
      `SELECT o.max_depth, (
         SELECT policy_json FROM orchestration_policy_versions pv
         WHERE pv.task_id = o.task_id ORDER BY pv.version DESC LIMIT 1
       ) policy_json
       FROM task_orchestrations o WHERE o.task_id = ?`,
    )
    .get(taskId) as { max_depth: number; policy_json: string | null } | undefined
  if (!row) {
    throw new StandaloneAgentLaunchError("launch-blocked", "Orchestration policy is missing.")
  }
  if (row.policy_json) {
    try {
      const policy = JSON.parse(row.policy_json) as Record<string, unknown>
      if (Number.isInteger(policy.maxDepth) && Number(policy.maxDepth) >= 0) {
        return Number(policy.maxDepth)
      }
    } catch {
      throw new StandaloneAgentLaunchError(
        "launch-blocked",
        "Current orchestration policy is malformed.",
      )
    }
  }
  return Math.max(0, Number(row.max_depth))
}

function standaloneRequestFingerprint(
  input: ReturnType<typeof standaloneAgentLaunchInputSchema.parse>,
) {
  return requestFingerprint({
    kind: "standalone",
    source: input.source,
    profile: input.profile,
    context: input.context,
    overrides: input.overrides,
    orchestrationTaskId: input.orchestrationTaskId,
    confirmedSnapshotDigest: input.confirmedSnapshotDigest,
  })
}

function requestFingerprint(value: unknown) {
  return sha256Text(canonicalJson(value))
}

function buildContext(
  db: Database.Database,
  source: SourceDto,
  selection: { includeTask: boolean; includeParentChat: boolean },
) {
  const sections: string[] = []
  if (selection.includeTask && source.taskId) {
    sections.push(
      `Task context: ${source.taskName ?? source.taskId}${source.taskDescription ? `\n${source.taskDescription}` : ""}`,
    )
  }
  if (selection.includeParentChat && source.parentChatId) {
    const rows = db
      .prepare("SELECT messages FROM sub_chats WHERE chat_id = ? ORDER BY created_at, id")
      .all(source.parentChatId) as Array<{ messages: string }>
    const visible = rows
      .flatMap((row) => visibleMessages(row.messages))
      .join("\n\n")
      .slice(0, 100_000)
    sections.push(`Visible parent-chat context (provider-private state excluded):\n${visible}`)
  }
  return sections.join("\n\n")
}

function visibleMessages(messagesJson: string): string[] {
  try {
    const parsed = JSON.parse(messagesJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return []
      const record = message as Record<string, unknown>
      const role = typeof record.role === "string" ? record.role : "message"
      const content =
        typeof record.content === "string"
          ? [record.content]
          : Array.isArray(record.parts)
            ? record.parts.flatMap(formatVisiblePartForHandoff)
            : []
      const text = content.join("\n\n").trim()
      return text ? [`${role}: ${text}`] : []
    })
  } catch {
    return []
  }
}

function profilePrompt(snapshot: ResolvedAgentProfileSnapshot, context: string) {
  return [
    resolvedAgentProfileInstructions(snapshot),
    `Presentation style only (no authority): tone=${snapshot.presentation.tone}; verbosity=${snapshot.presentation.verbosity}; formatting=${snapshot.presentation.formatting}; ${snapshot.presentation.responseStructure}`,
    context || null,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function assertLaunchable(snapshot: ResolvedAgentProfileSnapshot) {
  const blocking = snapshot.conflicts.filter((conflict) =>
    AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
  )
  if (blocking.length) {
    throw new StandaloneAgentLaunchError(
      "launch-blocked",
      blocking.map((conflict) => conflict.message).join(" "),
    )
  }
}

function resolveWorktree(source: SourceDto, snapshot: ResolvedAgentProfileSnapshot) {
  const strategy = snapshot.capability.worktreeStrategy
  if (strategy === "none") return { path: null, branch: null }
  const requested =
    strategy === "task-primary"
      ? source.primaryWorktreePath
      : (source.worktreePath ?? source.projectPath)
  const branch = strategy === "task-primary" ? source.primaryBranch : source.branch
  if (!requested || !existsSync(requested)) {
    throw new StandaloneAgentLaunchError(
      "worktree-invalid",
      "Selected Agent Profile worktree is missing.",
    )
  }
  if (["existing", "attached-branch"].includes(strategy)) {
    throw new StandaloneAgentLaunchError(
      "worktree-invalid",
      "Existing/attached worktree profiles require an explicit launch worktree selector.",
    )
  }
  let path: string
  let registered: string
  try {
    path = realpathSync(requested)
    registered = execFileSync(
      "git",
      ["-C", source.projectPath, "worktree", "list", "--porcelain"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
  } catch {
    throw new StandaloneAgentLaunchError(
      "worktree-invalid",
      "Selected Agent Profile worktree could not be verified against the project repository.",
    )
  }
  const isRegistered = registered
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .some((line) => {
      try {
        return realpathSync(line.slice("worktree ".length)) === path
      } catch {
        return false
      }
    })
  if (!isRegistered) {
    throw new StandaloneAgentLaunchError(
      "worktree-invalid",
      "Selected Agent Profile worktree is not registered with the project repository.",
    )
  }
  return { path, branch }
}

function queuedRun(db: Database.Database, runId: string): QueuedAgentRun {
  const row = db
    .prepare(
      `SELECT r.*, s.mode chat_mode, p.path project_path, l.snapshot_id profile_snapshot_id
       FROM agent_runs r
       JOIN chats c ON c.id = r.chat_id JOIN sub_chats s ON s.id = r.sub_chat_id
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN agent_profile_standalone_launches l ON l.run_id = r.id
       WHERE r.id = ?`,
    )
    .get(runId) as Row
  return {
    runId,
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: String(row.harness) as QueuedAgentRun["harness"],
    prompt: String(row.initial_prompt),
    chatMode: normalizeChatMode(row.chat_mode),
    model: stringOrNull(row.model),
    reasoningEffort: null,
    permissionMode: String(row.permission_mode),
    customPermissions: stringOrNull(row.custom_permissions),
    worktreePath: stringOrNull(row.worktree_path),
    projectPath: stringOrNull(row.project_path),
    ...(row.profile_snapshot_id
      ? {
          profileRuntimeAuthority: frozenAgentProfileRuntimeAuthority(
            new AgentProfileResolver(db).getSnapshot(String(row.profile_snapshot_id)),
          ),
        }
      : {}),
    runtimeLaunch: resolvedLaunchFromSnapshotRow(row),
  }
}

function missingSource() {
  return new StandaloneAgentLaunchError("source-missing", "Named-agent launch source is missing.")
}

function archivedSource() {
  return new StandaloneAgentLaunchError("source-archived", "Named-agent launch source is archived.")
}

function isConstraintError(error: unknown) {
  return error instanceof Error && /constraint|unique/i.test(error.message)
}

function parseIds(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function parseObject(value: unknown): unknown {
  if (!value) return null
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function timestamp(value: unknown) {
  const numeric = Number(value)
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
}

async function runtimeLaunchService(databasePath: string) {
  // Lazy import avoids a router -> profile router -> standalone launcher ->
  // main launcher -> router cycle. F11 still owns the singleton and dispatch.
  const { getMainRuntimeLaunchService } = await import("../main-run-launcher")
  return getMainRuntimeLaunchService(databasePath)
}
