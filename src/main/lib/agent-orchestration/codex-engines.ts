import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { posix, win32 } from "node:path"
import type {
  CoordinationEngineAction,
  CoordinationEngineActionResult,
  CoordinationEngineAdapter,
  CoordinationEngineContext,
  CoordinationEngineProbe,
  CoordinationEngineProviderIdentity,
} from "../../../shared/coordination-engine"
import { recordOrchestrationTransition } from "./activity-projection"
import { redactProviderError } from "./cascade-control"

type Engine = "codex-v2" | "codex-v1"
type IntentRow = Record<string, unknown>
type DispatchIdentity = { intentId: string; idempotencyKey: string }
const CLAIM_SECONDS = 300
const CLAIM_RENEWAL_SECONDS = Math.floor(CLAIM_SECONDS / 3)

export interface CodexCoordinationClient {
  probe(engine: Engine): Promise<CoordinationEngineProbe>
  dispatch(
    engine: Engine,
    action: CoordinationEngineAction,
    identity: DispatchIdentity,
  ): Promise<{
    state: "running" | "waiting" | "completed" | "cancelled"
    providerIdentity: CoordinationEngineProviderIdentity | null
    result: unknown
  }>
  reconcile(
    engine: Engine,
    intentId: string,
    idempotencyKey: string,
    providerIdentity: CoordinationEngineProviderIdentity | null,
  ): Promise<{
    state: "running" | "waiting" | "completed" | "cancelled" | "uncertain"
    result: unknown
  }>
}

export function createCodexCoordinationAdapter(
  databasePath: string,
  engine: Engine,
  client: CodexCoordinationClient,
): CoordinationEngineAdapter {
  const execute = async (
    context: CoordinationEngineContext,
    action: CoordinationEngineAction,
  ): Promise<CoordinationEngineActionResult> => {
    validateAction(engine, action)
    const payloadJson = canonicalJson(action)
    const idempotencyKey = digest(
      canonicalJson([context.orchestrationId, engine, JSON.parse(payloadJson)]),
    )
    const intentId = randomUUID()
    const owner = randomUUID()
    const db = new Database(databasePath)
    let inserted = false
    let persisted!: IntentRow
    try {
      db.transaction(() => {
        const result = db
          .prepare(
            `INSERT OR IGNORE INTO coordination_action_intents
             (id, idempotency_key, task_id, engine, action, target_agent_id, payload_json,
              state, provider_identity_json, result_json, claim_owner, claim_expires_at,
              attempt_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'dispatching', ?, NULL, ?, ?, 1, ?, ?)`,
          )
          .run(
            intentId,
            idempotencyKey,
            context.orchestrationId,
            engine,
            action.kind,
            "targetAgentId" in action ? action.targetAgentId : null,
            payloadJson,
            canonicalJson(action.providerIdentity),
            owner,
            epoch() + CLAIM_SECONDS,
            epoch(),
            epoch(),
          )
        inserted = result.changes === 1
        persisted = db
          .prepare("SELECT * FROM coordination_action_intents WHERE idempotency_key = ?")
          .get(idempotencyKey) as IntentRow
        if (!persisted) throw new Error("Coordination intent was not persisted.")
        if (inserted)
          recordOrchestrationTransition(db, {
            dedupKey: `coordination:${intentId}:dispatching`,
            taskId: context.orchestrationId,
            entityType: "coordination",
            entityId: intentId,
            agentId: "targetAgentId" in action ? action.targetAgentId : null,
            kind: messageKind(action),
            phase: "dispatching",
          })
      }).immediate()
    } finally {
      db.close()
    }
    if (!inserted) return existingIntentResult(engine, action, persisted)

    try {
      const result = await withClaimRenewal(databasePath, intentId, owner, () =>
        client.dispatch(engine, action, { intentId, idempotencyKey }),
      )
      if (!["running", "waiting", "completed", "cancelled"].includes(result.state))
        throw new Error("Unknown Codex coordination lifecycle state.")
      const providerIdentity = result.providerIdentity ?? action.providerIdentity
      if (action.kind === "start" && !providerIdentity)
        throw new Error("Codex coordination start returned no provider identity.")
      if (providerIdentity) validateProviderIdentity(engine, providerIdentity)
      finalizeIntent(databasePath, {
        intentId,
        owner,
        taskId: context.orchestrationId,
        action,
        state: result.state,
        providerIdentity,
        result: result.result,
      })
      return {
        schemaVersion: 1,
        ok: true,
        action: action.kind,
        state: result.state,
        providerIdentity,
        result: { intentId, idempotencyKey, value: result.result },
      }
    } catch (error) {
      markUncertain(databasePath, {
        intentId,
        owner,
        taskId: context.orchestrationId,
        action,
        error,
      })
      return uncertainResult(engine, action, intentId)
    }
  }

  const lifecycle =
    (kind: "prepare" | "start" | "resume" | "reconcile" | "cancel" | "cleanup") =>
    async (context: CoordinationEngineContext) =>
      execute(context, {
        schemaVersion: 1,
        kind,
        orchestrationId: context.orchestrationId,
        providerIdentity: context.snapshot.providerIdentity,
        ...(kind === "start" ? { contextFork: null } : {}),
      })

  const reconcile = async (
    context: CoordinationEngineContext,
  ): Promise<CoordinationEngineActionResult> => {
    const candidateIds = listReconciliationCandidateIds(
      databasePath,
      context.orchestrationId,
      engine,
    )
    let reconciled = 0
    let running = 0
    let waiting = 0
    let completed = 0
    let cancelled = 0
    let uncertain = 0
    for (const candidateId of candidateIds) {
      const claim = claimIntent(databasePath, candidateId, context.orchestrationId, engine)
      if (!claim) continue
      const action = JSON.parse(String(claim.row.payload_json)) as CoordinationEngineAction
      const identity = JSON.parse(
        String(claim.row.provider_identity_json),
      ) as CoordinationEngineProviderIdentity | null
      try {
        const result = await withClaimRenewal(databasePath, String(claim.row.id), claim.owner, () =>
          client.reconcile(
            engine,
            String(claim.row.id),
            String(claim.row.idempotency_key),
            identity,
          ),
        )
        if (!["running", "waiting", "completed", "cancelled", "uncertain"].includes(result.state))
          throw new Error("Unknown Codex reconciliation lifecycle state.")
        finalizeIntent(databasePath, {
          intentId: String(claim.row.id),
          owner: claim.owner,
          taskId: context.orchestrationId,
          action,
          state: result.state,
          providerIdentity: identity,
          result: result.result,
        })
        reconciled += 1
        if (result.state === "running") running += 1
        else if (result.state === "waiting") waiting += 1
        else if (result.state === "completed") completed += 1
        else if (result.state === "cancelled") cancelled += 1
        else uncertain += 1
      } catch (error) {
        markUncertain(databasePath, {
          intentId: String(claim.row.id),
          owner: claim.owner,
          taskId: context.orchestrationId,
          action,
          error,
        })
        reconciled += 1
        uncertain += 1
      }
    }
    if (uncertain > 0)
      return {
        schemaVersion: 1,
        ok: false,
        action: "reconcile",
        state: "uncertain",
        providerIdentity: context.snapshot.providerIdentity,
        reason: {
          code: "engine-unavailable",
          engine,
          message: `Reconciled ${reconciled} Codex intents: ${running} running, ${waiting} waiting, ${completed} completed, ${cancelled} cancelled, ${uncertain} uncertain.`,
          missingCapabilities: [],
          repair: "Reconcile provider state before retrying actions.",
        },
      }
    return {
      schemaVersion: 1,
      ok: true,
      action: "reconcile",
      state: running > 0 ? "running" : waiting > 0 ? "waiting" : "completed",
      providerIdentity: context.snapshot.providerIdentity,
      result: { reconciled, running, waiting, completed, cancelled, uncertain },
    }
  }

  return {
    engine,
    version: engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1",
    async probe() {
      const probe = await client.probe(engine)
      if (
        probe.engine !== engine ||
        probe.snapshot.engine !== engine ||
        probe.engineVersion !== (engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1")
      )
        throw new Error("Codex coordination probe identity/version mismatch.")
      return probe
    },
    prepare: lifecycle("prepare"),
    start: lifecycle("start"),
    resume: lifecycle("resume"),
    execute,
    reconcile,
    cancel: lifecycle("cancel"),
    cleanup: lifecycle("cleanup"),
  }
}

function listReconciliationCandidateIds(databasePath: string, taskId: string, engine: Engine) {
  const db = new Database(databasePath)
  try {
    return (
      db
        .prepare(
          `SELECT id FROM coordination_action_intents
           WHERE task_id = ? AND engine = ? AND state in ('dispatching','running','waiting','uncertain')
             AND (claim_owner IS NULL OR claim_expires_at <= ?)
           ORDER BY created_at, id`,
        )
        .all(taskId, engine, epoch()) as Array<{ id: string }>
    ).map((row) => row.id)
  } finally {
    db.close()
  }
}

function claimIntent(databasePath: string, intentId: string, taskId: string, engine: Engine) {
  const db = new Database(databasePath)
  try {
    return db
      .transaction(() => {
        const row = db
          .prepare(
            `SELECT * FROM coordination_action_intents
           WHERE id = ? AND task_id = ? AND engine = ?
             AND state in ('dispatching','running','waiting','uncertain')
             AND (claim_owner IS NULL OR claim_expires_at <= ?)
           LIMIT 1`,
          )
          .get(intentId, taskId, engine, epoch()) as IntentRow | undefined
        if (!row) return null
        const owner = randomUUID()
        const updated = db
          .prepare(
            `UPDATE coordination_action_intents
           SET claim_owner = ?, claim_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND state in ('dispatching','running','waiting','uncertain')
             AND (claim_owner IS NULL OR claim_expires_at <= ?)`,
          )
          .run(owner, epoch() + CLAIM_SECONDS, epoch(), row.id, epoch())
        return updated.changes === 1 ? { row, owner } : null
      })
      .immediate()
  } finally {
    db.close()
  }
}

async function withClaimRenewal<T>(
  databasePath: string,
  intentId: string,
  owner: string,
  operation: () => Promise<T>,
): Promise<T> {
  let claimLost = false
  let renewalError: unknown = null
  const timer = setInterval(() => {
    try {
      if (!renewClaim(databasePath, intentId, owner)) claimLost = true
    } catch (error) {
      claimLost = true
      renewalError = error
    }
  }, CLAIM_RENEWAL_SECONDS * 1000)
  timer.unref()
  try {
    const result = await operation()
    if (claimLost || !ownsClaim(databasePath, intentId, owner))
      throw renewalError ?? new Error("Coordination intent claim was lost during provider call.")
    return result
  } finally {
    clearInterval(timer)
  }
}

function renewClaim(databasePath: string, intentId: string, owner: string) {
  const db = new Database(databasePath)
  try {
    return (
      db
        .prepare(
          `UPDATE coordination_action_intents
           SET claim_expires_at = ?, updated_at = ?
           WHERE id = ? AND claim_owner = ?
             AND state in ('dispatching','running','waiting','uncertain')`,
        )
        .run(epoch() + CLAIM_SECONDS, epoch(), intentId, owner).changes === 1
    )
  } finally {
    db.close()
  }
}

function ownsClaim(databasePath: string, intentId: string, owner: string) {
  const db = new Database(databasePath)
  try {
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM coordination_action_intents
           WHERE id = ? AND claim_owner = ?
             AND state in ('dispatching','running','waiting','uncertain')`,
        )
        .get(intentId, owner),
    )
  } finally {
    db.close()
  }
}

function finalizeIntent(
  databasePath: string,
  input: {
    intentId: string
    owner: string
    taskId: string
    action: CoordinationEngineAction
    state: string
    providerIdentity: CoordinationEngineProviderIdentity | null
    result: unknown
  },
) {
  const db = new Database(databasePath)
  try {
    db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE coordination_action_intents
           SET state = ?, provider_identity_json = ?, result_json = ?,
               claim_owner = NULL, claim_expires_at = NULL, updated_at = ?
           WHERE id = ? AND claim_owner = ? AND state in ('dispatching','running','waiting','uncertain')`,
        )
        .run(
          input.state,
          canonicalJson(input.providerIdentity),
          boundedResult(input.result),
          epoch(),
          input.intentId,
          input.owner,
        )
      if (updated.changes !== 1)
        throw new Error("Coordination intent claim was lost before completion.")
      recordMessage(db, input.intentId, input.taskId, input.action, input.state, input.result)
      recordOrchestrationTransition(db, {
        dedupKey: `coordination:${input.intentId}:${input.state}`,
        taskId: input.taskId,
        entityType: "coordination",
        entityId: input.intentId,
        agentId: "targetAgentId" in input.action ? input.action.targetAgentId : null,
        kind: messageKind(input.action),
        phase: input.state,
      })
    }).immediate()
  } finally {
    db.close()
  }
}

function markUncertain(
  databasePath: string,
  input: {
    intentId: string
    owner: string
    taskId: string
    action: CoordinationEngineAction
    error: unknown
  },
) {
  const db = new Database(databasePath)
  try {
    db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE coordination_action_intents
           SET state = 'uncertain', result_json = ?, claim_owner = NULL,
               claim_expires_at = NULL, updated_at = ?
           WHERE id = ? AND claim_owner = ? AND state in ('dispatching','running','waiting','uncertain')`,
        )
        .run(
          canonicalJson({ error: redactProviderError(input.error) }),
          epoch(),
          input.intentId,
          input.owner,
        )
      if (updated.changes !== 1) return
      recordMessage(db, input.intentId, input.taskId, input.action, "uncertain", null)
      recordOrchestrationTransition(db, {
        dedupKey: `coordination:${input.intentId}:uncertain`,
        taskId: input.taskId,
        entityType: "coordination",
        entityId: input.intentId,
        agentId: "targetAgentId" in input.action ? input.action.targetAgentId : null,
        kind: "warning",
        phase: "uncertain",
      })
    }).immediate()
  } finally {
    db.close()
  }
}

function validateAction(engine: Engine, action: CoordinationEngineAction) {
  if (action.providerIdentity) validateProviderIdentity(engine, action.providerIdentity)
  if (engine === "codex-v1" && action.kind === "start" && action.contextFork)
    throw new Error("Codex V1 does not support selective context forks.")
  if (engine === "codex-v1" && action.kind === "follow-up")
    throw new Error("Codex V1 does not support V2 follow-up semantics.")
}

function validateProviderIdentity(engine: Engine, identity: CoordinationEngineProviderIdentity) {
  if (identity.engine !== engine) throw new Error("Provider identity engine mismatch.")
  if (identity.engine === "codex-v2") {
    if (!isCanonicalAbsoluteTaskPath(identity.canonicalTaskPath))
      throw new Error("Codex V2 canonical task path is invalid.")
    if (!identity.taskName.trim()) throw new Error("Codex V2 task name is missing.")
    return
  }
  if (identity.engine === "codex-v1" && !identity.providerAgentId.trim())
    throw new Error("Codex V1 provider agent ID is missing.")
}

function isCanonicalAbsoluteTaskPath(value: string) {
  if (value.length === 0 || value.includes("\0")) return false
  const segments = value.split(/[\\/]/)
  if (segments.some((segment) => segment === "." || segment === "..")) return false
  if (value.startsWith("/"))
    return !value.includes("\\") && posix.isAbsolute(value) && posix.normalize(value) === value
  if (value.includes("/") || value.startsWith("\\\\?\\") || value.startsWith("\\\\.\\"))
    return false
  const driveRooted = /^[A-Za-z]:\\/.test(value)
  const uncRooted = /^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(value)
  return (driveRooted || uncRooted) && win32.isAbsolute(value) && win32.normalize(value) === value
}

function existingIntentResult(
  engine: Engine,
  action: CoordinationEngineAction,
  row: IntentRow,
): CoordinationEngineActionResult {
  const state = String(row.state)
  const identity = JSON.parse(
    String(row.provider_identity_json),
  ) as CoordinationEngineProviderIdentity | null
  if (["completed", "cancelled"].includes(state))
    return {
      schemaVersion: 1,
      ok: true,
      action: action.kind,
      state: state as "completed" | "cancelled",
      providerIdentity: identity,
      result: row.result_json ? JSON.parse(String(row.result_json)) : null,
    }
  return uncertainResult(engine, action, String(row.id), identity)
}

function uncertainResult(
  engine: Engine,
  action: CoordinationEngineAction,
  intentId: string,
  identity = action.providerIdentity,
): CoordinationEngineActionResult {
  return {
    schemaVersion: 1,
    ok: false,
    action: action.kind,
    state: "uncertain",
    providerIdentity: identity,
    reason: {
      code: "engine-unavailable",
      engine,
      message: "Matching provider intent exists and is not safely replayable.",
      missingCapabilities: [],
      repair: `Reconcile intent ${intentId} by its durable idempotency identity.`,
    },
  }
}

function recordMessage(
  db: Database.Database,
  intentId: string,
  taskId: string,
  action: CoordinationEngineAction,
  state: string,
  result: unknown,
) {
  if (!["send", "follow-up", "interrupt"].includes(action.kind) || !("targetAgentId" in action))
    return
  const messageState =
    state === "uncertain"
      ? "uncertain"
      : state === "completed"
        ? "delivered"
        : state === "cancelled"
          ? "failed"
          : "queued"
  const providerMessageId =
    result && typeof result === "object" && "providerMessageId" in result
      ? String((result as { providerMessageId: unknown }).providerMessageId).slice(0, 512)
      : null
  const updated = db
    .prepare(
      `UPDATE orchestration_messages
       SET state = ?, provider_message_id = ?
       WHERE action_intent_id = ?`,
    )
    .run(messageState, providerMessageId, intentId)
  if (updated.changes === 1) return
  if (updated.changes !== 0) throw new Error("Coordination intent matched multiple messages.")
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO orchestration_messages
     (id, task_id, agent_id, direction, kind, state, body, provider_message_id,
      action_intent_id, created_at)
     VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      digest(`message:${intentId}`),
      taskId,
      action.targetAgentId,
      action.kind === "send" ? "message" : action.kind,
      messageState,
      action.message,
      providerMessageId,
      intentId,
      epoch(),
    )
  if (inserted.changes !== 1) throw new Error("Coordination message insert lost its intent claim.")
}

function messageKind(action: CoordinationEngineAction) {
  return ["send", "follow-up"].includes(action.kind)
    ? ("mailbox" as const)
    : ("coordination" as const)
}
export function canonicalJson(value: unknown): string {
  if (value === undefined) return JSON.stringify("[UNDEFINED]")
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}
function boundedResult(value: unknown) {
  const serialized = canonicalJson(value)
  return Buffer.byteLength(serialized) <= 60_000
    ? serialized
    : canonicalJson({ truncated: true, sha256: digest(serialized) })
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
function epoch() {
  return Math.floor(Date.now() / 1000)
}
