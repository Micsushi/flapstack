import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import type {
  AgentActivityAppend,
  AgentActivityInvalidation,
  AgentActivityKind,
  AgentActivityPayloadByKind,
  AgentActivityPhase,
} from "../../../shared/agent-activity"
import type { ResolvedAgentRuntime } from "../../../shared/agent-runtime"
import type { AgentActivityStore } from "./activity-store"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object

export type DevRuntimeActivityFixtureInput = {
  projectId: string
  chatId: string
  subChatId: string
}

export type DevRuntimeActivityFixtureRun = {
  id: string
  terminal: "completed" | "cancelled" | "failed"
  status: "success" | "cancelled" | "failure"
  runtime: ResolvedAgentRuntime
  eventCount: number
}

export type DevRuntimeActivityFixtureStatus = DevRuntimeActivityFixtureInput & {
  present: boolean
  eventCount: number
  runs: DevRuntimeActivityFixtureRun[]
}

export type DevRuntimeActivityFixtureServiceOptions = {
  enabled: boolean
  onInvalidated?: (invalidation: AgentActivityInvalidation) => void
}

const FIXTURE_ADAPTER_VERSION = "flapstack-dev-runtime-fixture-v1"
const FIXTURE_PROTOCOL_VERSION = "fixture-v1"
const FIXTURE_PROVIDER = "flapstack-dev-fixture"
const FIXTURE_BASE_TIME = Date.UTC(2026, 0, 15, 12, 0, 0)

const FIXTURE_RUNS = [
  {
    terminal: "completed",
    status: "success",
    runtime: "codex",
    harness: "codex",
  },
  {
    terminal: "cancelled",
    status: "cancelled",
    runtime: "claude-code",
    harness: "claude-code",
  },
  {
    terminal: "failed",
    status: "failure",
    runtime: "flapstack-native",
    harness: "local",
  },
] as const

export class DevRuntimeActivityFixtureService {
  private readonly sqlite: Sqlite

  constructor(
    database: DatabaseLike,
    private readonly activityStore: AgentActivityStore,
    private readonly options: DevRuntimeActivityFixtureServiceOptions,
  ) {
    this.sqlite = rawClient(database)
  }

  status(input: DevRuntimeActivityFixtureInput): DevRuntimeActivityFixtureStatus {
    this.assertEnabled()
    this.assertScope(input, true)
    const ids = fixtureRunIds(input)
    const rows = this.sqlite
      .prepare(
        `SELECT r.id, r.status, r.resolved_runtime runtime, COUNT(a.storage_id) event_count
         FROM agent_runs r
         LEFT JOIN agent_activity_events a ON a.run_id = r.id
         WHERE r.chat_id = ? AND r.sub_chat_id = ?
           AND r.runtime_adapter_version = ?
           AND r.id IN (${ids.map(() => "?").join(",")})
         GROUP BY r.id, r.status, r.resolved_runtime`,
      )
      .all(input.chatId, input.subChatId, FIXTURE_ADAPTER_VERSION, ...ids) as Array<{
      id: string
      status: DevRuntimeActivityFixtureRun["status"]
      runtime: ResolvedAgentRuntime
      event_count: number
    }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    const runs = FIXTURE_RUNS.flatMap((definition, index) => {
      const row = byId.get(ids[index])
      return row
        ? [
            {
              id: row.id,
              terminal: definition.terminal,
              status: row.status,
              runtime: row.runtime,
              eventCount: row.event_count,
            },
          ]
        : []
    })
    return {
      ...input,
      present: runs.length === FIXTURE_RUNS.length,
      eventCount: runs.reduce((total, run) => total + run.eventCount, 0),
      runs,
    }
  }

  seed(input: DevRuntimeActivityFixtureInput): DevRuntimeActivityFixtureStatus {
    this.assertEnabled()
    this.assertScope(input, false)
    this.deleteFixtureRuns(input, false)
    const ids = fixtureRunIds(input)
    const insertRuns = this.sqlite.transaction(() => {
      const insert = this.sqlite.prepare(
        `INSERT INTO agent_runs (
           id, chat_id, sub_chat_id, harness, model, permission_mode,
           runtime_snapshot_version, runtime_preference, runtime_preference_source,
           resolved_runtime, runtime_adapter_version, runtime_protocol_version,
           runtime_capability_snapshot, runtime_control_snapshot,
           status, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, 'read-only', 1, ?, 'chat', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const [index, definition] of FIXTURE_RUNS.entries()) {
        const startedAt = Math.floor((FIXTURE_BASE_TIME + index * 60_000) / 1_000)
        insert.run(
          ids[index],
          input.chatId,
          input.subChatId,
          definition.harness,
          "fixture-model",
          definition.runtime,
          definition.runtime,
          FIXTURE_ADAPTER_VERSION,
          FIXTURE_PROTOCOL_VERSION,
          JSON.stringify(fixtureCapabilities()),
          JSON.stringify(fixtureControls()),
          definition.status,
          startedAt,
          startedAt + 30,
        )
      }
    })

    try {
      insertRuns.immediate()
      this.activityStore.appendBatch(ids[0], completedRunEvents())
      this.activityStore.appendBatch(ids[1], terminalRunEvents("cancelled"))
      this.activityStore.appendBatch(ids[2], terminalRunEvents("failed"))
      return this.status(input)
    } catch (error) {
      this.deleteFixtureRuns(input, false)
      throw error
    }
  }

  reset(input: DevRuntimeActivityFixtureInput): DevRuntimeActivityFixtureStatus {
    this.assertEnabled()
    this.assertScope(input, true)
    this.deleteFixtureRuns(input, true)
    return this.status(input)
  }

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new Error("Enable Runtime activity test controls in Settings before using fixtures.")
    }
  }

  private assertScope(input: DevRuntimeActivityFixtureInput, allowArchived: boolean): void {
    const scope = this.sqlite
      .prepare(
        `SELECT c.project_id, c.archived_at chat_archived_at,
                p.archived_at project_archived_at, s.chat_id sub_chat_owner
         FROM chats c
         JOIN projects p ON p.id = c.project_id
         JOIN sub_chats s ON s.id = ?
         WHERE c.id = ? AND p.id = ?`,
      )
      .get(input.subChatId, input.chatId, input.projectId) as
      | {
          project_id: string
          chat_archived_at: number | null
          project_archived_at: number | null
          sub_chat_owner: string
        }
      | undefined
    if (!scope || scope.sub_chat_owner !== input.chatId) {
      throw new Error("Runtime fixture target must be one existing project chat and conversation.")
    }
    if (!allowArchived && (scope.chat_archived_at !== null || scope.project_archived_at !== null)) {
      throw new Error("Restore the project and chat before creating Runtime fixture data.")
    }
  }

  private deleteFixtureRuns(input: DevRuntimeActivityFixtureInput, invalidate: boolean): void {
    const ids = fixtureRunIds(input)
    const ranges = this.sqlite
      .prepare(
        `SELECT run_id, chat_id, MIN(sequence) first_sequence,
                MAX(sequence) last_sequence, MAX(storage_id) last_storage_id
         FROM agent_activity_events
         WHERE run_id IN (${ids.map(() => "?").join(",")})
         GROUP BY run_id, chat_id`,
      )
      .all(...ids) as Array<{
      run_id: string
      chat_id: string
      first_sequence: number
      last_sequence: number
      last_storage_id: number
    }>
    this.sqlite
      .prepare(
        `DELETE FROM agent_runs
         WHERE chat_id = ? AND sub_chat_id = ? AND runtime_adapter_version = ?
           AND id IN (${ids.map(() => "?").join(",")})`,
      )
      .run(input.chatId, input.subChatId, FIXTURE_ADAPTER_VERSION, ...ids)
    if (!invalidate) return
    for (const range of ranges) {
      this.options.onInvalidated?.({
        reason: "retention",
        runId: range.run_id,
        chatId: range.chat_id,
        firstSequence: range.first_sequence,
        lastSequence: range.last_sequence,
        lastStorageId: range.last_storage_id,
        insertedCount: 0,
      })
    }
  }
}

export function createDevRuntimeActivityFixtureService(
  database: DatabaseLike,
  activityStore: AgentActivityStore,
  options: DevRuntimeActivityFixtureServiceOptions,
): DevRuntimeActivityFixtureService {
  return new DevRuntimeActivityFixtureService(database, activityStore, options)
}

function fixtureRunIds(input: DevRuntimeActivityFixtureInput): string[] {
  const scope = createHash("sha256")
    .update(`${input.projectId}\u0000${input.chatId}\u0000${input.subChatId}`)
    .digest("hex")
    .slice(0, 20)
  return FIXTURE_RUNS.map((run) => `dev-runtime-fixture-${scope}-${run.terminal}`)
}

function fixtureCapabilities() {
  const supported = { supported: true, reason: null }
  return {
    schemaVersion: 1,
    status: "available",
    capturedAt: "2026-01-15T12:00:00.000Z",
    controls: {
      modelThinking: supported,
      reasoningDisplay: supported,
      subagentActivity: supported,
      hookDiagnostics: supported,
    },
    limitations: ["Deterministic Runtime activity test fixture. No provider process is launched."],
    unavailableReason: null,
  }
}

function fixtureControls() {
  return {
    schemaVersion: 1,
    modelEffort: "medium",
    modelThinking: true,
    reasoningDisplay: true,
    subagentActivity: true,
    hookDiagnostics: true,
  }
}

function completedRunEvents(): AgentActivityAppend[] {
  return [
    fixtureEvent(1, "lifecycle", { state: "queued", detail: "Fixture run queued." }, "queued"),
    fixtureEvent(
      2,
      "status",
      { message: "Fixture run started.", code: "fixture-start" },
      "started",
    ),
    fixtureEvent(
      3,
      "agent-text",
      { text: "Deterministic fixture answer for search and copy." },
      "delta",
    ),
    fixtureEvent(
      4,
      "reasoning-summary",
      { text: "Fixture summary section one.", label: "Summary" },
      "delta",
      {
        providerItemId: "fixture-reasoning",
        summaryIndex: 0,
        contentIndex: 0,
      },
    ),
    fixtureEvent(
      5,
      "reasoning-summary",
      { text: "Fixture summary section two.", label: "Summary" },
      "completed",
      {
        providerItemId: "fixture-reasoning",
        summaryIndex: 0,
        contentIndex: 0,
        sectionBoundary: "section-2",
      },
    ),
    fixtureEvent(6, "provider-visible-reasoning", {
      text: "Provider-visible fixture rationale.",
      label: "Visible rationale",
    }),
    fixtureEvent(7, "plan", {
      text: null,
      items: [
        { id: "fixture-step-1", text: "Inspect deterministic input", status: "completed" },
        { id: "fixture-step-2", text: "Return bounded output", status: "completed" },
      ],
    }),
    fixtureEvent(8, "tool", {
      name: "FixtureRead",
      state: "completed",
      inputSummary: "Bounded fixture input.",
      outputSummary: "Bounded fixture output.",
    }),
    fixtureEvent(9, "command", {
      command: "fixture-check",
      state: "completed",
      exitCode: 0,
      outputSummary: "Fixture command completed without external execution.",
    }),
    fixtureEvent(10, "patch", {
      path: null,
      state: "completed",
      summary: "Synthetic patch summary; no file was changed.",
    }),
    fixtureEvent(11, "permission", {
      requestType: "fixture-read",
      state: "completed",
      decision: "allowed-by-fixture",
    }),
    fixtureEvent(12, "hook", {
      name: "FixtureHook",
      state: "completed",
      summary: "Synthetic hook diagnostic.",
    }),
    fixtureEvent(13, "subagent", {
      agentId: "fixture-child",
      state: "completed",
      message: "Synthetic child activity.",
    }),
    fixtureEvent(14, "warning", {
      message: "Synthetic recoverable warning.",
      code: "fixture-warning",
    }),
    fixtureEvent(15, "compaction", {
      state: "completed",
      summary: "Synthetic context compaction.",
    }),
    fixtureEvent(16, "usage", {
      inputTokens: 12,
      outputTokens: 8,
      cachedTokens: 4,
      reasoningTokens: 2,
      costUsd: 0,
    }),
    fixtureEvent(17, "opaque-metadata", {
      eventType: "fixture-metadata",
      metadata: { source: "dev-fixture", schemaVersion: 1 },
    }),
    fixtureEvent(
      18,
      "private-metadata",
      {
        eventType: "private-content-omitted",
        metadata: null,
      },
      "snapshot",
      { displayClass: "private", privacyClass: "private" },
    ),
    fixtureEvent(19, "agent-text", { text: "Fixture run completed." }, "completed"),
    fixtureEvent(
      20,
      "lifecycle",
      { state: "completed", detail: "Fixture terminal success." },
      "completed",
    ),
  ]
}

function terminalRunEvents(terminal: "cancelled" | "failed"): AgentActivityAppend[] {
  return [
    fixtureEvent(
      1,
      "lifecycle",
      { state: "queued", detail: `Fixture ${terminal} run queued.` },
      "queued",
      {
        providerSessionId: `fixture-${terminal}-session`,
      },
    ),
    fixtureEvent(
      2,
      "status",
      { message: `Fixture ${terminal} run started.`, code: `fixture-${terminal}` },
      "started",
      {
        providerSessionId: `fixture-${terminal}-session`,
      },
    ),
    fixtureEvent(
      3,
      "lifecycle",
      {
        state: terminal,
        detail:
          terminal === "cancelled"
            ? "Fixture cancellation acknowledged."
            : "Sanitized fixture failure.",
      },
      terminal,
      { providerSessionId: `fixture-${terminal}-session` },
    ),
  ]
}

function fixtureEvent<K extends AgentActivityKind>(
  sequence: number,
  kind: K,
  payload: AgentActivityPayloadByKind[K],
  phase: AgentActivityPhase = "completed",
  overrides: Partial<AgentActivityAppend> = {},
): AgentActivityAppend {
  const identity = `${kind}-${sequence}`
  return {
    provider: FIXTURE_PROVIDER,
    phase,
    displayClass:
      kind === "tool" || kind === "command" || kind === "patch" ? "tool" : "provider-visible",
    privacyClass: "public",
    providerTimestamp: FIXTURE_BASE_TIME + sequence * 1_000,
    receivedAt: FIXTURE_BASE_TIME + sequence * 1_000 + 10,
    providerEventId: `fixture-event-${identity}`,
    providerSessionId: "fixture-completed-session",
    providerThreadId: "fixture-thread",
    providerTurnId: "fixture-turn",
    providerItemId: `fixture-item-${identity}`,
    dedupKey: `dev-fixture:${identity}`,
    kind,
    payload,
    ...overrides,
  } as AgentActivityAppend
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as unknown as { $client: Sqlite }).$client
}
