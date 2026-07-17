import Database from "better-sqlite3"
import { resolve } from "node:path"
import { sleep } from "../../../shared/sleep"
import type {
  CoordinationEngineAction,
  CoordinationEngineBlockReason,
  CoordinationEngineCapability,
  CoordinationEngineProbe,
  CoordinationEngineProviderIdentity,
} from "../../../shared/coordination-engine"
import type { CodexCoordinationClient } from "./codex-engines"

type Engine = "codex-v2" | "codex-v1"
type DispatchIdentity = { intentId: string; idempotencyKey: string }
type RecordValue = Record<string, unknown>
const POLL_MS = 250
export const SUPPORTED_CODEX_COORDINATION_VERSION = "0.144.1"
export type CodexCoordinationRequestMethod =
  | "thread/start"
  | "thread/fork"
  | "thread/resume"
  | "thread/read"
  | "thread/loaded/list"
  | "thread/unsubscribe"
  | "thread/archive"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt"

export interface CodexAppServerCoordinationTransportPort {
  version(): Promise<string>
  request(
    method: CodexCoordinationRequestMethod,
    params?: Record<string, unknown>,
  ): Promise<unknown>
}

export type CodexAppServerCoordinationOptions = {
  databasePath: string
  /** F11 owns the process, permissions, notifications, and provider activity. */
  transport: CodexAppServerCoordinationTransportPort
  now?: () => Date
}

/** Direct App Server thread/turn transport. It never asks a model to invoke a
 * coordination tool and never parses provider activity streams. */
export function createCodexAppServerCoordinationClient(
  options: CodexAppServerCoordinationOptions,
): CodexCoordinationClient {
  const now = options.now ?? (() => new Date())

  return {
    async probe(engine): Promise<CoordinationEngineProbe> {
      try {
        const version = await options.transport.version()
        if (version !== SUPPORTED_CODEX_COORDINATION_VERSION)
          return unavailableProbe(
            engine,
            `Codex ${version} is installed; coordination is pinned to ${SUPPORTED_CODEX_COORDINATION_VERSION}.`,
            now(),
          )
        await options.transport.request("thread/loaded/list", { limit: 1 })
        return availableProbe(engine, now())
      } catch (error) {
        return unavailableProbe(engine, safeMessage(error), now())
      }
    },

    async dispatch(engine, action, identity) {
      const transport = options.transport
      if (action.kind === "prepare")
        return response("completed", action.providerIdentity, { prepared: true })
      if (action.kind === "start") {
        const target = orchestrationTarget(options.databasePath, action.orchestrationId)
        if (engine === "codex-v1" && action.contextFork)
          throw new Error("Codex V1 does not support selective context forks.")
        const started = record(
          action.contextFork
            ? await transport.request("thread/fork", {
                threadId: action.contextFork.sourceProviderThreadId,
                ...(action.contextFork.lastTurnId
                  ? { lastTurnId: action.contextFork.lastTurnId }
                  : {}),
              })
            : await transport.request("thread/start", { cwd: target.cwd }),
        )
        const threadId = requiredString(
          record(started.thread).id,
          "thread/start returned no thread id",
        )
        const providerIdentity: CoordinationEngineProviderIdentity =
          engine === "codex-v2"
            ? {
                schemaVersion: 1,
                engine,
                canonicalTaskPath: target.canonicalTaskPath,
                taskName: target.taskName,
                providerTaskId: threadId,
              }
            : {
                schemaVersion: 1,
                engine,
                providerAgentId: threadId,
                nickname: target.taskName,
              }
        return response("running", providerIdentity, { threadId })
      }
      if (!action.providerIdentity) throw new Error("Codex coordination identity is missing.")
      if (action.providerIdentity.engine !== engine)
        throw new Error("Codex coordination identity engine mismatch.")

      if (action.kind === "resume") {
        const threadId = rootThreadId(action.providerIdentity)
        await transport.request("thread/resume", { threadId })
        return response("running", action.providerIdentity, { threadId })
      }
      if (action.kind === "reconcile") {
        const state = await inspectThread(transport, rootThreadId(action.providerIdentity))
        if (state.state === "uncertain") throw new Error("Codex thread state is uncertain.")
        return response(state.state, action.providerIdentity, state)
      }
      if (action.kind === "cancel") {
        const state = await interruptThread(transport, rootThreadId(action.providerIdentity))
        return response("cancelled", action.providerIdentity, state)
      }
      if (action.kind === "cleanup") {
        const threadId = rootThreadId(action.providerIdentity)
        await transport.request(engine === "codex-v1" ? "thread/archive" : "thread/unsubscribe", {
          threadId,
        })
        return response("completed", action.providerIdentity, { threadId, released: true })
      }
      if (action.kind === "complete") {
        const state = await inspectThread(transport, rootThreadId(action.providerIdentity))
        if (state.state === "uncertain") throw new Error("Codex thread state is uncertain.")
        return response("completed", action.providerIdentity, {
          ...state,
          resultSummary: action.resultSummary,
        })
      }
      if (action.kind === "wait") {
        const result = await waitForTargets(
          transport,
          options.databasePath,
          action.targetAgentIds,
          action.timeoutMs,
        )
        return response(result.waiting ? "waiting" : "completed", action.providerIdentity, result)
      }

      const messageAction = action as Extract<
        CoordinationEngineAction,
        { kind: "send" | "follow-up" | "interrupt" }
      >
      const target = targetThread(options.databasePath, messageAction.targetAgentId)
      if (messageAction.kind === "interrupt") {
        const result = await interruptThread(transport, target.threadId)
        return response("cancelled", action.providerIdentity, {
          ...result,
          targetAgentId: messageAction.targetAgentId,
        })
      }
      if (!messageAction.message?.trim())
        throw new Error(`${messageAction.kind} requires a message.`)
      const delivered = await deliverMessage(
        transport,
        engine,
        messageAction.kind,
        target.threadId,
        messageAction.message,
        identity,
      )
      return response("running", action.providerIdentity, {
        ...delivered,
        targetAgentId: messageAction.targetAgentId,
        providerMessageId: identity.idempotencyKey,
      })
    },

    async reconcile(engine, intentId, _idempotencyKey, providerIdentity) {
      const transport = options.transport
      const intent = loadIntent(options.databasePath, intentId, engine)
      const action = JSON.parse(intent.payloadJson) as CoordinationEngineAction
      if (action.kind === "wait") {
        const result = await waitForTargets(
          transport,
          options.databasePath,
          action.targetAgentIds,
          0,
        )
        return { state: result.waiting ? "waiting" : "completed", result }
      }
      const threadId =
        "targetAgentId" in action
          ? targetThread(options.databasePath, action.targetAgentId).threadId
          : providerIdentity
            ? rootThreadId(providerIdentity)
            : null
      if (!threadId) return { state: "uncertain", result: { intentId, missingIdentity: true } }
      const state = await inspectThread(transport, threadId)
      return { state: state.state, result: { intentId, ...state } }
    },
  }
}

async function deliverMessage(
  client: CodexAppServerCoordinationTransportPort,
  engine: Engine,
  kind: "send" | "follow-up",
  threadId: string,
  message: string,
  identity: DispatchIdentity,
) {
  let state = await inspectThread(client, threadId)
  if (state.state === "uncertain") throw new Error("Codex thread state is uncertain.")
  if (engine === "codex-v1" && state.activeTurnId) {
    await client.request("turn/interrupt", { threadId, turnId: state.activeTurnId })
    state = await inspectThread(client, threadId)
    if (state.state === "uncertain") throw new Error("Codex thread state is uncertain.")
  }
  if (kind === "send" && state.activeTurnId) {
    const steered = record(
      await client.request("turn/steer", {
        threadId,
        clientUserMessageId: identity.idempotencyKey,
        input: textInput(message),
        expectedTurnId: state.activeTurnId,
      }),
    )
    return { threadId, turnId: requiredString(steered.turnId, "turn/steer returned no turn id") }
  }
  if (kind === "follow-up" && state.activeTurnId)
    throw new Error("Codex follow-up requires an idle or unloaded worker thread.")
  if (state.threadStatus === "notLoaded") await client.request("thread/resume", { threadId })
  const started = record(
    await client.request("turn/start", {
      threadId,
      clientUserMessageId: identity.idempotencyKey,
      input: textInput(message),
    }),
  )
  return {
    threadId,
    turnId: requiredString(record(started.turn).id, "turn/start returned no turn id"),
  }
}

async function waitForTargets(
  client: CodexAppServerCoordinationTransportPort,
  databasePath: string,
  agentIds: string[],
  timeoutMs: number | null,
) {
  const targets = agentIds.map((agentId) => ({ agentId, ...targetThread(databasePath, agentId) }))
  const deadline = Date.now() + Math.max(0, timeoutMs ?? 0)
  do {
    const states = await Promise.all(
      targets.map(async (target) => ({
        agentId: target.agentId,
        ...(await inspectThread(client, target.threadId)),
      })),
    )
    if (states.some((state) => state.state === "uncertain"))
      throw new Error("One or more Codex worker thread states are uncertain.")
    if (states.every((state) => state.state !== "running")) return { waiting: false, states }
    if (!timeoutMs || Date.now() >= deadline) return { waiting: true, states }
    await sleep(Math.min(POLL_MS, deadline - Date.now()))
  } while (Date.now() <= deadline)
  return { waiting: true, states: [] }
}

async function interruptThread(client: CodexAppServerCoordinationTransportPort, threadId: string) {
  const state = await inspectThread(client, threadId)
  if (state.state === "uncertain") throw new Error("Codex thread state is uncertain.")
  if (!state.activeTurnId) return { threadId, interrupted: false }
  await client.request("turn/interrupt", { threadId, turnId: state.activeTurnId })
  return { threadId, turnId: state.activeTurnId, interrupted: true }
}

async function inspectThread(client: CodexAppServerCoordinationTransportPort, threadId: string) {
  const response = record(await client.request("thread/read", { threadId, includeTurns: true }))
  const thread = record(response.thread)
  if (requiredString(thread.id, "thread/read returned no thread id") !== threadId)
    throw new Error("Codex thread identity mismatch.")
  const status = record(thread.status)
  const threadStatus = requiredString(status.type, "thread/read returned no status")
  const turns = array(thread.turns).map(record)
  const active = [...turns].reverse().find((turn) => turn.status === "inProgress")
  const last = turns.at(-1)
  const unknownStatus =
    !["notLoaded", "idle", "systemError", "active"].includes(threadStatus) ||
    turns.some(
      (turn) =>
        typeof turn.status !== "string" ||
        !["completed", "interrupted", "failed", "inProgress"].includes(turn.status),
    )
  const state =
    unknownStatus || threadStatus === "systemError" || last?.status === "failed"
      ? "uncertain"
      : threadStatus === "active" || active
        ? "running"
        : "completed"
  return {
    threadId,
    threadStatus,
    state: state as "running" | "completed" | "uncertain",
    activeTurnId: active ? requiredString(active.id, "active turn has no id") : null,
    lastTurnId: last && typeof last.id === "string" ? last.id : null,
    lastTurnStatus: last && typeof last.status === "string" ? last.status : null,
  }
}

function orchestrationTarget(databasePath: string, taskId: string) {
  const db = new Database(databasePath, { readonly: true })
  try {
    const row = db
      .prepare(
        `SELECT t.name, p.path, c.worktree_path
         FROM task_orchestrations o JOIN tasks t ON t.id = o.task_id
         JOIN projects p ON p.id = t.project_id
         JOIN chats c ON c.id = o.initiating_chat_id WHERE o.task_id = ?`,
      )
      .get(taskId) as RecordValue | undefined
    if (!row) throw new Error("Codex coordination orchestration target is missing.")
    const cwd = string(row.worktree_path) ?? requiredString(row.path, "Project path is missing")
    return {
      cwd,
      taskName: requiredString(row.name, "Task name is missing").slice(0, 200),
      canonicalTaskPath: resolve(cwd, ".flapstack", "operations", safeSegment(taskId)),
    }
  } finally {
    db.close()
  }
}

function targetThread(databasePath: string, agentId: string) {
  const db = new Database(databasePath, { readonly: true })
  try {
    const row = db
      .prepare(
        `SELECT oa.run_id, r.resolved_runtime, COALESCE(
           (SELECT provider_thread_id FROM agent_activity_events
            WHERE run_id = oa.run_id AND provider_thread_id IS NOT NULL
            ORDER BY sequence DESC LIMIT 1), s.session_id
         ) thread_id
         FROM orchestration_agents oa LEFT JOIN agent_runs r ON r.id = oa.run_id
         LEFT JOIN sub_chats s ON s.id = r.sub_chat_id WHERE oa.id = ?`,
      )
      .get(agentId) as RecordValue | undefined
    if (!row?.run_id || row.resolved_runtime !== "codex" || !row.thread_id)
      throw new Error(`Coordination target ${agentId} has no durable Codex thread identity.`)
    return { runId: String(row.run_id), threadId: String(row.thread_id) }
  } finally {
    db.close()
  }
}

function loadIntent(databasePath: string, intentId: string, engine: Engine) {
  const db = new Database(databasePath, { readonly: true })
  try {
    const row = db
      .prepare("SELECT payload_json FROM coordination_action_intents WHERE id = ? AND engine = ?")
      .get(intentId, engine) as { payload_json: string } | undefined
    if (!row) throw new Error("Coordination intent is missing during reconciliation.")
    return { payloadJson: row.payload_json }
  } finally {
    db.close()
  }
}

function rootThreadId(identity: CoordinationEngineProviderIdentity) {
  if (identity.engine === "workflow") throw new Error("Workflow identity is not a Codex thread.")
  return identity.engine === "codex-v2"
    ? requiredString(identity.providerTaskId, "Codex V2 provider task id is missing")
    : requiredString(identity.providerAgentId, "Codex V1 provider agent id is missing")
}

function availableProbe(engine: Engine, capturedAt: Date): CoordinationEngineProbe {
  const capabilities: CoordinationEngineCapability[] =
    engine === "codex-v2"
      ? [
          "named-task-paths",
          "selective-context-fork",
          "queued-messages",
          "follow-up",
          "mailbox",
          "interrupt-without-destroy",
          "resident-workers",
        ]
      : ["legacy-agent-ids", "legacy-resume", "legacy-close"]
  const engineVersion = engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1"
  return {
    engine,
    available: true,
    engineVersion,
    snapshot: {
      schemaVersion: 1,
      engine,
      engineVersion,
      status: "available",
      capturedAt: capturedAt.toISOString(),
      capabilities,
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}

function unavailableProbe(
  engine: Engine,
  message: string,
  capturedAt: Date,
): CoordinationEngineProbe {
  const engineVersion = engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1"
  const reason: CoordinationEngineBlockReason = {
    code: "engine-unavailable" as const,
    engine,
    message: `Codex direct coordination unavailable: ${message.slice(0, 500)}`,
    missingCapabilities:
      engine === "codex-v2" ? ["named-task-paths", "mailbox", "follow-up"] : ["legacy-agent-ids"],
    repair: `Install and authenticate pinned Codex ${SUPPORTED_CODEX_COORDINATION_VERSION}.`,
  }
  return {
    engine,
    available: false,
    engineVersion,
    snapshot: {
      schemaVersion: 1,
      engine,
      engineVersion,
      status: "unavailable",
      capturedAt: capturedAt.toISOString(),
      capabilities: [],
      limitations: [reason.message],
      unavailableReason: reason,
    },
    reason,
  }
}

function response(
  state: "running" | "waiting" | "completed" | "cancelled",
  providerIdentity: CoordinationEngineProviderIdentity | null,
  result: unknown,
) {
  return { state, providerIdentity, result }
}

function textInput(text: string) {
  return [{ type: "text", text, text_elements: [] }]
}
function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "task"
}
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {}
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
function requiredString(value: unknown, message: string): string {
  const result = string(value)
  if (!result) throw new Error(message)
  return result
}
function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500)
}
