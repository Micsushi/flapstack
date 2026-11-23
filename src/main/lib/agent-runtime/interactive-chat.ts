import type Database from "better-sqlite3"
import { antigravityPermissions } from "../../../shared/antigravity-permissions"
import { providerAccountSnapshotFromRow } from "../provider-accounts/snapshot"
import { randomUUID } from "node:crypto"
import {
  normalizeChatMode,
  resolveChatModePermission,
  type ChatMode,
} from "../../../shared/chat-mode"
import type { AgentHarness, RunPermissionMode } from "../../../shared/harness-types"
import type { ResolvedAgentRuntime, RuntimeAdapterProbe } from "../../../shared/agent-runtime"
import type { AgentRuntimePreference } from "../../../shared/agent-runtime"
import type { AgentActivityEvent } from "../../../shared/agent-activity"
import type { CodexThreadVisibility } from "../../../shared/codex-thread-visibility"
import {
  resolveAgentHotlineEnabled,
  stripInactiveAgentHotlineLabels,
} from "../../../shared/agent-hotline"
import { nowEpochSeconds } from "../db/timestamps"
import type { QueuedAgentRun } from "../run-launch-service"
import { createAgentActivityStore } from "./activity-store"
import {
  constructRuntimeSnapshot,
  resolvedLaunchFromSnapshotRow,
  runtimePermissionSnapshot,
  runtimeSnapshotSqlValues,
} from "./snapshot"
import {
  serializeProjectVaultRunSelection,
  type ProjectVaultGraphContextSelection,
} from "../project-vaults/run-context"

type InteractiveHarness = Extract<AgentHarness, "codex" | "claude-code" | "antigravity">

export type InteractiveRuntimeInput = {
  runId: string
  chatId: string
  subChatId: string
  harness: InteractiveHarness
  prompt: string
  images?: Array<{ base64Data: string; mediaType: string; filename?: string }>
  vaultContextGraphSelection?: ProjectVaultGraphContextSelection
  promptMessageId?: string
  model: string | null
  mode: ChatMode
  reasoningEffort: "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null
  reasoningEnabled: boolean
  codexThreadVisibility?: CodexThreadVisibility
  antigravityNativeApprovals?: boolean
  expectedRuntimePreference?: AgentRuntimePreference
}

type ChatRow = {
  chat_id: string
  chat_harness: string | null
  chat_model: string | null
  chat_permission_mode: string
  custom_permissions: string | null
  chat_worktree_path: string | null
  sub_chat_id: string
  sub_harness: string | null
  sub_model: string | null
  sub_permission_mode: string | null
  sub_worktree_path: string | null
  sub_session_id: string | null
  messages: string
  project_path: string | null
}

export function resolveInteractiveRuntime(
  database: Database.Database,
  input: Pick<InteractiveRuntimeInput, "chatId" | "subChatId" | "harness" | "model" | "mode"> &
    Partial<Pick<InteractiveRuntimeInput, "reasoningEffort" | "reasoningEnabled">>,
  adapterProbes?: Partial<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>>,
): {
  resolvedRuntime: ResolvedAgentRuntime
  runtimePreference: AgentRuntimePreference
  direct: boolean
} {
  const context = requireContext(database, input.chatId, input.subChatId, input.harness)
  const permissionMode = resolvePermissionMode(context, input.mode)
  const model = input.model?.trim() || context.sub_model || context.chat_model || null
  const snapshot = constructRuntimeSnapshot(database, {
    chatId: input.chatId,
    harness: input.harness,
    model,
    permission: runtimePermissionSnapshot(permissionMode, context.custom_permissions),
    controls: {
      modelEffort: input.reasoningEffort ?? null,
      modelThinking: input.reasoningEnabled ?? true,
      reasoningDisplay: input.reasoningEnabled ?? true,
    },
    adapterProbes,
  })
  assertRuntimeContinuationCompatible(
    database,
    context,
    snapshot.resolvedRuntime,
    snapshot.runtimePreference,
  )
  return {
    resolvedRuntime: snapshot.resolvedRuntime,
    runtimePreference: snapshot.runtimePreference,
    direct: input.harness === "antigravity" || snapshot.resolvedRuntime !== "flapstack-native",
  }
}

export function prepareInteractiveRuntimeLaunch(
  database: Database.Database,
  input: Pick<InteractiveRuntimeInput, "chatId" | "subChatId" | "harness" | "model" | "mode"> &
    Partial<Pick<InteractiveRuntimeInput, "reasoningEffort" | "reasoningEnabled">>,
  adapterProbes?: Partial<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>>,
  expectedRuntimePreference?: AgentRuntimePreference,
): {
  resolvedRuntime: ResolvedAgentRuntime
  runtimePreference: AgentRuntimePreference
  direct: boolean
} {
  return database
    .transaction(() => {
      const context = requireContext(database, input.chatId, input.subChatId, input.harness)
      const permissionMode = resolvePermissionMode(context, input.mode)
      const model = input.model?.trim() || context.sub_model || context.chat_model || null
      const snapshot = constructRuntimeSnapshot(database, {
        chatId: input.chatId,
        harness: input.harness,
        model,
        permission: runtimePermissionSnapshot(permissionMode, context.custom_permissions),
        controls: {
          modelEffort: input.reasoningEffort ?? null,
          modelThinking: input.reasoningEnabled ?? true,
          reasoningDisplay: input.reasoningEnabled ?? true,
        },
        adapterProbes,
      })
      assertRuntimeContinuationCompatible(
        database,
        context,
        snapshot.resolvedRuntime,
        snapshot.runtimePreference,
      )
      assertRuntimeSelectionUnchanged(expectedRuntimePreference, snapshot.runtimePreference)
      pinAutomaticRuntimePreference(database, input.chatId, snapshot.runtimePreference)
      return {
        resolvedRuntime: snapshot.resolvedRuntime,
        runtimePreference: snapshot.runtimePreference,
        direct: input.harness === "antigravity" || snapshot.resolvedRuntime !== "flapstack-native",
      }
    })
    .immediate()
}

export function materializeInteractiveRuntimeRun(
  database: Database.Database,
  input: InteractiveRuntimeInput,
  adapterProbes?: Partial<Record<ResolvedAgentRuntime, RuntimeAdapterProbe>>,
): QueuedAgentRun {
  return database
    .transaction((): QueuedAgentRun => {
      const context = requireContext(database, input.chatId, input.subChatId, input.harness)
      const permissionMode = resolvePermissionMode(context, input.mode)
      const model = input.model?.trim() || context.sub_model || context.chat_model || null
      const snapshot = constructRuntimeSnapshot(database, {
        chatId: input.chatId,
        harness: input.harness,
        model,
        permission: runtimePermissionSnapshot(permissionMode, context.custom_permissions),
        controls: {
          modelEffort: input.reasoningEffort,
          ...(input.harness === "antigravity"
            ? { antigravityNativeApprovals: input.antigravityNativeApprovals === true }
            : {}),
          modelThinking: input.reasoningEnabled,
          reasoningDisplay: input.reasoningEnabled,
        },
        adapterProbes,
      })
      assertRuntimeContinuationCompatible(
        database,
        context,
        snapshot.resolvedRuntime,
        snapshot.runtimePreference,
      )
      assertRuntimeSelectionUnchanged(input.expectedRuntimePreference, snapshot.runtimePreference)
      if (snapshot.resolvedRuntime === "flapstack-native" && input.harness !== "antigravity") {
        throw new Error("Interactive Runtime bridge received a Flapstack Native launch.")
      }

      const prompt = input.prompt.trim()
      if (!prompt) throw new Error("Runtime launch prompt is empty.")
      const promptMessageId = input.promptMessageId?.trim() || randomUUID()
      const mode = normalizeChatMode(input.mode)
      const worktreePath =
        context.sub_worktree_path ?? context.chat_worktree_path ?? context.project_path ?? null
      const now = nowEpochSeconds()
      const existing = database
        .prepare("SELECT id, status FROM agent_runs WHERE id = ?")
        .get(input.runId) as { id: string; status: string } | undefined
      if (existing) {
        throw new Error(`Runtime run ${input.runId} is already ${existing.status}.`)
      }
      const active = database
        .prepare(
          `SELECT id FROM agent_runs
           WHERE sub_chat_id = ? AND status IN ('pending','running') LIMIT 1`,
        )
        .get(input.subChatId) as { id: string } | undefined
      if (active) throw new Error("This Chat already has an active Runtime run.")

      pinAutomaticRuntimePreference(database, input.chatId, snapshot.runtimePreference)

      const messages = parseMessages(context.messages)
      if (!messages.some((message) => message.id === promptMessageId)) {
        messages.push({
          id: promptMessageId,
          role: "user",
          parts: [{ type: "text", text: prompt }],
          metadata: { harness: input.harness, ...(model ? { model } : {}) },
        })
      }
      const hotlineEnabled = resolveAgentHotlineEnabled(messages)

      database
        .prepare(
          `INSERT INTO agent_runs (
             id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
             worktree_path, prompt_message_id, initial_prompt, vault_context_sections,
             runtime_snapshot_version,
             runtime_preference, runtime_preference_source, resolved_runtime,
             runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
             runtime_control_snapshot, provider_account_id, provider_auth_mode,
             provider_runtime_target, provider_credential_revision, status, started_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
        )
        .run(
          input.runId,
          input.chatId,
          input.subChatId,
          input.harness,
          model,
          permissionMode,
          permissionMode === "custom" ? context.custom_permissions : null,
          worktreePath,
          promptMessageId,
          prompt,
          input.vaultContextGraphSelection
            ? serializeProjectVaultRunSelection({
                sectionIds: [],
                graph: input.vaultContextGraphSelection,
              })
            : null,
          ...runtimeSnapshotSqlValues(snapshot),
          now,
        )
      database
        .prepare(
          `UPDATE sub_chats
           SET harness = ?, model = ?, worktree_path = ?, mode = ?,
               run_status = 'running', messages = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.harness,
          model,
          worktreePath,
          mode,
          JSON.stringify(messages),
          now,
          input.subChatId,
        )
      const launch = resolvedLaunchFromSnapshotRow({
        harness: input.harness,
        model,
        permission_mode: permissionMode,
        custom_permissions: permissionMode === "custom" ? context.custom_permissions : null,
        runtime_snapshot_version: snapshot.runtimeSnapshotVersion,
        runtime_preference: snapshot.runtimePreference,
        runtime_preference_source: snapshot.runtimePreferenceSource,
        resolved_runtime: snapshot.resolvedRuntime,
        runtime_adapter_version: snapshot.runtimeAdapterVersion,
        runtime_protocol_version: snapshot.runtimeProtocolVersion,
        runtime_capability_snapshot: snapshot.runtimeCapabilitySnapshot,
        runtime_control_snapshot: snapshot.runtimeControlSnapshot,
      })
      return {
        runId: input.runId,
        chatId: input.chatId,
        subChatId: input.subChatId,
        harness: input.harness,
        prompt,
        images: input.images,
        chatMode: mode,
        hotlineEnabled,
        model,
        reasoningEffort: queuedReasoningEffort(input.reasoningEffort),
        permissionMode,
        customPermissions: permissionMode === "custom" ? context.custom_permissions : null,
        worktreePath,
        projectPath: context.project_path,
        codexThreadVisibility: input.codexThreadVisibility ?? "hidden",
        interactiveChat: true,
        runtimeLaunch: launch,
        providerAccount: providerAccountSnapshotFromRow({ ...snapshot, harness: input.harness }),
      }
    })
    .immediate()
}

export function assertRuntimeSelectionUnchanged(
  expected: AgentRuntimePreference | undefined,
  actual: AgentRuntimePreference,
): void {
  if (expected !== undefined && expected !== actual) {
    throw new Error(
      "This chat's runtime selection changed before launch. Send again to use the current selection.",
    )
  }
}

function pinAutomaticRuntimePreference(
  database: Database.Database,
  chatId: string,
  preference: AgentRuntimePreference,
): void {
  database
    .prepare(
      `UPDATE chats
       SET runtime_preference = ?, updated_at = ?
       WHERE id = ? AND COALESCE(runtime_preference, 'auto') = 'auto'`,
    )
    .run(preference, nowEpochSeconds(), chatId)
}

export function loadInteractiveRuntimeAssistantText(
  database: Database.Database,
  runId: string,
): string {
  return loadInteractiveRuntimeAssistantParts(database, runId)
    .map((part) => part.text)
    .join("")
}

type RuntimeReplyPart = {
  type: "text"
  text: string
  providerMetadata?: { runtime: { phase: string } }
}

export function loadInteractiveRuntimeAssistantParts(
  database: Database.Database,
  runId: string,
): RuntimeReplyPart[] {
  const store = createAgentActivityStore(database)
  const parts: RuntimeReplyPart[] = []
  const codexDeltas = new Map<string, string[]>()
  let cursor: number | undefined
  do {
    const page = store.query({
      runId,
      kinds: ["agent-text"],
      afterStorageId: cursor,
      direction: "forward",
      limit: 500,
      corruptionMode: "redacted-placeholder",
    })
    for (const event of page.events) {
      if (
        event.kind !== "agent-text" ||
        event.privacyClass === "private" ||
        event.privacyClass === "encrypted"
      )
        continue
      const item = event.harness === "codex" ? event.providerItemId : null
      if (event.phase === "delta" && item) {
        const deltas = codexDeltas.get(item) ?? []
        deltas.push(event.payload.text)
        codexDeltas.set(item, deltas)
      }
      if (event.phase !== "completed") continue
      const streamed = item ? codexDeltas.get(item)?.join("") : undefined
      if (item) codexDeltas.delete(item)
      const text = streamed?.startsWith(event.payload.text) ? streamed : event.payload.text
      if (!text) continue
      parts.push({
        type: "text",
        text,
        ...(event.sectionBoundary === "commentary" || event.sectionBoundary === "final_answer"
          ? { providerMetadata: { runtime: { phase: event.sectionBoundary } } }
          : {}),
      })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return parts
}

export function persistInteractiveRuntimeAssistantFallback(
  database: Database.Database,
  runId: string,
  assistantText: string | RuntimeReplyPart[],
): void {
  const parts: RuntimeReplyPart[] =
    typeof assistantText === "string"
      ? [{ type: "text", text: assistantText.trim() }]
      : assistantText
  if (!parts.some((part) => part.text.trim())) return
  const reply = database
    .transaction(() => {
      const row = database
        .prepare(
          `SELECT r.chat_id chat_id, r.sub_chat_id sub_chat_id, r.resolved_runtime resolved_runtime, r.harness harness,
                  r.started_at started_at, r.completed_at completed_at, r.prompt_message_id prompt_message_id,
                  s.messages messages
           FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id
           WHERE r.id = ?`,
        )
        .get(runId) as
        | {
            chat_id: string
            sub_chat_id: string
            resolved_runtime: string
            harness: string
            started_at: number | null
            completed_at: number | null
            prompt_message_id: string | null
            messages: string
          }
        | undefined
      if (!row) return
      const messages = parseMessages(row.messages)
      const hotline = resolveAgentHotlineEnabled(messages)
      const replyParts = parts.map((part) => ({
        ...part,
        text: stripInactiveAgentHotlineLabels(part.text, hotline),
      }))
      const existing = messages.find((message) => {
        const metadata = message.metadata
        return (
          message.role === "assistant" &&
          metadata != null &&
          typeof metadata === "object" &&
          (metadata as { runId?: unknown }).runId === runId
        )
      })
      const messageId = typeof existing?.id === "string" ? existing.id : `reply-${runId}`
      const voiceReply = {
        chatId: row.chat_id,
        subChatId: row.sub_chat_id,
        messageId,
        text: replyParts
          .filter((part) => part.providerMetadata?.runtime.phase !== "commentary")
          .map((part) => part.text)
          .join("\n"),
      }
      if (existing) return voiceReply
      const promptIndex = messages.findIndex((message) => message.id === row.prompt_message_id)
      const nextUser =
        promptIndex < 0
          ? -1
          : messages.findIndex((message, index) => index > promptIndex && message.role === "user")
      messages.splice(nextUser < 0 ? messages.length : nextUser, 0, {
        id: messageId,
        role: "assistant",
        parts: replyParts,
        metadata: {
          runId,
          transport: `${row.harness === "antigravity" ? row.harness : row.resolved_runtime}-runtime`,
          ...(row.started_at != null && row.completed_at != null
            ? { durationMs: Math.max(0, row.completed_at - row.started_at) * 1_000 }
            : {}),
        },
      })
      database
        .prepare("UPDATE sub_chats SET messages = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(messages), nowEpochSeconds(), row.sub_chat_id)
      return voiceReply
    })
    .immediate()
  if (reply?.text.trim() && process.type === "browser") {
    // The outer lifecycle transaction finishes before this asynchronous read.
    // Validate durable identity again before preparing audio in the installed profile.
    const source = database.name
    void import("../speech/prepare")
      .then(({ prepareStoredReply }) => prepareStoredReply(source, reply))
      .catch((error) => console.error("[Speech] Could not prepare completed reply:", error))
  }
}

export function loadInteractiveRuntimeActivity(
  database: Database.Database,
  runId: string,
  afterStorageId = 0,
): { cursor: number; events: AgentActivityEvent[] } {
  const page = createAgentActivityStore(database).query({
    runId,
    ...(afterStorageId > 0 ? { afterStorageId } : {}),
    limit: 500,
    direction: "forward",
    corruptionMode: "redacted-placeholder",
  })
  return {
    cursor: page.events.at(-1)?.storageId ?? afterStorageId,
    events: page.events,
  }
}

function requireContext(
  database: Database.Database,
  chatId: string,
  subChatId: string,
  harness: InteractiveHarness,
): ChatRow {
  const row = database
    .prepare(
      `SELECT c.id chat_id, c.harness chat_harness, c.model chat_model,
              c.permission_mode chat_permission_mode, c.custom_permissions,
              c.worktree_path chat_worktree_path,
              s.id sub_chat_id, s.harness sub_harness, s.model sub_model,
              s.permission_mode sub_permission_mode, s.worktree_path sub_worktree_path,
              s.session_id sub_session_id,
              s.messages, p.path project_path
       FROM chats c
       JOIN sub_chats s ON s.chat_id = c.id
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ? AND s.id = ?`,
    )
    .get(chatId, subChatId) as ChatRow | undefined
  if (!row) throw new Error("Runtime Chat or conversation is missing.")
  const persistedHarness = row.sub_harness ?? row.chat_harness
  if (persistedHarness && persistedHarness !== harness) {
    throw new Error(`Runtime Chat uses ${persistedHarness}, not ${harness}.`)
  }
  return row
}

function assertRuntimeContinuationCompatible(
  database: Database.Database,
  context: ChatRow,
  resolvedRuntime: ResolvedAgentRuntime,
  runtimePreference: AgentRuntimePreference,
): void {
  if (!context.sub_session_id || resolvedRuntime === "flapstack-native") return
  const latest = database
    .prepare(
      `SELECT resolved_runtime, runtime_preference FROM agent_runs
       WHERE sub_chat_id = ?
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(context.sub_chat_id) as
    { resolved_runtime: string | null; runtime_preference: string | null } | undefined
  const previousRuntime = latest?.resolved_runtime ?? "flapstack-native"
  const previousPreference = latest?.runtime_preference ?? previousRuntime
  if (previousRuntime === resolvedRuntime && previousPreference === runtimePreference) return
  throw new Error(
    `This Chat already has a ${previousPreference} provider session. Start a new Chat to use ${runtimePreference}; provider sessions cannot switch Runtime behavior in place.`,
  )
}

function resolvePermissionMode(context: ChatRow, mode: ChatMode): RunPermissionMode {
  const requested = (context.sub_permission_mode ??
    context.chat_permission_mode) as RunPermissionMode
  const permission = resolveChatModePermission(normalizeChatMode(mode), requested)
  if ((context.sub_harness ?? context.chat_harness) === "antigravity") {
    const preview = antigravityPermissions(permission)
    if (!preview.applied) throw new Error(preview.reason)
  }
  return permission
}

function parseMessages(value: string): Array<Record<string, unknown> & { id?: unknown }> {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown> & { id?: unknown }>)
      : []
  } catch {
    return []
  }
}

function queuedReasoningEffort(
  value: InteractiveRuntimeInput["reasoningEffort"],
): QueuedAgentRun["reasoningEffort"] {
  return value
}
