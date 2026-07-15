import Database from "better-sqlite3"
import {
  AutomationFileTriggerService,
  createDatabaseAutomationFileTriggerEnqueuer,
  type AutomationFileTriggerConfig,
} from "./file-trigger"
import { AutomationTriggerService } from "./triggers"

type Row = Record<string, unknown>

export interface AutomationTriggerRuntimeTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface AutomationTriggerRuntimeOptions {
  databasePath: string
  pollMs?: number
  timers?: AutomationTriggerRuntimeTimers
  fileTriggers?: Pick<AutomationFileTriggerService, "replaceTriggers" | "stop">
  terminalTriggers?: Pick<AutomationTriggerService, "handleRunTerminal">
  onError?: (error: Error) => void
}

const systemTimers: AutomationTriggerRuntimeTimers = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/** Starts durable file-change watches and projects terminal run rows into occurrences. */
export class AutomationTriggerRuntime {
  private readonly pollMs: number
  private readonly timers: AutomationTriggerRuntimeTimers
  private readonly fileTriggers: Pick<AutomationFileTriggerService, "replaceTriggers" | "stop">
  private readonly terminalTriggers: Pick<AutomationTriggerService, "handleRunTerminal">
  private timer: unknown | null = null
  private pass: Promise<void> | null = null
  private started = false
  private fileTriggerFingerprint = ""
  private terminalCompletedAt = -1
  private readonly terminalRunIdsAtCursor = new Set<string>()

  constructor(private readonly options: AutomationTriggerRuntimeOptions) {
    this.pollMs = boundedPollMs(options.pollMs ?? 1_000)
    this.timers = options.timers ?? systemTimers
    const enqueueOccurrence = createDatabaseAutomationFileTriggerEnqueuer(options.databasePath)
    this.fileTriggers =
      options.fileTriggers ??
      new AutomationFileTriggerService({
        enqueueOccurrence: (occurrence) => {
          enqueueOccurrence(occurrence)
        },
        onError: options.onError,
      })
    this.terminalTriggers =
      options.terminalTriggers ??
      new AutomationTriggerService({ databasePath: options.databasePath })
  }

  async start(): Promise<void> {
    if (this.started) return this.pass ?? Promise.resolve()
    this.started = true
    try {
      await this.runOnce()
    } catch (error) {
      this.started = false
      throw error
    }
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    await this.pass
    await this.fileTriggers.stop()
  }

  async runOnce(): Promise<void> {
    if (this.pass) return this.pass
    this.pass = this.runPass().finally(() => {
      this.pass = null
      if (this.started) this.schedule()
    })
    return this.pass
  }

  private async runPass(): Promise<void> {
    await this.refreshFileTriggers()
    this.projectTerminalRuns()
  }

  private async refreshFileTriggers(): Promise<void> {
    const configs = this.withDatabase((database) => loadActiveFileTriggers(database))
    const fingerprint = JSON.stringify(configs)
    if (fingerprint === this.fileTriggerFingerprint) return
    await this.fileTriggers.replaceTriggers(configs)
    this.fileTriggerFingerprint = fingerprint
  }

  private projectTerminalRuns(): void {
    let pageCompletedAt = this.terminalCompletedAt
    let pageRunId = ""
    while (true) {
      const rows = this.withDatabase(
        (database) =>
          database
            .prepare(
              `SELECT id, completed_at FROM agent_runs
             WHERE completed_at IS NOT NULL AND status IN ('success', 'failure', 'cancelled')
               AND (completed_at > ? OR (completed_at = ? AND id > ?))
             ORDER BY completed_at, id LIMIT 100`,
            )
            .all(pageCompletedAt, pageCompletedAt, pageRunId) as Row[],
      )
      if (rows.length === 0) return
      for (const row of rows) {
        const runId = String(row.id)
        const completedAt = Number(row.completed_at)
        pageCompletedAt = completedAt
        pageRunId = runId
        if (completedAt === this.terminalCompletedAt && this.terminalRunIdsAtCursor.has(runId)) {
          continue
        }
        if (completedAt > this.terminalCompletedAt) {
          this.terminalCompletedAt = completedAt
          this.terminalRunIdsAtCursor.clear()
        }
        this.terminalRunIdsAtCursor.add(runId)
        try {
          this.terminalTriggers.handleRunTerminal({ runId })
        } catch (error) {
          this.reportError(error)
        }
      }
      if (rows.length < 100) return
    }
  }

  private schedule(): void {
    if (!this.started || this.timer !== null) return
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      void this.runOnce().catch((error) => this.reportError(error))
    }, this.pollMs)
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    const database = new Database(this.options.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } finally {
      database.close()
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}

function loadActiveFileTriggers(database: Database.Database): AutomationFileTriggerConfig[] {
  const rows = database
    .prepare(
      `SELECT t.id trigger_id, t.automation_id, t.root_path, t.include_globs,
              t.exclude_globs, t.debounce_ms
       FROM automation_triggers t
       JOIN automations a ON a.id = t.automation_id
       WHERE t.type = 'file-change' AND t.enabled = 1
         AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
       ORDER BY t.id`,
    )
    .all() as Row[]
  return rows.map((row) => ({
    triggerId: String(row.trigger_id),
    automationId: String(row.automation_id),
    rootPath: String(row.root_path),
    includeGlobs: parseStringArray(row.include_globs, "include globs"),
    excludeGlobs: parseStringArray(row.exclude_globs, "exclude globs"),
    debounceMs: Number(row.debounce_ms),
  }))
}

function parseStringArray(value: unknown, label: string): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("invalid array")
    }
    return parsed
  } catch {
    throw new Error(`Automation file trigger ${label} are invalid.`)
  }
}

function boundedPollMs(value: number): number {
  if (!Number.isFinite(value)) return 1_000
  return Math.min(60_000, Math.max(100, Math.floor(value)))
}
