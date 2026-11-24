import type Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { z } from "zod"
import { nowEpochSeconds } from "../../db/timestamps"
import { withSubChatRewindGuard } from "../../sub-chat-rewind-guard"
import { PINNED_CODEX_APP_SERVER_VERSION, resolveCodexRuntimeCommand } from "./binary"
import {
  CodexProtocolResponseError,
  spawnCodexProtocolClient,
  type CodexProtocolClient,
} from "./protocol-client"

const TURN_PAGE_SIZE = 100
const MAX_TURN_PAGES = 40
const intentSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  targetId: z.string(),
  headBefore: z.string(),
  headAfter: z.string().nullable(),
  transcriptHash: z.string(),
})

type Message = { id: string; role: string; metadata?: Record<string, unknown> }
type SubChat = {
  session_id: string | null
  messages: string
  codex_rewind_intent: string | null
  codex_rewind_discarded: string | null
}
type Turn = { prompt_message_id: string; provider_turn_id: string }
type CodexNativeTurn = { id: string; status: string }

function readSubChat(db: Database.Database, subChatId: string) {
  return db
    .prepare(
      `SELECT s.session_id,s.messages,s.codex_rewind_intent,s.codex_rewind_discarded FROM sub_chats s
       JOIN chats c ON c.id=s.chat_id
       WHERE s.id=? AND COALESCE(s.harness,c.harness)='codex' AND c.archived_at IS NULL`,
    )
    .get(subChatId) as SubChat | undefined
}

function linkedTurns(db: Database.Database, subChatId: string, threadId: string) {
  return db
    .prepare(
      `SELECT DISTINCT r.prompt_message_id, a.provider_turn_id
      FROM agent_runs r
      JOIN agent_activity_events a ON a.run_id=r.id
        AND a.dedup_key IN ('runtime:runtime:turn-started', 'runtime:turn-started')
      WHERE r.sub_chat_id=? AND r.resolved_runtime='codex' AND r.harness='codex'
        AND a.provider_thread_id=? AND a.provider_turn_id IS NOT NULL
        AND r.prompt_message_id IS NOT NULL`,
    )
    .all(subChatId, threadId) as Turn[]
}

function isThreadShared(db: Database.Database, subChatId: string, threadId: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sub_chats WHERE session_id=? AND id<>? LIMIT 1")
      .get(threadId, subChatId),
  )
}

export function codexRewindTargets(db: Database.Database, subChatId: string) {
  const sub = readSubChat(db, subChatId)
  if (!sub?.session_id) return { messageIds: [], pendingMessageId: null }
  if (isThreadShared(db, subChatId, sub.session_id))
    return { messageIds: [], pendingMessageId: null }
  const pending = sub.codex_rewind_intent
    ? intentSchema.parse(JSON.parse(sub.codex_rewind_intent))
    : null
  const messages = JSON.parse(sub.messages) as Message[]
  const userIds = new Set(
    messages.filter((message) => message.role === "user").map((message) => message.id),
  )
  const messageIds = [
    ...new Set(
      linkedTurns(db, subChatId, sub.session_id)
        .map((turn) => turn.prompt_message_id)
        .filter((id) => userIds.has(id)),
    ),
  ]
  return { messageIds, pendingMessageId: pending?.messageId ?? null }
}

function discardedMessages(value: string | null) {
  return value
    ? z
        .object({ messageIds: z.array(z.string()), runIds: z.array(z.string()) })
        .parse(JSON.parse(value))
    : { messageIds: [], runIds: [] }
}

export function filterCodexDiscardedMessages(discarded: string | null, messages: string) {
  if (!discarded) return messages
  const { messageIds, runIds } = discardedMessages(discarded)
  const droppedIds = new Set(messageIds)
  const droppedRuns = new Set(runIds)
  const incoming = JSON.parse(messages) as Message[]
  const filtered = incoming.filter((message) => {
    const runId = message.metadata?.runId
    return !droppedIds.has(message.id) && (typeof runId !== "string" || !droppedRuns.has(runId))
  })
  return filtered.length === incoming.length ? messages : JSON.stringify(filtered)
}

export function isCodexDiscardedTurn(
  discarded: string | null,
  runId: string,
  promptId: string | null,
) {
  if (!discarded) return false
  const { messageIds, runIds } = discardedMessages(discarded)
  return runIds.includes(runId) || (promptId !== null && messageIds.includes(promptId))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

async function page(client: CodexProtocolClient, threadId: string, cursor: string | null) {
  const reply = record(
    await client.request("thread/turns/list", {
      threadId,
      cursor,
      limit: TURN_PAGE_SIZE,
      sortDirection: "desc",
      itemsView: "notLoaded",
    }),
  )
  return z
    .object({
      data: z.array(z.object({ id: z.string().min(1), status: z.string() })).max(TURN_PAGE_SIZE),
      nextCursor: z.string().nullable().optional(),
    })
    .parse(reply)
}

async function findSuffix(
  client: CodexProtocolClient,
  threadId: string,
  suffix: Map<string, string>,
  userMessageId: string,
) {
  let cursor: string | null = null
  const seen = new Set<string | null>()
  let headBefore: string | undefined
  let targetId: string | undefined
  for (let index = 0; index < MAX_TURN_PAGES; index += 1) {
    if (seen.has(cursor)) throw new Error("Codex returned a repeated history page.")
    seen.add(cursor)
    const result = await page(client, threadId, cursor)
    for (const turn of result.data) {
      headBefore ??= turn.id
      if (turn.status === "inProgress") throw new Error("Stop the active Codex response first.")
      const promptId = suffix.get(turn.id)
      if (!promptId) {
        if (targetId && headBefore) return { targetId, headBefore, headAfter: turn.id }
        throw new Error("Codex history has turns outside the selected Flapstack messages.")
      }
      if (promptId === userMessageId) targetId = turn.id
    }
    cursor = result.nextCursor ?? null
    if (cursor === null) {
      if (targetId && headBefore) return { targetId, headBefore, headAfter: null }
      break
    }
  }
  throw new Error("Codex could not locate the selected turn in its recent history.")
}

function readHead(client: CodexProtocolClient, threadId: string): Promise<CodexNativeTurn | null> {
  return page(client, threadId, null).then(({ data }) => data[0] ?? null)
}

async function resumeForRewind(client: CodexProtocolClient, threadId: string) {
  const init = record(
    await client.request("initialize", {
      clientInfo: { name: "flapstack", title: "Flapstack", version: "1" },
      capabilities: { experimentalApi: true },
    }),
  )
  const reportedVersion =
    typeof init.userAgent === "string" ? init.userAgent.split(" ", 1)[0]?.split("/").at(-1) : null
  if (reportedVersion !== PINNED_CODEX_APP_SERVER_VERSION)
    throw new Error("This Codex App Server version is unavailable for native rewind.")
  const args = {
    threadId,
    excludeTurns: true,
    sandbox: "read-only",
    approvalPolicy: "never",
    config: { features: { hooks: false } },
  }
  let archived = false
  const resume = async () => {
    const response = record(await client.request("thread/resume", args))
    if (record(response.thread).id !== threadId)
      throw new Error("Codex resumed a different conversation.")
  }
  try {
    try {
      await resume()
    } catch (error) {
      if (
        !(error instanceof CodexProtocolResponseError) ||
        !error.message.includes(`session ${threadId} is archived.`)
      )
        throw error
      await client.request("thread/unarchive", { threadId }, 60_000)
      archived = true
      await resume()
    }
    return archived
  } catch (error) {
    if (archived) await archive(client, threadId)
    throw error
  }
}

async function archive(client: CodexProtocolClient, threadId: string) {
  await client.request("thread/archive", { threadId }).catch(() => undefined)
}

function openRewindClient() {
  return spawnCodexProtocolClient({
    command: resolveCodexRuntimeCommand(),
    disableInheritedMcp: true,
  })
}

export async function rewindCodexToUserMessage(
  db: Database.Database,
  input: { subChatId: string; userMessageId: string },
  createClient: () => CodexProtocolClient = openRewindClient,
) {
  return withSubChatRewindGuard(input.subChatId, async () => {
    const { subChatId, userMessageId } = input
    const sub = readSubChat(db, subChatId)
    if (!sub?.session_id) throw new Error("This conversation has no native Codex history.")
    const threadId = sub.session_id
    const assertExclusiveThread = () => {
      if (isThreadShared(db, subChatId, threadId))
        throw new Error("Another conversation shares this Codex thread. Rewind is unavailable.")
    }
    const assertIdle = () => {
      const active = db
        .prepare("SELECT 1 FROM agent_runs WHERE sub_chat_id=? AND status IN ('pending','running')")
        .get(subChatId)
      if (active) throw new Error("Stop the current response first.")
    }
    assertIdle()
    assertExclusiveThread()
    const messages = JSON.parse(sub.messages) as Message[]
    const index = messages.findIndex((msg) => msg.id === userMessageId && msg.role === "user")
    if (index < 0) throw new Error("The selected user message is no longer in this conversation.")
    const suffixIds = new Set(
      messages
        .slice(index)
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.id),
    )
    const suffix = new Map(
      linkedTurns(db, subChatId, threadId)
        .filter((turn) => suffixIds.has(turn.prompt_message_id))
        .map((turn) => [turn.provider_turn_id, turn.prompt_message_id]),
    )
    if (![...suffix.values()].includes(userMessageId)) {
      throw new Error("No native Codex turn was recorded for this message.")
    }
    const transcriptHash = createHash("sha256").update(sub.messages).digest("hex")
    const previous = discardedMessages(sub.codex_rewind_discarded)
    let pending = sub.codex_rewind_intent
    let intent = pending ? intentSchema.parse(JSON.parse(pending)) : undefined
    if (
      intent &&
      (intent.messageId !== userMessageId ||
        intent.threadId !== threadId ||
        intent.transcriptHash !== transcriptHash)
    ) {
      throw new Error("Resolve the pending Codex rewind at its original message first.")
    }
    const client = createClient()
    let archived = false
    try {
      archived = await resumeForRewind(client, threadId)
      let finished = false
      if (intent) {
        const head = await readHead(client, threadId)
        finished = (head?.id ?? null) === intent.headAfter && head?.status !== "inProgress"
        if (!finished && head?.id !== intent.headBefore)
          throw new Error("Codex history changed. The pending rewind could not be confirmed.")
      }

      if (!finished) {
        const boundary = await findSuffix(client, threadId, suffix, userMessageId)
        if (
          intent &&
          (boundary.targetId !== intent.targetId ||
            boundary.headBefore !== intent.headBefore ||
            boundary.headAfter !== intent.headAfter)
        )
          throw new Error("Codex history changed since the pending rewind.")
        if (!intent) {
          intent = { ...boundary, messageId: userMessageId, threadId, transcriptHash }
          const serialized = JSON.stringify(intent)
          db.transaction(() => {
            assertIdle()
            assertExclusiveThread()
            const marked = db
              .prepare(
                "UPDATE sub_chats SET codex_rewind_intent=? WHERE id=? AND session_id=? AND messages=? AND codex_rewind_intent IS NULL",
              )
              .run(serialized, subChatId, threadId, sub.messages)
            if (marked.changes !== 1)
              throw new Error("The conversation changed. Select the rewind again.")
          }).immediate()
          pending = serialized
        }

        let rejected = false
        try {
          const result = record(
            await client.request("thread/revert", { threadId, beforeTurnId: intent.targetId }),
          )
          if (record(result.thread).id !== threadId)
            throw new Error("Codex returned a different thread.")
        } catch (error) {
          rejected = error instanceof CodexProtocolResponseError
        }

        const head = await readHead(client, threadId).catch(() => undefined)
        if (
          head === undefined ||
          (head?.id ?? null) !== intent.headAfter ||
          head?.status === "inProgress"
        ) {
          if (rejected && head?.id === intent.headBefore) {
            db.prepare(
              "UPDATE sub_chats SET codex_rewind_intent=NULL WHERE id=? AND codex_rewind_intent=?",
            ).run(subChatId, pending)
            throw new Error("Codex rejected the rewind.")
          }
          throw new Error(
            "Could not confirm the Codex rewind. Select the same message to check it before sending another turn.",
          )
        }
      }

      const kept = messages.slice(0, index).map((message) => {
        if (!message.metadata) return message
        const metadata = { ...message.metadata }
        delete metadata.shouldResume
        delete metadata.shouldForkResume
        return { ...message, metadata }
      })
      // Renderer completion messages can arrive after the history change, including
      // assistant copies with a different message ID but the same native run.
      const oldRuns = db
        .prepare("SELECT id,prompt_message_id FROM agent_runs WHERE sub_chat_id=?")
        .all(subChatId) as { id: string; prompt_message_id: string | null }[]
      const discarded = {
        messageIds: [
          ...new Set([
            ...previous.messageIds,
            ...messages.slice(index).map((message) => message.id),
          ]),
        ],
        runIds: [
          ...new Set([
            ...previous.runIds,
            ...oldRuns
              .filter((run) => run.prompt_message_id && suffixIds.has(run.prompt_message_id))
              .map((run) => run.id),
          ]),
        ],
      }
      const changes = db
        .prepare(
          "UPDATE sub_chats SET messages=?, stream_id=NULL, codex_rewind_intent=NULL, codex_rewind_discarded=?, updated_at=? WHERE id=? AND session_id=? AND messages=? AND codex_rewind_intent=?",
        )
        .run(
          JSON.stringify(kept),
          JSON.stringify(discarded),
          nowEpochSeconds(),
          subChatId,
          threadId,
          sub.messages,
          pending,
        )
      if (changes.changes !== 1) {
        throw new Error(
          "Codex rewound the thread, but Flapstack could not confirm its saved messages.",
        )
      }
      return { success: true as const, messages: kept, restoration: "conversation-only" as const }
    } finally {
      if (archived) await archive(client, threadId)
      await client.close().catch(() => undefined)
    }
  })
}
