import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  runtimeAdapterForPreference,
  type AgentRuntimePreference,
} from "../../../shared/agent-runtime"
import { formatChatHandoff, type HandoffMessage } from "../chat-handoff"
import { millisecondsToEpochSeconds } from "../db/timestamps"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "./compatibility"

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
    runtimePreference: AgentRuntimePreference
    visibleMessageCount: number
  }
}

export class RuntimeChatLifecycleService {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
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
        assertCompatible(String(chat.harness ?? "generic"), input.preference)
        this.sqlite
          .prepare("UPDATE chats SET runtime_preference = ?, updated_at = ? WHERE id = ?")
          .run(input.preference, millisecondsToEpochSeconds(Date.now()), input.chatId)
        return { chatId: input.chatId, runtimePreference: input.preference }
      })
      .immediate()
  }

  continueWithRuntime(input: {
    sourceChatId: string
    preference: AgentRuntimePreference
    requestId: string
    name?: string | null
  }): RuntimeContinuationResult {
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
        const harness = String(source.harness ?? "generic")
        assertCompatible(harness, input.preference)
        const ids = continuationIds(input.sourceChatId, input.requestId)
        const existing = this.sqlite.prepare("SELECT * FROM chats WHERE id = ?").get(ids.chatId) as
          Row | undefined
        if (existing) return this.existingContinuation(existing, ids.subChatId, input)

        const sourceConversations = this.sqlite
          .prepare("SELECT * FROM sub_chats WHERE chat_id = ? ORDER BY created_at, id")
          .all(input.sourceChatId) as Row[]
        const sourceConversation = sourceConversations[0]
        if (!sourceConversation) {
          throw new RuntimeChatLifecycleError("chat-empty", "Source conversation is missing.")
        }
        const conversations = sourceConversations.map((conversation) => ({
          subChatId: String(conversation.id),
          subChatName: stringOrNull(conversation.name),
          messages: parseMessages(conversation.messages),
        }))
        const visibleMessageCount = conversations.reduce(
          (count, conversation) => count + conversation.messages.length,
          0,
        )
        const visibleHistory = formatChatHandoff({
          chat: {
            id: input.sourceChatId,
            name: stringOrNull(source.name),
            branch: stringOrNull(source.branch),
          },
          conversations,
        })
        if (Buffer.byteLength(visibleHistory) > 1_000_000) {
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
            harness, model, runtime_preference, parent_chat_id, initiator_chat_id,
            parent_run_id, ancestor_chat_ids, worktree_path, branch, base_branch,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ids.chatId,
            name,
            source.project_id ?? null,
            source.task_id ?? null,
            source.scope,
            source.permission_mode,
            source.custom_permissions ?? null,
            source.harness ?? null,
            source.model ?? null,
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
              text: `Imported visible history context from ${input.sourceChatId}. Hidden provider state was not transferred.\n\n${visibleHistory}`,
            },
          ],
          metadata: {
            kind: "runtime-continuation-context",
            sourceChatId: input.sourceChatId,
            runtimePreference: input.preference,
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
            sourceConversation.harness ?? source.harness ?? null,
            sourceConversation.model ?? source.model ?? null,
            sourceConversation.permission_mode ?? source.permission_mode,
            sourceConversation.worktree_path ?? source.worktree_path ?? null,
            JSON.stringify([contextMessage]),
            now,
            now,
          )
        return result(ids.chatId, ids.subChatId, input, visibleMessageCount, true)
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
    input: { sourceChatId: string; preference: AgentRuntimePreference },
  ): RuntimeContinuationResult {
    if (
      existing.parent_chat_id !== input.sourceChatId ||
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
    return result(
      String(existing.id),
      subChatId,
      input,
      visibleMessageCountForChat(this.sqlite, input.sourceChatId),
      false,
    )
  }
}

export function createRuntimeChatLifecycleService(
  database: DatabaseLike,
): RuntimeChatLifecycleService {
  return new RuntimeChatLifecycleService(database)
}

function assertCompatible(harness: string, preference: AgentRuntimePreference): void {
  const runtime = runtimeAdapterForPreference(preference) ?? productRuntimeForHarness(harness)
  const compatibility = checkRuntimeCompatibility(harness, runtime)
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

function visibleMessageCountForChat(sqlite: Sqlite, chatId: string): number {
  const rows = sqlite
    .prepare("SELECT messages FROM sub_chats WHERE chat_id = ?")
    .all(chatId) as Row[]
  return rows.reduce((count, row) => count + parseMessages(row.messages).length, 0)
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
  input: { sourceChatId: string; preference: AgentRuntimePreference },
  visibleMessageCount: number,
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
      runtimePreference: input.preference,
      visibleMessageCount,
    },
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
