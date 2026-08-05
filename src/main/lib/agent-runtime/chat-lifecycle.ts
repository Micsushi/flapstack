import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  runtimeAdapterForPreference,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type RuntimeAdapterProbe,
} from "../../../shared/agent-runtime"
import type { RunPermissionMode } from "../../../shared/harness-types"
import {
  parseCustomPermissionCapabilities,
  type CustomPermissionCapabilities,
} from "../../../shared/permission-capabilities"
import {
  executionTargetSchema,
  type DelegationAuthorityCeiling,
  type ExecutionTarget,
  type RuntimeCompositionPreview,
} from "../../../shared/runtime-composition"
import type { HandoffMessage } from "../chat-handoff"
import { millisecondsToEpochSeconds } from "../db/timestamps"
import { isProductMcpEnabledByDefault } from "../mcp-control/exposure"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "./compatibility"
import {
  buildVisibleContextManifest,
  canonicalJson,
  createRuntimeCompositionPreview,
  sha256,
} from "./context-manifest"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export class RuntimeChatLifecycleError extends Error {
  constructor(
    readonly code:
      | "chat-missing"
      | "chat-archived"
      | "active-run"
      | "chat-started"
      | "chat-empty"
      | "runtime-incompatible"
      | "continuation-conflict"
      | "preview-mismatch"
      | "history-too-large",
    message: string,
  ) {
    super(message)
    this.name = "RuntimeChatLifecycleError"
  }
}

export type RuntimeContinuationResult = {
  chatId: string
  subChatId: string
  sourceChatId: string
  runtimePreference: AgentRuntimePreference
  created: boolean
  diagnostic: {
    kind: "runtime-continuation"
    sourceChatId: string
    targetChatId: string
    targetHarness: string
    targetModel: string | null
    runtimePreference: AgentRuntimePreference
    visibleMessageCount: number
    contextManifestDigest: string
    previewDigest: string
  }
}

export type RuntimeContinuationInput = {
  sourceChatId: string
  targetHarness?: string
  targetModel?: string
  preference: AgentRuntimePreference
  requestId: string
  name?: string | null
  selectedMessageIds?: string[]
  selectedFileRefs?: string[]
  selectedArtifactRefs?: string[]
  confirmedPreviewDigest?: string
  mode?: "continue" | "delegate"
  objective?: string
  requiredCapabilities?: string[]
  outputSchema?: Record<string, unknown> | null
}

export type RuntimeContinuationPreview = RuntimeCompositionPreview & {
  contextText: string
  visibleMessageCount: number
}

export class RuntimeChatLifecycleService {
  private readonly sqlite: Sqlite

  constructor(
    database: DatabaseLike,
    private readonly resolveProbe: (
      harness: string,
      runtime: ResolvedAgentRuntime,
    ) => RuntimeAdapterProbe | null = () => null,
  ) {
    this.sqlite = rawClient(database)
  }

  targetIdentity(input: RuntimeContinuationInput): {
    harness: string
    runtime: ResolvedAgentRuntime
  } {
    const source = this.requireChat(input.sourceChatId)
    const harness = input.targetHarness?.trim() || String(source.harness ?? "generic")
    return {
      harness,
      runtime: runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(harness),
    }
  }

  preferenceIdentity(input: { chatId: string; preference: AgentRuntimePreference }): {
    harness: string
    runtime: ResolvedAgentRuntime
  } {
    const chat = this.requireChat(input.chatId)
    const harness = String(chat.harness ?? "generic")
    return {
      harness,
      runtime: runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(harness),
    }
  }

  setEmptyChatPreference(input: { chatId: string; preference: AgentRuntimePreference }): {
    chatId: string
    runtimePreference: AgentRuntimePreference
  } {
    return this.sqlite
      .transaction(() => {
        const chat = this.requireChat(input.chatId)
        this.assertNoActiveRun(input.chatId)
        if (this.hasProviderIntent(input.chatId)) {
          throw new RuntimeChatLifecycleError(
            "chat-started",
            "Started chats cannot change Runtime in place. Continue with the selected Runtime instead.",
          )
        }
        const harness = String(chat.harness ?? "generic")
        const runtime =
          runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(harness)
        assertCompatible(harness, input.preference, this.resolveProbe(harness, runtime), true)
        this.sqlite
          .prepare("UPDATE chats SET runtime_preference = ?, updated_at = ? WHERE id = ?")
          .run(input.preference, millisecondsToEpochSeconds(Date.now()), input.chatId)
        return { chatId: input.chatId, runtimePreference: input.preference }
      })
      .immediate()
  }

  previewContinuation(input: RuntimeContinuationInput): RuntimeContinuationPreview {
    const source = this.requireChat(input.sourceChatId)
    this.assertNoActiveRun(input.sourceChatId)
    if (!this.hasProviderIntent(input.sourceChatId)) {
      throw new RuntimeChatLifecycleError(
        "chat-empty",
        "This chat has no provider turn. Change its Runtime in place instead.",
      )
    }
    const sourceHarness = String(source.harness ?? "generic")
    const targetHarness = input.targetHarness?.trim() || sourceHarness
    const targetRuntime =
      runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(targetHarness)
    const targetProbe = this.resolveProbe(targetHarness, targetRuntime)
    assertCompatible(targetHarness, input.preference, targetProbe)
    const targetModel =
      input.targetModel?.trim() ||
      (targetHarness === sourceHarness ? stringOrNull(source.model) : null)
    const conversations = this.sourceConversations(input.sourceChatId)
    const exported = buildVisibleContextManifest({
      sourceChatId: input.sourceChatId,
      sourceRunId: latestRunId(this.sqlite, input.sourceChatId),
      conversations,
      selection: {
        messageIds: input.selectedMessageIds,
        fileRefs: input.selectedFileRefs,
        artifactRefs: input.selectedArtifactRefs,
      },
    })
    const targetSnapshot = executionTarget(
      this.sqlite,
      source,
      {
        targetHarness,
        targetModel,
        preference: input.preference,
      },
      this.resolveProbe,
    )
    const requiredCapabilities = [
      ...new Set([
        input.mode === "delegate" ? "delegation" : "continuation",
        ...(input.requiredCapabilities ?? []),
        ...(input.outputSchema ? ["structuredOutput"] : []),
      ]),
    ]
    const missing = requiredCapabilities.filter(
      (capability) => targetSnapshot.capabilities.capabilities[capability] !== "available",
    )
    const unavailableReason =
      targetProbe && !targetProbe.available
        ? (targetProbe.reason ?? targetProbe.capabilities.unavailableReason)
        : null
    const availability = unavailableReason
      ? {
          state: "blocked" as const,
          reason: unavailableReason.message,
          repair: unavailableReason.repair,
        }
      : missing.length > 0
        ? {
            state: "blocked" as const,
            reason: `Target lacks required capabilities: ${missing.join(", ")}.`,
            repair: "Probe a compatible target that advertises every required capability.",
          }
        : worktreeAvailability(this.sqlite, source)
    const preview = createRuntimeCompositionPreview({
      mode: input.mode,
      objective: input.objective,
      requiredCapabilities,
      outputSchema: input.outputSchema,
      targetSnapshot,
      visibleContextManifest: exported.manifest,
      authorityCeiling: authorityCeiling(this.sqlite, source, targetSnapshot),
      worktreeLease: worktreeLease(source),
      availability,
    })
    return {
      ...preview,
      contextText: exported.contextText,
      visibleMessageCount: exported.manifest.selected.length,
    }
  }

  continueWithRuntime(input: RuntimeContinuationInput): RuntimeContinuationResult {
    return this.sqlite
      .transaction(() => {
        const source = this.requireChat(input.sourceChatId)
        this.assertNoActiveRun(input.sourceChatId)
        if (!this.hasProviderIntent(input.sourceChatId)) {
          throw new RuntimeChatLifecycleError(
            "chat-empty",
            "This chat has no provider turn. Change its Runtime in place instead.",
          )
        }
        const sourceHarness = String(source.harness ?? "generic")
        const targetHarness = input.targetHarness?.trim() || sourceHarness
        const targetRuntime =
          runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(targetHarness)
        assertCompatible(
          targetHarness,
          input.preference,
          this.resolveProbe(targetHarness, targetRuntime),
        )
        const targetModel =
          input.targetModel?.trim() ||
          (targetHarness === sourceHarness ? stringOrNull(source.model) : null)
        const preview = this.previewContinuation({
          ...input,
          targetHarness,
          ...(targetModel ? { targetModel } : {}),
        })
        const crossesProviderBoundary = sourceHarness !== targetHarness
        if (
          crossesProviderBoundary &&
          (!input.confirmedPreviewDigest || input.confirmedPreviewDigest !== preview.digest)
        ) {
          throw new RuntimeChatLifecycleError(
            "preview-mismatch",
            "Cross-provider continuation requires confirmation of the exact current preview.",
          )
        }
        if (input.confirmedPreviewDigest && input.confirmedPreviewDigest !== preview.digest) {
          throw new RuntimeChatLifecycleError(
            "preview-mismatch",
            "Runtime continuation preview changed. Review the exact target and context again.",
          )
        }
        if (preview.availability.state !== "available") {
          throw new RuntimeChatLifecycleError(
            "preview-mismatch",
            preview.availability.reason ?? "Runtime continuation target is unavailable.",
          )
        }
        const ids = continuationIds(input.sourceChatId, input.requestId)
        const existing = this.sqlite.prepare("SELECT * FROM chats WHERE id = ?").get(ids.chatId) as
          Row | undefined
        if (existing) {
          return this.existingContinuation(
            existing,
            ids.subChatId,
            {
              ...input,
              targetHarness,
              targetModel: targetModel ?? undefined,
            },
            preview,
          )
        }

        const sourceConversations = this.sqlite
          .prepare("SELECT * FROM sub_chats WHERE chat_id = ? ORDER BY created_at, id")
          .all(input.sourceChatId) as Row[]
        const sourceConversation = sourceConversations[0]
        if (!sourceConversation) {
          throw new RuntimeChatLifecycleError("chat-empty", "Source conversation is missing.")
        }
        if (Buffer.byteLength(preview.contextText) > 1_000_000) {
          throw new RuntimeChatLifecycleError(
            "history-too-large",
            "Visible history exceeds the one-megabyte continuation limit.",
          )
        }
        const ancestorIds = parseIds(source.ancestor_chat_ids)
        if (ancestorIds.includes(input.sourceChatId)) {
          throw new RuntimeChatLifecycleError(
            "continuation-conflict",
            "Source chat lineage is corrupt.",
          )
        }
        const now = millisecondsToEpochSeconds(Date.now())
        const name =
          input.name?.trim() ||
          `${String(source.name ?? "Chat")} · ${runtimeLabel(input.preference)}`
        this.sqlite
          .prepare(
            `INSERT INTO chats (
            id, name, project_id, task_id, scope, permission_mode, custom_permissions,
            mcp_exposure_enabled, harness, model, runtime_preference, parent_chat_id, initiator_chat_id,
            parent_run_id, ancestor_chat_ids, worktree_path, branch, base_branch,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ids.chatId,
            name,
            source.project_id ?? null,
            source.task_id ?? null,
            source.scope,
            source.permission_mode,
            source.custom_permissions ?? null,
            isProductMcpEnabledByDefault(targetHarness) ? 1 : 0,
            targetHarness,
            targetModel,
            input.preference,
            input.sourceChatId,
            source.initiator_chat_id ?? input.sourceChatId,
            latestRunId(this.sqlite, input.sourceChatId),
            JSON.stringify([...ancestorIds, input.sourceChatId]),
            source.worktree_path ?? null,
            source.branch ?? null,
            source.base_branch ?? null,
            now,
            now,
          )
        const contextMessage = {
          id: `runtime-context-${ids.digest.slice(0, 16)}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: preview.contextText,
            },
          ],
          metadata: {
            kind: "runtime-continuation-context",
            sourceChatId: input.sourceChatId,
            targetHarness,
            runtimePreference: input.preference,
            executionTarget: preview.targetSnapshot,
            visibleContextManifest: preview.visibleContextManifest,
            previewDigest: preview.digest,
          },
        }
        this.sqlite
          .prepare(
            `INSERT INTO sub_chats (
            id, chat_id, name, mode, harness, model, permission_mode, worktree_path,
            run_status, messages, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
          )
          .run(
            ids.subChatId,
            ids.chatId,
            name,
            sourceConversation.mode ?? "write",
            targetHarness,
            targetModel,
            sourceConversation.permission_mode ?? source.permission_mode,
            sourceConversation.worktree_path ?? source.worktree_path ?? null,
            JSON.stringify([contextMessage]),
            now,
            now,
          )
        return result(
          ids.chatId,
          ids.subChatId,
          { ...input, targetHarness, targetModel: targetModel ?? undefined },
          preview,
          true,
        )
      })
      .immediate()
  }

  undoContinuation(input: { sourceChatId: string; targetChatId: string }): boolean {
    return this.sqlite
      .transaction(() => {
        const target = this.requireChat(input.targetChatId)
        if (target.parent_chat_id !== input.sourceChatId) {
          throw new RuntimeChatLifecycleError(
            "continuation-conflict",
            "Target chat is not a Runtime continuation of the source.",
          )
        }
        this.assertNoActiveRun(input.targetChatId)
        if (this.hasProviderIntent(input.targetChatId)) {
          throw new RuntimeChatLifecycleError(
            "chat-started",
            "A Runtime continuation cannot be undone after provider work starts.",
          )
        }
        this.sqlite
          .prepare("UPDATE chats SET archived_at = ?, updated_at = ? WHERE id = ?")
          .run(
            millisecondsToEpochSeconds(Date.now()),
            millisecondsToEpochSeconds(Date.now()),
            input.targetChatId,
          )
        return true
      })
      .immediate()
  }

  private requireChat(chatId: string): Row {
    const chat = this.sqlite.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as
      Row | undefined
    if (!chat) throw new RuntimeChatLifecycleError("chat-missing", "Runtime chat is missing.")
    if (chat.archived_at !== null && chat.archived_at !== undefined) {
      throw new RuntimeChatLifecycleError("chat-archived", "Runtime chat is archived.")
    }
    return chat
  }

  private assertNoActiveRun(chatId: string): void {
    const active = this.sqlite
      .prepare(
        "SELECT id FROM agent_runs WHERE chat_id = ? AND status IN ('pending', 'running') LIMIT 1",
      )
      .get(chatId)
    if (active) {
      throw new RuntimeChatLifecycleError(
        "active-run",
        "Runtime cannot change while the chat has an active run.",
      )
    }
  }

  private hasProviderIntent(chatId: string): boolean {
    const run = this.sqlite
      .prepare("SELECT id FROM agent_runs WHERE chat_id = ? LIMIT 1")
      .get(chatId)
    if (run) return true
    const rows = this.sqlite
      .prepare("SELECT session_id, stream_id, messages FROM sub_chats WHERE chat_id = ?")
      .all(chatId) as Row[]
    return rows.some((row) => {
      if (row.session_id || row.stream_id) return true
      return parseMessages(row.messages).some((message) => message.role === "assistant")
    })
  }

  private existingContinuation(
    existing: Row,
    subChatId: string,
    input: {
      sourceChatId: string
      targetHarness?: string
      targetModel?: string
      preference: AgentRuntimePreference
    },
    preview: RuntimeContinuationPreview,
  ): RuntimeContinuationResult {
    if (
      existing.parent_chat_id !== input.sourceChatId ||
      String(existing.harness ?? "generic") !==
        (input.targetHarness?.trim() || String(existing.harness ?? "generic")) ||
      stringOrNull(existing.model) !==
        (input.targetModel?.trim() || stringOrNull(existing.model)) ||
      existing.runtime_preference !== input.preference ||
      existing.archived_at !== null
    ) {
      throw new RuntimeChatLifecycleError(
        "continuation-conflict",
        "Continuation request identity is already bound to different state.",
      )
    }
    const messages = this.sqlite
      .prepare("SELECT messages FROM sub_chats WHERE id = ? AND chat_id = ?")
      .get(subChatId, existing.id) as Row | undefined
    if (!messages) {
      throw new RuntimeChatLifecycleError(
        "continuation-conflict",
        "Continuation transaction is incomplete.",
      )
    }
    const contextMetadata = continuationContextMetadata(messages.messages)
    if (!contextMetadata || contextMetadata.previewDigest !== preview.digest) {
      throw new RuntimeChatLifecycleError(
        "continuation-conflict",
        "Continuation request identity is already bound to a different target or context manifest.",
      )
    }
    return result(
      String(existing.id),
      subChatId,
      {
        ...input,
        targetHarness: input.targetHarness?.trim() || String(existing.harness ?? "generic"),
      },
      preview,
      false,
    )
  }

  private sourceConversations(chatId: string) {
    const rows = this.sqlite
      .prepare("SELECT * FROM sub_chats WHERE chat_id = ? ORDER BY created_at, id")
      .all(chatId) as Row[]
    if (rows.length === 0) {
      throw new RuntimeChatLifecycleError("chat-empty", "Source conversation is missing.")
    }
    return rows.map((conversation) => ({
      subChatId: String(conversation.id),
      subChatName: stringOrNull(conversation.name),
      messages: parseMessages(conversation.messages),
    }))
  }
}

export function createRuntimeChatLifecycleService(
  database: DatabaseLike,
  resolveProbe?: (harness: string, runtime: ResolvedAgentRuntime) => RuntimeAdapterProbe | null,
): RuntimeChatLifecycleService {
  return new RuntimeChatLifecycleService(database, resolveProbe)
}

function assertCompatible(
  harness: string,
  preference: AgentRuntimePreference,
  probe?: RuntimeAdapterProbe | null,
  requireAvailable = false,
): void {
  const runtime = runtimeAdapterForPreference(preference) ?? productRuntimeForHarness(harness)
  const exactProbe = probe?.harness === harness && probe.runtime === runtime ? probe : null
  const nativeCompatibility = checkRuntimeCompatibility(harness, runtime)
  if (nativeCompatibility.compatible) return
  if (!exactProbe || (requireAvailable && !exactProbe.available)) {
    throw new RuntimeChatLifecycleError(
      "runtime-incompatible",
      exactProbe?.reason?.message ?? nativeCompatibility.reason.message,
    )
  }
  const compatibility = checkRuntimeCompatibility(
    harness,
    runtime,
    exactProbe?.capabilities.composition,
  )
  if (!compatibility.compatible) {
    throw new RuntimeChatLifecycleError("runtime-incompatible", compatibility.reason.message)
  }
}

function continuationIds(sourceChatId: string, requestId: string) {
  const digest = createHash("sha256").update(`${sourceChatId}\0${requestId}`).digest("hex")
  return {
    digest,
    chatId: `runtime-continuation-${digest.slice(0, 32)}`,
    subChatId: `runtime-conversation-${digest.slice(0, 32)}`,
  }
}

function latestRunId(sqlite: Sqlite, chatId: string): string | null {
  const row = sqlite
    .prepare(
      "SELECT id FROM agent_runs WHERE chat_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    )
    .get(chatId) as { id: string } | undefined
  return row?.id ?? null
}

function parseMessages(value: unknown): HandoffMessage[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((message): message is HandoffMessage =>
          Boolean(message && typeof message === "object" && "role" in message),
        )
      : []
  } catch {
    return []
  }
}

function parseIds(value: unknown): string[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : []
  } catch {
    return []
  }
}

function result(
  chatId: string,
  subChatId: string,
  input: {
    sourceChatId: string
    targetHarness?: string
    targetModel?: string
    preference: AgentRuntimePreference
  },
  preview: RuntimeContinuationPreview,
  created: boolean,
): RuntimeContinuationResult {
  return {
    chatId,
    subChatId,
    sourceChatId: input.sourceChatId,
    runtimePreference: input.preference,
    created,
    diagnostic: {
      kind: "runtime-continuation",
      sourceChatId: input.sourceChatId,
      targetChatId: chatId,
      targetHarness: input.targetHarness?.trim() || "generic",
      targetModel: input.targetModel?.trim() || null,
      runtimePreference: input.preference,
      visibleMessageCount: preview.visibleMessageCount,
      contextManifestDigest: preview.visibleContextManifest.digest,
      previewDigest: preview.digest,
    },
  }
}

function continuationContextMetadata(value: unknown): { previewDigest: string } | null {
  const messages = parseMessages(value)
  for (const message of messages) {
    if (message.metadata?.kind !== "runtime-continuation-context") continue
    const previewDigest = message.metadata.previewDigest
    return typeof previewDigest === "string" ? { previewDigest } : null
  }
  return null
}

function executionTarget(
  sqlite: Sqlite,
  source: Row,
  input: {
    targetHarness: string
    targetModel: string | null
    preference: AgentRuntimePreference
  },
  resolveProbe: (harness: string, runtime: ResolvedAgentRuntime) => RuntimeAdapterProbe | null,
): ExecutionTarget {
  const runtime =
    runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(input.targetHarness)
  const probe = resolveProbe(input.targetHarness, runtime)
  const matchedProbe =
    probe?.harness === input.targetHarness && probe.runtime === runtime ? probe : null
  const composition = matchedProbe?.capabilities.composition
  const runtimeMode =
    composition?.runtimeMode === "translated"
      ? "translated"
      : runtime === "flapstack-native"
        ? "flapstack-native"
        : input.preference.endsWith("-enhanced")
          ? "enhanced"
          : "native"
  const profile =
    input.targetHarness === String(source.harness)
      ? readAgentProfileBinding(sqlite, String(source.id))
      : null
  const capabilities = {
    schemaVersion: 1 as const,
    capabilities: {
      ...executionCapabilities(matchedProbe),
      ...(composition?.capabilities ?? {}),
    },
  }
  const permissionMode = String(source.permission_mode) as RunPermissionMode
  const customPermissions =
    permissionMode === "custom" ? parseStoredCustomPermissions(source.custom_permissions) : null
  return executionTargetSchema.parse({
    schemaVersion: 1,
    harness: input.targetHarness,
    runtime,
    runtimeMode,
    adapterChain: composition?.adapterChain ?? [],
    provider: providerForHarness(input.targetHarness),
    model: input.targetModel,
    accountId: null,
    agentProfile: profile,
    permission: {
      mode: permissionMode,
      customPermissions,
    },
    workspace: {
      projectId: stringOrNull(source.project_id),
      rootPath: projectPath(sqlite, source.project_id),
      worktreePath: stringOrNull(source.worktree_path),
      branch: stringOrNull(source.branch),
    },
    capabilities: {
      ...capabilities,
      fingerprint: sha256(
        canonicalJson({
          ...capabilities,
          versions: matchedProbe?.versions ?? null,
          available: matchedProbe?.available ?? false,
        }),
      ),
    },
    losses:
      composition?.losses ??
      (matchedProbe?.capabilities.limitations ?? []).slice(0, 64).map((summary, index) => ({
        code: `runtime-probe-${index + 1}`,
        summary,
      })),
  })
}

function executionCapabilities(
  probe: RuntimeAdapterProbe | null,
): Record<string, "available" | "unavailable" | "unknown" | "lossy"> {
  const names = ["continuation", "delegation", "structuredOutput", "cancellation"] as const
  if (!probe) return Object.fromEntries(names.map((name) => [name, "unknown"]))
  if (!probe.available) return Object.fromEntries(names.map((name) => [name, "unavailable"]))
  const execution = probe.capabilities.execution
  if (!execution) return Object.fromEntries(names.map((name) => [name, "unknown"]))
  return Object.fromEntries(
    names.map((name) => [name, execution[name].supported ? "available" : "unavailable"]),
  )
}

function authorityCeiling(
  sqlite: Sqlite,
  source: Row,
  target: ExecutionTarget,
): DelegationAuthorityCeiling {
  const permissionMode = String(source.permission_mode) as RunPermissionMode
  const customPermissions =
    permissionMode === "custom" ? parseStoredCustomPermissions(source.custom_permissions) : null
  const allowedToolTiers: DelegationAuthorityCeiling["allowedToolTiers"] =
    permissionMode === "read-only"
      ? ["read"]
      : permissionMode === "auto-edit-project-only"
        ? ["read", "project-write"]
        : permissionMode === "custom"
          ? [
              "read" as const,
              ...(customPermissions?.projectWrite ? (["project-write"] as const) : []),
              ...(customPermissions?.shell ? (["shell"] as const) : []),
              ...(customPermissions?.git ? (["git"] as const) : []),
              ...(customPermissions?.network ? (["network"] as const) : []),
            ]
          : ["read", "project-write", "shell", "git", "network"]
  return {
    schemaVersion: 1,
    permissionMode,
    customPermissions,
    allowedToolTiers,
    network:
      permissionMode === "full-access" ||
      permissionMode === "ask-before-edits" ||
      Boolean(customPermissions?.network),
    maxDescendantDepth: 0,
    tokenBudget: null,
    costBudgetMicros: null,
    providerAccountId: target.accountId,
    allowedProfileSnapshotIds: target.agentProfile ? [target.agentProfile.snapshotId] : [],
    workspaceRoot: projectPath(sqlite, source.project_id),
    worktreePath: stringOrNull(source.worktree_path),
    worktreeLeaseId: worktreeLease(source).leaseId,
  }
}

function worktreeLease(source: Row) {
  const path = stringOrNull(source.worktree_path)
  const branch = stringOrNull(source.branch)
  const leaseBase = {
    sourceChatId: String(source.id),
    path,
    branch,
  }
  return {
    leaseId: path ? `runtime-lease-${sha256(canonicalJson(leaseBase)).slice(0, 32)}` : null,
    path,
    branch,
    fingerprint: sha256(canonicalJson({ path, branch })),
  }
}

function worktreeAvailability(
  sqlite: Sqlite,
  source: Row,
): {
  state: "available" | "blocked" | "repair-required"
  reason: string | null
  repair: string | null
} {
  const path = stringOrNull(source.worktree_path)
  if (!path) return { state: "available", reason: null, repair: null }
  const conflict = sqlite
    .prepare(
      `SELECT r.id FROM agent_runs r
       JOIN chats c ON c.id = r.chat_id
      WHERE c.worktree_path = ? AND r.chat_id <> ?
         AND r.status IN ('pending', 'running') AND c.archived_at IS NULL
       LIMIT 1`,
    )
    .get(path, source.id)
  return conflict
    ? {
        state: "blocked",
        reason: "Another active Runtime run already holds this exact worktree.",
        repair: "Wait for the active run to finish or choose an isolated worktree.",
      }
    : { state: "available", reason: null, repair: null }
}

function readAgentProfileBinding(sqlite: Sqlite, chatId: string) {
  if (!tableExists(sqlite, "agent_profile_chat_bindings")) return null
  const row = sqlite
    .prepare(
      "SELECT profile_id, profile_version, snapshot_id FROM agent_profile_chat_bindings WHERE chat_id = ?",
    )
    .get(chatId) as Row | undefined
  return row
    ? {
        id: String(row.profile_id),
        version: Number(row.profile_version),
        snapshotId: String(row.snapshot_id),
      }
    : null
}

function projectPath(sqlite: Sqlite, projectId: unknown): string | null {
  if (typeof projectId !== "string" || !tableExists(sqlite, "projects")) return null
  const row = sqlite.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
    { path: string } | undefined
  return row?.path ?? null
}

function tableExists(sqlite: Sqlite, name: string): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  )
}

function providerForHarness(harness: string): string {
  if (harness === "codex") return "openai"
  if (harness === "claude-code") return "anthropic"
  return harness
}

function parseStoredCustomPermissions(value: unknown): CustomPermissionCapabilities | null {
  if (typeof value !== "string") return null
  try {
    return parseCustomPermissionCapabilities(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

function runtimeLabel(preference: AgentRuntimePreference): string {
  if (preference === "claude-code-enhanced") return "Claude Code Enhanced"
  if (preference === "claude-code") return "Claude Code"
  if (preference === "flapstack-native") return "Flapstack Native"
  if (preference === "codex-enhanced") return "Codex Enhanced"
  if (preference === "codex") return "Codex"
  return "Automatic Runtime"
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as { $client: Sqlite }).$client
}
