import Database from "better-sqlite3"
import type { AgentRuntimePreference, ResolvedRuntimeLaunch } from "../../../shared/agent-runtime"
import { checkRuntimeCompatibility, productRuntimeForHarness } from "./compatibility"
import { getRuntimeReleasePolicy } from "./release-policy"
import { resolvedLaunchFromSnapshotRow } from "./snapshot"
import { sanitizeRuntimeText } from "./sanitizer"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export type RuntimeDiagnostics = {
  chatId: string
  preference: AgentRuntimePreference
  preferenceSource: ResolvedRuntimeLaunch["preferenceSource"] | "unresolved"
  resolvedRuntime: ResolvedRuntimeLaunch["resolvedRuntime"] | null
  harness: string
  model: string | null
  compatibility: { compatible: boolean; reason: string | null }
  versions: ResolvedRuntimeLaunch["versions"] | null
  capabilities: ResolvedRuntimeLaunch["capabilities"] | null
  controls: ResolvedRuntimeLaunch["controls"] | null
  sessionIdentityClass: "provider-session-present" | "no-provider-session"
  activity: { count: number; firstSequence: number | null; lastSequence: number | null }
  lastError: {
    kind: string
    phase: string
    receivedAt: number
    redacted: boolean
  } | null
  releasePolicy: ReturnType<typeof getRuntimeReleasePolicy>
  diagnosticError: string | null
}

export function getRuntimeDiagnostics(database: DatabaseLike, chatId: string): RuntimeDiagnostics {
  const sqlite = rawClient(database)
  const chat = sqlite
    .prepare("SELECT id, harness, model, runtime_preference FROM chats WHERE id = ?")
    .get(chatId) as Row | undefined
  if (!chat) throw new Error("Runtime diagnostics chat is missing.")
  const run = sqlite
    .prepare("SELECT * FROM agent_runs WHERE chat_id = ? ORDER BY started_at DESC, id DESC LIMIT 1")
    .get(chatId) as Row | undefined
  const session = sqlite
    .prepare("SELECT 1 present FROM sub_chats WHERE chat_id = ? AND session_id IS NOT NULL LIMIT 1")
    .get(chatId) as Row | undefined
  const activity = hasTable(sqlite, "agent_activity_events")
    ? (sqlite
        .prepare(
          `SELECT COUNT(*) count, MIN(sequence) first_sequence, MAX(sequence) last_sequence
           FROM agent_activity_events WHERE chat_id = ?`,
        )
        .get(chatId) as Row)
    : { count: 0, first_sequence: null, last_sequence: null }
  const lastError = hasTable(sqlite, "agent_activity_events")
    ? (sqlite
        .prepare(
          `SELECT kind, phase, received_at, redaction_state
           FROM agent_activity_events
           WHERE chat_id = ? AND (phase = 'failed' OR kind = 'warning')
           ORDER BY storage_id DESC LIMIT 1`,
        )
        .get(chatId) as Row | undefined)
    : undefined
  const preference = String(chat.runtime_preference ?? "auto") as AgentRuntimePreference
  const harness = String(chat.harness ?? "generic")
  const unresolvedRuntime = preference === "auto" ? productRuntimeForHarness(harness) : preference
  const unresolvedCompatibility = checkRuntimeCompatibility(harness, unresolvedRuntime)
  let launch: ResolvedRuntimeLaunch | null = null
  let diagnosticError: string | null = null
  if (run) {
    try {
      launch = resolvedLaunchFromSnapshotRow(run)
    } catch (error) {
      diagnosticError = sanitizeRuntimeDiagnostic(error)
    }
  }
  const compatibility = launch?.compatibility ?? unresolvedCompatibility
  return {
    chatId,
    preference: launch?.requestedPreference ?? preference,
    preferenceSource: launch?.preferenceSource ?? "unresolved",
    resolvedRuntime: launch?.resolvedRuntime ?? null,
    harness,
    model: typeof chat.model === "string" ? chat.model : null,
    compatibility: {
      compatible: compatibility.compatible,
      reason: compatibility.compatible ? null : compatibility.reason.message,
    },
    versions: launch?.versions ?? null,
    capabilities: launch?.capabilities ?? null,
    controls: launch?.controls ?? null,
    sessionIdentityClass: session ? "provider-session-present" : "no-provider-session",
    activity: {
      count: Number(activity.count ?? 0),
      firstSequence:
        activity.first_sequence === null || activity.first_sequence === undefined
          ? null
          : Number(activity.first_sequence),
      lastSequence:
        activity.last_sequence === null || activity.last_sequence === undefined
          ? null
          : Number(activity.last_sequence),
    },
    lastError: lastError
      ? {
          kind: String(lastError.kind),
          phase: String(lastError.phase),
          receivedAt: Number(lastError.received_at),
          redacted: lastError.redaction_state !== "visible",
        }
      : null,
    releasePolicy: getRuntimeReleasePolicy(),
    diagnosticError,
  }
}

export function sanitizeRuntimeDiagnostic(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return sanitizeRuntimeText(value, { maxLength: 500, mode: "diagnostic" })
}

function hasTable(sqlite: Sqlite, table: string): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  )
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as { $client: Sqlite }).$client
}
