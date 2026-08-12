import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import { projectVaultSectionIds } from "../project-vaults/registry"
import { readFileInsideRoot, writeFileInsideRoot } from "../path-safety"
import { assertRegisteredWorktree } from "../git/security/path-validation"
import { getPermissionPreferences } from "../permissions"
import { nowEpochSeconds } from "../db/timestamps"
import { createOrchestrationInputSchema } from "../../../shared/agent-orchestration"
import {
  AgentOrchestrationError,
  createAgentOrchestrationService,
} from "../agent-orchestration/service"
import {
  prepareThreadSpawn,
  threadSpawnRequestSchema,
  type ThreadSpawnPlan,
} from "./thread-spawn-contract"
import type {
  McpCallerIdentity,
  McpControlErrorCode,
  McpControlResponse,
  McpMutationService,
} from "./types"
import {
  AGENT_HARNESSES,
  type AgentHarness,
  type RunPermissionMode,
} from "../../../shared/harness-types"
import {
  constructRuntimeSnapshot,
  runtimePermissionSnapshot,
  runtimeSnapshotSqlValues,
} from "../agent-runtime/snapshot"
import { queueChatRun } from "../run-launch-service"
import { registerChatWait } from "../chat-waits"
import { VisualArtifactStore } from "../visual-capture/artifact-store"
import { canonicalMcpChatScope } from "./scope"

const itemSchema = z.enum(["project", "task", "chat"])
const name = z.string().trim().min(1).max(200)
const id = z.string().trim().min(1).max(128)

function validateChatDestination(input: {
  scope: "global" | "project" | "task"
  projectId?: string
  taskId?: string
}): boolean {
  return !(
    (input.scope === "global" && (input.projectId || input.taskId)) ||
    (input.scope === "project" && (!input.projectId || input.taskId)) ||
    (input.scope === "task" && !input.taskId)
  )
}

const schemas = {
  spawn_thread: threadSpawnRequestSchema,
  orchestrate_task: createOrchestrationInputSchema,
  create_chat: z
    .object({
      name,
      scope: z.enum(["global", "project", "task"]),
      projectId: id.optional(),
      taskId: id.optional(),
      harness: z.string().trim().min(1).max(80).optional(),
      model: z.string().trim().max(200).optional(),
    })
    .strict(),
  create_task: z
    .object({ projectId: id.optional(), name, description: z.string().max(20_000).optional() })
    .strict(),
  add_attachment: z
    .object({
      chatId: id,
      name,
      contentText: z.string().max(2_000_000),
      kind: z.enum(["pasted-text", "text"]).default("pasted-text"),
    })
    .strict(),
  request_visual_capture: z
    .object({
      projectId: id,
      chatId: id,
      runId: id,
      sourceIntent: z.enum(["screen", "window", "application-window", "region"]).optional(),
    })
    .strict(),
  read_visual_context: z.object({ artifactId: z.string().uuid() }).strict(),
  rename_item: z.object({ kind: itemSchema, id, name }).strict(),
  move_chat: z
    .object({
      id,
      scope: z.enum(["global", "project", "task"]),
      projectId: id.optional(),
      taskId: id.optional(),
    })
    .strict(),
  pin_item: z.object({ kind: itemSchema, id, pinned: z.boolean().default(true) }).strict(),
  archive_item: z.object({ kind: itemSchema, id }).strict(),
  restore_item: z.object({ kind: itemSchema, id }).strict(),
  write_attachment_to_worktree: z
    .object({
      attachmentId: id,
      worktreePath: z.string().trim().min(1),
      targetRelativePath: z.string().trim().min(1).max(1024).optional(),
      overwrite: z.boolean().default(false),
    })
    .strict(),
  launch_run: z
    .object({
      chatId: id,
      initialPrompt: z.string().trim().min(1).max(100_000),
      idempotencyKey: id,
      vaultContextSectionIds: z.array(z.enum(projectVaultSectionIds)).optional(),
    })
    .strict(),
  wait_for_chats: z
    .object({
      targetChatIds: z.array(id).min(1).max(8),
      idempotencyKey: id,
    })
    .strict(),
} as const

export const mcpMutationInputShapes: Record<string, z.ZodRawShape | undefined> = Object.fromEntries(
  Object.entries(schemas).map(([key, value]) => [key, value.shape]),
)

type Row = Record<string, unknown>
/**
 * The stdio MCP child cannot call renderer tRPC. This is the shared, main-free
 * mutation layer used by its registry and deliberately opens a short-lived DB
 * connection for every call, matching the caller revalidation model.
 */
export function createMcpMutationService(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpMutationService {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP mutations.")
  return {
    async invoke(operation, caller, rawInput, context) {
      const schema = schemas[operation as keyof typeof schemas]
      if (!schema) return fail("invalid-input", "Unsupported mutation operation.")
      const input = schema.safeParse(rawInput)
      if (!input.success)
        return fail("invalid-input", input.error.issues[0]?.message ?? "Invalid input.")
      if (
        (operation === "create_chat" || operation === "move_chat") &&
        !validateChatDestination(input.data as z.infer<typeof schemas.create_chat>)
      )
        return fail("invalid-input", "Scope identity must match the chat destination.")
      const db = openAppDatabase(databasePath)
      try {
        db.pragma("foreign_keys = ON")
        db.pragma("busy_timeout = 5000")
        const scope = callerScope(db, caller)
        switch (operation) {
          case "create_task":
            return createTask(db, scope, input.data as z.infer<typeof schemas.create_task>)
          case "spawn_thread":
            return await spawnThread(
              db,
              caller,
              input.data as z.infer<typeof threadSpawnRequestSchema>,
            )
          case "orchestrate_task":
            return orchestrateTask(
              databasePath,
              caller,
              input.data as z.infer<typeof createOrchestrationInputSchema>,
            )
          case "create_chat":
            return createChat(db, scope, input.data as z.infer<typeof schemas.create_chat>)
          case "add_attachment":
            return addAttachment(db, scope, input.data as z.infer<typeof schemas.add_attachment>)
          case "request_visual_capture":
            return requestVisualCapture(
              db,
              scope,
              caller,
              input.data as z.infer<typeof schemas.request_visual_capture>,
              context,
            )
          case "read_visual_context":
            return await readVisualContext(
              db,
              databasePath,
              scope,
              caller,
              input.data as z.infer<typeof schemas.read_visual_context>,
            )
          case "rename_item":
            return renameItem(db, scope, input.data as z.infer<typeof schemas.rename_item>)
          case "move_chat":
            return moveChat(db, scope, input.data as z.infer<typeof schemas.move_chat>)
          case "pin_item":
            return pinItem(db, scope, input.data as z.infer<typeof schemas.pin_item>)
          case "archive_item":
            return setArchived(db, scope, input.data as z.infer<typeof schemas.archive_item>, true)
          case "restore_item":
            return setArchived(db, scope, input.data as z.infer<typeof schemas.restore_item>, false)
          case "write_attachment_to_worktree":
            return await writeAttachment(
              db,
              scope,
              input.data as z.infer<typeof schemas.write_attachment_to_worktree>,
            )
          case "launch_run":
            return launchRun(db, scope, input.data as z.infer<typeof schemas.launch_run>)
          case "wait_for_chats":
            return waitForChats(
              db,
              scope,
              caller,
              input.data as z.infer<typeof schemas.wait_for_chats>,
            )
        }
        return fail("invalid-input", "Unsupported mutation operation.")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Mutation failed."
        if (message === "Caller chat is stale.")
          return { ok: false, error: { code: "stale-caller", message } }
        if (message === "Target is missing or stale.") return fail("stale-target", message)
        if (message === "Target is outside the caller scope.") return fail("out-of-scope", message)
        if (error instanceof AgentOrchestrationError) return fail(error.code, error.message)
        return fail("internal-error", message)
      } finally {
        db.close()
      }
    },
  }
}

function requestVisualCapture(
  db: Database.Database,
  scope: Scope,
  caller: McpCallerIdentity,
  input: z.infer<typeof schemas.request_visual_capture>,
  context: { invocationId: string; approved: boolean } | undefined,
): McpControlResponse {
  if (!context?.approved) {
    return fail("approval-required", "Visual capture requires an exact Tier 3 approval.")
  }
  if (
    input.chatId !== caller.chatId ||
    input.runId !== caller.runId ||
    input.projectId !== scope.projectId
  ) {
    return fail("out-of-scope", "Visual capture request must match the exact caller scope.")
  }
  const run = db
    .prepare(
      `SELECT r.id
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
        WHERE r.id = ? AND r.chat_id = ? AND c.project_id = ?`,
    )
    .get(input.runId, input.chatId, input.projectId)
  if (!run) return fail("stale-caller", "Visual capture caller run is missing or stale.")
  const existing = db
    .prepare(
      `SELECT request_id AS requestId
         FROM visual_capture_audit
        WHERE request_id = ? AND action = 'request' AND actor_kind = 'agent'
        LIMIT 1`,
    )
    .get(context.invocationId) as { requestId: string } | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO visual_capture_audit
         (artifact_id, request_id, action, actor_kind, actor_id, project_id, outcome, occurred_at)
       VALUES (NULL, ?, 'request', 'agent', ?, ?, 'allowed', ?)`,
    ).run(context.invocationId, input.runId, input.projectId, Date.now())
  }
  return {
    ok: true,
    data: {
      state: "awaiting-visible-user-selection",
      captureRequestId: context.invocationId,
      scope: {
        projectId: input.projectId,
        chatId: input.chatId,
        runId: input.runId,
      },
      sourceIntent: input.sourceIntent ?? null,
    },
  }
}

async function readVisualContext(
  db: Database.Database,
  databasePath: string,
  scope: Scope,
  caller: McpCallerIdentity,
  input: z.infer<typeof schemas.read_visual_context>,
): Promise<McpControlResponse> {
  const selected = db
    .prepare(
      `SELECT a.project_id AS projectId
         FROM visual_artifacts a
         JOIN visual_artifact_links l ON l.artifact_id = a.id
        WHERE a.id = ?
          AND a.archived_at IS NULL
          AND (
            (l.consumer_kind = 'run' AND l.consumer_id = ?)
            OR (l.consumer_kind = 'chat' AND l.consumer_id = ?)
            OR (
              l.consumer_kind = 'task'
              AND EXISTS (
                SELECT 1 FROM chats caller_chat
                 WHERE caller_chat.id = ?
                   AND caller_chat.task_id = l.consumer_id
              )
            )
            OR (
              l.consumer_kind = 'knowledge'
              AND EXISTS (
                SELECT 1
                  FROM agent_runs caller_run,
                       json_each(caller_run.vault_context_manifest, '$.graphContext.entries') entry
                 WHERE caller_run.id = ?
                   AND json_extract(entry.value, '$.nodeId') = l.consumer_id
              )
            )
          )
        LIMIT 1`,
    )
    .get(input.artifactId, caller.runId ?? "", caller.chatId, caller.chatId, caller.runId ?? "") as
    { projectId: string } | undefined
  if (!selected) return fail("out-of-scope", "Visual artifact is not selected for this caller.")
  if (selected.projectId !== scope.projectId) {
    return fail("out-of-scope", "Visual artifact belongs to another project.")
  }
  const store = new VisualArtifactStore(db, visualArtifactRootForDatabase(databasePath))
  const verified = await store.readVerified(input.artifactId)
  db.prepare(
    `INSERT INTO visual_capture_audit
       (artifact_id, request_id, action, actor_kind, actor_id, project_id, outcome, occurred_at)
     VALUES (?, NULL, 'read', 'agent', ?, ?, 'allowed', ?)`,
  ).run(input.artifactId, caller.runId ?? caller.chatId, selected.projectId, Date.now())
  return {
    ok: true,
    data: {
      artifactId: verified.record.id,
      mediaType: "image/png",
      sha256: verified.record.derivativeSha256,
      base64Data: verified.bytes.toString("base64"),
    },
  }
}

function visualArtifactRootForDatabase(databasePath: string): string {
  const databaseDirectory = dirname(databasePath)
  return basename(databaseDirectory).toLowerCase() === "data"
    ? join(dirname(databaseDirectory), "visual-artifacts")
    : join(databaseDirectory, "visual-artifacts")
}

function orchestrateTask(
  databasePath: string,
  caller: McpCallerIdentity,
  input: z.infer<typeof createOrchestrationInputSchema>,
): McpControlResponse {
  return {
    ok: true,
    data: createAgentOrchestrationService(databasePath).create(input, caller.chatId),
  }
}

function launchRun(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.launch_run>,
): McpControlResponse {
  target(db, scope, "chat", input.chatId)
  const queued = queueChatRun(db, input)
  if (!queued.ok) return fail(queued.code, queued.message)
  return {
    ok: true,
    data: {
      runId: queued.runId,
      created: queued.created,
      launch: { status: queued.status },
    },
  }
}

function waitForChats(
  db: Database.Database,
  scope: Scope,
  caller: McpCallerIdentity,
  input: z.infer<typeof schemas.wait_for_chats>,
): McpControlResponse {
  for (const chatId of new Set(input.targetChatIds)) target(db, scope, "chat", chatId)
  const registered = registerChatWait(db, {
    waiterChatId: caller.chatId,
    waiterRunId: caller.runId,
    targetChatIds: input.targetChatIds,
    idempotencyKey: input.idempotencyKey,
  })
  if (!registered.ok) return fail(registered.code, registered.message)
  return {
    ok: true,
    data: {
      ...registered,
      instruction:
        "Stop this turn now. Flapstack will independently resume this chat after every target has finished its queued and running work.",
    },
  }
}

type Scope = { chatId: string; projectId: string | null; taskId: string | null; kind: string }
function callerScope(db: Database.Database, caller: McpCallerIdentity): Scope {
  const row = db
    .prepare(
      `SELECT c.id, c.scope, c.project_id, c.task_id, p.id valid_project_id,
              t.project_id task_project_id
       FROM chats c
       LEFT JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
       LEFT JOIN tasks t ON t.id = c.task_id AND t.archived_at IS NULL
       WHERE c.id = ? AND c.archived_at IS NULL`,
    )
    .get(caller.chatId) as Row | undefined
  const scope = row ? canonicalMcpChatScope(row) : null
  if (!scope) throw new Error("Caller chat is stale.")
  return {
    chatId: scope.chatId,
    kind: scope.kind,
    projectId: scope.projectId,
    taskId: scope.taskId,
  }
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
function visible(scope: Scope, row: Row): boolean {
  if (scope.taskId) return row.task_id === scope.taskId
  if (scope.projectId) return row.project_id === scope.projectId
  return scope.kind === "global"
}
function row(
  db: Database.Database,
  kind: z.infer<typeof itemSchema>,
  targetId: string,
): Row | undefined {
  const table = kind === "project" ? "projects" : kind === "task" ? "tasks" : "chats"
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(targetId) as Row | undefined
}
function target(
  db: Database.Database,
  scope: Scope,
  kind: z.infer<typeof itemSchema>,
  targetId: string,
): Row {
  const value = row(db, kind, targetId)
  if (!value) throw new Error("Target is missing or stale.")
  const scopeRow =
    kind === "project"
      ? { project_id: value.id, task_id: null }
      : kind === "task"
        ? { project_id: value.project_id, task_id: value.id }
        : value
  if (!visible(scope, scopeRow)) throw new Error("Target is outside the caller scope.")
  return value
}
function createTask(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.create_task>,
): McpControlResponse {
  const projectId = input.projectId ?? scope.projectId
  if (!projectId || (scope.projectId && projectId !== scope.projectId))
    return fail("out-of-scope", "Task project is outside the caller scope.")
  const project = db
    .prepare(
      "SELECT id, default_permission_mode, default_custom_permissions FROM projects WHERE id = ? AND archived_at IS NULL",
    )
    .get(projectId) as Row | undefined
  if (!project) return fail("stale-target", "Project is missing or archived.")
  const existing = db
    .prepare("SELECT id FROM tasks WHERE project_id = ? AND name = ? AND archived_at IS NULL")
    .get(projectId, input.name) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const taskId = randomUUID()
  const now = nowEpochSeconds()
  db.prepare(
    "INSERT INTO tasks (id, project_id, name, description, default_permission_mode, default_custom_permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    taskId,
    projectId,
    input.name,
    input.description ?? null,
    project.default_permission_mode,
    project.default_custom_permissions ?? null,
    now,
    now,
  )
  return { ok: true, data: { id: taskId, created: true } }
}
function createChat(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.create_chat>,
): McpControlResponse {
  let projectId = input.projectId ?? null
  let taskId = input.taskId ?? null
  if (input.scope === "global") {
    projectId = null
    taskId = null
  }
  if (input.scope === "project" && !projectId)
    return fail("invalid-input", "Project chats require projectId.")
  if (input.scope === "task") {
    if (!taskId) return fail("invalid-input", "Task chats require taskId.")
    const task = db
      .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
      .get(taskId) as Row | undefined
    if (!task) return fail("stale-target", "Task is missing or archived.")
    const taskProjectId = String(task.project_id)
    if (projectId && projectId !== taskProjectId)
      return fail("invalid-input", "Task does not belong to the requested project.")
    projectId = taskProjectId
  }
  if (scope.taskId && taskId !== scope.taskId)
    return fail("out-of-scope", "Chat is outside the caller task scope.")
  if (scope.projectId && projectId !== scope.projectId)
    return fail("out-of-scope", "Chat is outside the caller project scope.")
  const existing = db
    .prepare(
      "SELECT id FROM chats WHERE name = ? AND project_id IS ? AND task_id IS ? AND archived_at IS NULL",
    )
    .get(input.name, projectId, taskId) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const inherited = taskId
    ? (db
        .prepare(
          "SELECT default_permission_mode permission_mode, default_custom_permissions custom_permissions FROM tasks WHERE id = ?",
        )
        .get(taskId) as Row | undefined)
    : projectId
      ? (db
          .prepare(
            "SELECT default_permission_mode permission_mode, default_custom_permissions custom_permissions FROM projects WHERE id = ?",
          )
          .get(projectId) as Row | undefined)
      : null
  const preferences = getPermissionPreferences()
  const permissionMode =
    typeof inherited?.permission_mode === "string"
      ? inherited.permission_mode
      : preferences.globalDefault
  const customPermissions =
    permissionMode === "custom"
      ? typeof inherited?.custom_permissions === "string"
        ? inherited.custom_permissions
        : JSON.stringify(preferences.globalCustomPermissions)
      : null
  const chatId = randomUUID()
  const now = nowEpochSeconds()
  db.prepare(
    "INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode, custom_permissions, mcp_exposure_enabled, harness, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(
    chatId,
    input.name,
    input.scope,
    projectId,
    taskId,
    permissionMode,
    customPermissions,
    input.harness ?? null,
    input.model ?? null,
    now,
    now,
  )
  db.prepare(
    "INSERT INTO sub_chats (id, chat_id, harness, model, permission_mode, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)",
  ).run(randomUUID(), chatId, input.harness ?? null, input.model ?? null, permissionMode, now, now)
  return { ok: true, data: { id: chatId, created: true } }
}

/**
 * Creates the target chat, its canonical conversation row, and (when asked)
 * its first run in one durable operation. Harness execution is deliberately
 * deferred to the target harness's normal consumer: this MCP child has no
 * renderer session to own a stream. A row therefore never claims success
 * before it is safely persisted.
 */
async function spawnThread(
  db: Database.Database,
  caller: McpCallerIdentity,
  request: z.infer<typeof threadSpawnRequestSchema>,
): Promise<McpControlResponse> {
  const callerRow = db
    .prepare(
      `SELECT id, harness, parent_chat_id, initiator_chat_id, ancestor_chat_ids
       FROM chats WHERE id = ? AND archived_at IS NULL`,
    )
    .get(caller.chatId) as Row | undefined
  const harness = callerRow && typeof callerRow.harness === "string" ? callerRow.harness : null
  if (!AGENT_HARNESSES.includes(harness as AgentHarness)) {
    return fail("invalid-caller", "Caller is not a supported spawned-thread harness.")
  }

  const ancestors = parseAncestorChatIds(callerRow?.ancestor_chat_ids)
  if (!ancestors) return fail("forbidden-loop", "Caller has invalid durable lineage.")
  const contract = prepareThreadSpawn(request, {
    harness: harness as AgentHarness,
    chatId: caller.chatId,
    ...(caller.runId ? { runId: caller.runId } : {}),
    initiatorChatId:
      typeof callerRow?.initiator_chat_id === "string"
        ? callerRow.initiator_chat_id
        : caller.chatId,
    ancestorChatIds: ancestors,
  })
  if (!contract.ok) return fail(contract.error.code, contract.error.message)

  const resolved = resolveSpawnTarget(db, caller, contract.plan)
  if (!resolved.ok) return resolved

  const chatId = randomUUID()
  const subChatId = randomUUID()
  const runId = contract.plan.launch.requested ? randomUUID() : null
  const promptMessageId = `mcp-spawn-${chatId}`
  const now = nowEpochSeconds()
  const initialMessages =
    !runId && contract.plan.launch.initialPrompt
      ? JSON.stringify([
          {
            id: promptMessageId,
            role: "user",
            parts: [{ type: "text", text: contract.plan.launch.initialPrompt }],
            metadata: { harness: contract.plan.targetHarness },
          },
        ])
      : "[]"

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO chats (
        id, name, scope, project_id, task_id, permission_mode, custom_permissions,
        mcp_exposure_enabled, harness, model,
        worktree_path, branch, base_branch, parent_chat_id, initiator_chat_id,
        parent_run_id, ancestor_chat_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      chatId,
      `${contract.plan.targetHarness} thread`,
      resolved.scope,
      resolved.projectId,
      resolved.taskId,
      contract.plan.permission.mode,
      contract.plan.permission.customPermissions
        ? JSON.stringify(contract.plan.permission.customPermissions)
        : null,
      contract.plan.targetHarness,
      contract.plan.model ?? null,
      resolved.worktreePath,
      resolved.branch,
      resolved.baseBranch,
      contract.plan.lineage.parentChatId,
      contract.plan.lineage.initiatorChatId,
      contract.plan.lineage.parentRunId ?? null,
      JSON.stringify(contract.plan.lineage.ancestorChatIds),
      now,
      now,
    )
    db.prepare(
      `INSERT INTO sub_chats (
        id, chat_id, harness, model, permission_mode, worktree_path, run_status, messages,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      subChatId,
      chatId,
      contract.plan.targetHarness,
      contract.plan.model ?? null,
      contract.plan.permission.mode,
      resolved.worktreePath,
      runId ? "pending" : null,
      initialMessages,
      now,
      now,
    )
    if (runId) {
      const runtimeSnapshot = constructRuntimeSnapshot(db, {
        chatId,
        harness: contract.plan.targetHarness,
        permission: runtimePermissionSnapshot(
          contract.plan.permission.mode,
          contract.plan.permission.customPermissions,
        ),
      })
      db.prepare(
        `INSERT INTO agent_runs (
          id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions, worktree_path,
          prompt_message_id, initial_prompt, runtime_snapshot_version, runtime_preference,
          runtime_preference_source, resolved_runtime, runtime_adapter_version,
          runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot,
          status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        runId,
        chatId,
        subChatId,
        contract.plan.targetHarness,
        contract.plan.model ?? null,
        contract.plan.permission.mode,
        contract.plan.permission.customPermissions
          ? JSON.stringify(contract.plan.permission.customPermissions)
          : null,
        resolved.worktreePath,
        promptMessageId,
        contract.plan.launch.initialPrompt,
        ...runtimeSnapshotSqlValues(runtimeSnapshot),
        now,
      )
    }
  })

  try {
    transaction()
  } catch (error) {
    return fail(
      "internal-error",
      error instanceof Error ? error.message : "Thread creation failed.",
    )
  }
  return {
    ok: true,
    data: {
      chatId,
      subChatId,
      ...(runId
        ? { runId, launch: { status: "pending" } }
        : { launch: { status: "not-requested" } }),
      lineage: contract.plan.lineage,
      worktreePath: resolved.worktreePath,
    },
  }
}

function parseAncestorChatIds(value: unknown): string[] | null {
  if (value == null) return []
  if (typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string" && id.length > 0)
      ? parsed
      : null
  } catch {
    return null
  }
}

type ResolvedSpawnTarget = {
  ok: true
  scope: string
  projectId: string | null
  taskId: string | null
  worktreePath: string | null
  branch: string | null
  baseBranch: string | null
}
type FailedSpawnTarget = {
  ok: false
  error: { code: McpControlErrorCode; message: string }
}

function resolveSpawnTarget(
  db: Database.Database,
  caller: McpCallerIdentity,
  plan: ThreadSpawnPlan,
): ResolvedSpawnTarget | FailedSpawnTarget {
  const callerScope = callerScopeForSpawn(db, caller.chatId)
  if (!callerScope) return spawnFail("stale-caller", "Caller chat is stale.")
  let projectId: string | null = null
  let taskId: string | null = null
  if (plan.scope.kind === "project") projectId = plan.scope.projectId
  if (plan.scope.kind === "task") {
    projectId = plan.scope.projectId
    taskId = plan.scope.taskId
    const task = db
      .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
      .get(taskId) as Row | undefined
    if (!task || task.project_id !== projectId)
      return spawnFail("stale-target", "Task is missing or stale.")
  }
  if (projectId) {
    const project = db
      .prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL")
      .get(projectId)
    if (!project) return spawnFail("stale-target", "Project is missing or stale.")
  }
  if (callerScope.taskId && taskId !== callerScope.taskId)
    return spawnFail("out-of-scope", "Thread is outside the caller task scope.")
  if (callerScope.projectId && projectId !== callerScope.projectId)
    return spawnFail("out-of-scope", "Thread is outside the caller project scope.")

  if (plan.worktree.strategy === "none")
    return {
      ok: true,
      scope: plan.scope.kind,
      projectId,
      taskId,
      worktreePath: null,
      branch: null,
      baseBranch: null,
    }
  const sourceId = plan.worktree.strategy === "inherit" ? caller.chatId : plan.worktree.worktreeId
  const source = db
    .prepare(
      `SELECT worktree_path, branch, base_branch, project_id, task_id
       FROM chats WHERE id = ? AND archived_at IS NULL`,
    )
    .get(sourceId) as Row | undefined
  if (!source || typeof source.worktree_path !== "string" || !source.worktree_path)
    return spawnFail("stale-target", "Requested worktree is missing or stale.")
  if (source.project_id !== projectId || source.task_id !== taskId)
    return spawnFail("out-of-scope", "Requested worktree is outside the target scope.")
  return {
    ok: true,
    scope: plan.scope.kind,
    projectId,
    taskId,
    worktreePath: source.worktree_path,
    branch: stringOrNull(source.branch),
    baseBranch: stringOrNull(source.base_branch),
  }
}

function callerScopeForSpawn(db: Database.Database, chatId: string): Scope | null {
  const row = db
    .prepare(
      "SELECT id, scope, project_id, task_id FROM chats WHERE id = ? AND archived_at IS NULL",
    )
    .get(chatId) as Row | undefined
  return row
    ? {
        chatId: String(row.id),
        kind: String(row.scope),
        projectId: stringOrNull(row.project_id),
        taskId: stringOrNull(row.task_id),
      }
    : null
}

function spawnFail(code: McpControlErrorCode, message: string): FailedSpawnTarget {
  return { ok: false, error: { code, message } }
}
function addAttachment(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.add_attachment>,
): McpControlResponse {
  const chat = target(db, scope, "chat", input.chatId)
  if (chat.archived_at) return fail("stale-target", "Chat is archived.")
  const existing = db
    .prepare("SELECT id FROM attachments WHERE chat_id = ? AND name = ? AND content_text = ?")
    .get(input.chatId, input.name, input.contentText) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const attachmentId = randomUUID()
  db.prepare(
    "INSERT INTO attachments (id, chat_id, task_id, kind, name, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    attachmentId,
    input.chatId,
    chat.task_id ?? null,
    input.kind,
    basename(input.name),
    input.contentText,
    nowEpochSeconds(),
  )
  return { ok: true, data: { id: attachmentId, created: true } }
}
function renameItem(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.rename_item>,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  if (current.name === input.name) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(`UPDATE ${table} SET name = ?, updated_at = unixepoch() WHERE id = ?`).run(
    input.name,
    input.id,
  )
  return { ok: true, data: { id: input.id, changed: true } }
}
function moveChat(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.move_chat>,
): McpControlResponse {
  target(db, scope, "chat", input.id)
  let projectId = input.projectId ?? null
  let taskId = input.taskId ?? null
  if (input.scope === "global") {
    projectId = null
    taskId = null
  }
  if (input.scope === "project" && !projectId)
    return fail("invalid-input", "Project move requires projectId.")
  if (input.scope === "task") {
    const task =
      taskId &&
      (db
        .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
        .get(taskId) as Row | undefined)
    if (!task) return fail("stale-target", "Task is missing or archived.")
    const taskProjectId = String(task.project_id)
    if (projectId && projectId !== taskProjectId)
      return fail("invalid-input", "Task does not belong to the requested project.")
    projectId = taskProjectId
  }
  if (
    (scope.taskId && (input.scope !== "task" || taskId !== scope.taskId)) ||
    (scope.projectId && projectId !== scope.projectId)
  )
    return fail("out-of-scope", "Move is outside caller scope.")
  db.prepare(
    "UPDATE chats SET scope = ?, project_id = ?, task_id = ?, updated_at = unixepoch() WHERE id = ?",
  ).run(input.scope, projectId, taskId, input.id)
  return { ok: true, data: { id: input.id, moved: true } }
}
function pinItem(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.pin_item>,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  const already = input.pinned ? current.pinned_at != null : current.pinned_at == null
  if (already) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(`UPDATE ${table} SET pinned_at = ?, updated_at = unixepoch() WHERE id = ?`).run(
    input.pinned ? nowEpochSeconds() : null,
    input.id,
  )
  return { ok: true, data: { id: input.id, changed: true } }
}
function setArchived(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.archive_item>,
  archived: boolean,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  const already = archived ? current.archived_at != null : current.archived_at == null
  if (already) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(`UPDATE ${table} SET archived_at = ?, updated_at = unixepoch() WHERE id = ?`).run(
    archived ? nowEpochSeconds() : null,
    input.id,
  )
  return { ok: true, data: { id: input.id, changed: true } }
}
async function writeAttachment(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.write_attachment_to_worktree>,
): Promise<McpControlResponse> {
  const attachment = db
    .prepare("SELECT * FROM attachments WHERE id = ?")
    .get(input.attachmentId) as Row | undefined
  if (!attachment) return fail("stale-target", "Attachment is missing.")
  const chat = target(db, scope, "chat", String(attachment.chat_id))
  const project = chat.project_id
    ? (db.prepare("SELECT path FROM projects WHERE id = ?").get(chat.project_id) as Row | undefined)
    : undefined
  const roots = [chat.worktree_path, project?.path]
    .filter((value): value is string => typeof value === "string")
    .map((value) => resolve(value))
  if (!roots.includes(resolve(input.worktreePath)))
    return fail("out-of-scope", "Worktree is not a known target for this attachment.")
  const source = stringOrNull(attachment.stored_path)
  const content = typeof attachment.content_text === "string" ? attachment.content_text : null
  if (!source && content === null) return fail("invalid-input", "Attachment has no content.")
  const registeredRoot = assertRegisteredWorktree(input.worktreePath)
  const storedData = source ? await readStoredAttachment(databasePathFromDb(db), source) : null
  const result = await writeFileInsideRoot(
    registeredRoot.canonicalPath,
    input.targetRelativePath ?? String(attachment.name),
    storedData ? { data: storedData } : { data: content! },
    { overwrite: input.overwrite },
  )
  return { ok: true, data: result }
}

async function readStoredAttachment(databasePath: string, storedPath: string): Promise<Buffer> {
  const rootPath = await realpath(resolve(dirname(dirname(databasePath)), "attachments"))
  const absolutePath = resolve(storedPath)
  const relativePath = relative(rootPath, absolutePath)
  if (
    !isAbsolute(storedPath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Attachment storage path is outside the durable attachment namespace")
  }
  return readFileInsideRoot(rootPath, relativePath)
}

function databasePathFromDb(db: Database.Database): string {
  return db.name
}
function fail(code: McpControlErrorCode, message: string): McpControlResponse {
  return { ok: false, error: { code, message } }
}
