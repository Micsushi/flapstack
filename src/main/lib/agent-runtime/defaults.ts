import Database from "better-sqlite3"
import {
  runtimeDefaultDeleteInputSchema,
  runtimeDefaultListInputSchema,
  runtimeDefaultWriteInputSchema,
  type AgentRuntimeDefaultDto,
  type AgentRuntimePreference,
  type RuntimeBlockReasonCode,
  type RuntimeDefaultScope,
} from "../../../shared/agent-runtime"
import { millisecondsToEpochSeconds } from "../db/timestamps"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type Row = Record<string, unknown>

export class RuntimeDefaultsError extends Error {
  constructor(
    readonly code: RuntimeBlockReasonCode,
    message: string,
  ) {
    super(message)
    this.name = "RuntimeDefaultsError"
  }
}

export class RuntimeDefaultsService {
  private readonly sqlite: Sqlite

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  list(inputValue: unknown = {}): AgentRuntimeDefaultDto[] {
    const input = runtimeDefaultListInputSchema.parse(inputValue)
    const filters: string[] = []
    const params: unknown[] = []
    if (input.scope) {
      filters.push(
        "scope_type = ?",
        input.scope.type === "global" ? "scope_id IS NULL" : "scope_id = ?",
      )
      params.push(input.scope.type)
      if (input.scope.type === "project") params.push(input.scope.id)
    }
    if (input.harness) {
      filters.push("harness = ?")
      params.push(input.harness)
    }
    const rows = this.sqlite
      .prepare(
        `SELECT scope_type, scope_id, harness, preference, version, created_at, updated_at
         FROM agent_runtime_defaults
         ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
         ORDER BY scope_type, scope_id, harness`,
      )
      .all(...params) as Row[]
    return rows.map(rowToDto)
  }

  get(scope: RuntimeDefaultScope, harness: string): AgentRuntimeDefaultDto | null {
    const row = this.sqlite
      .prepare(
        `SELECT scope_type, scope_id, harness, preference, version, created_at, updated_at
         FROM agent_runtime_defaults
         WHERE id = ?`,
      )
      .get(defaultId(scope, harness)) as Row | undefined
    return row ? rowToDto(row) : null
  }

  preference(scope: RuntimeDefaultScope, harness: string): AgentRuntimePreference | null {
    return this.get(scope, harness)?.preference ?? null
  }

  write(inputValue: unknown, now = Date.now()): AgentRuntimeDefaultDto {
    const input = runtimeDefaultWriteInputSchema.parse(inputValue)
    this.assertScope(input.scope)
    const id = defaultId(input.scope, input.harness)
    const current = this.get(input.scope, input.harness)
    if (!current) {
      if (input.expectedVersion !== 0) throw versionConflict()
      try {
        this.sqlite
          .prepare(
            `INSERT INTO agent_runtime_defaults (
               id, scope_type, scope_id, harness, preference, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            id,
            input.scope.type,
            input.scope.id,
            input.harness,
            input.preference,
            millisecondsToEpochSeconds(now),
            millisecondsToEpochSeconds(now),
          )
      } catch (error) {
        if (isConstraintError(error)) throw versionConflict()
        throw error
      }
    } else {
      if (current.version !== input.expectedVersion) throw versionConflict()
      const result = this.sqlite
        .prepare(
          `UPDATE agent_runtime_defaults
           SET preference = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(input.preference, millisecondsToEpochSeconds(now), id, input.expectedVersion)
      if (result.changes !== 1) throw versionConflict()
    }
    return this.get(input.scope, input.harness)!
  }

  delete(inputValue: unknown): boolean {
    const input = runtimeDefaultDeleteInputSchema.parse(inputValue)
    const result = this.sqlite
      .prepare("DELETE FROM agent_runtime_defaults WHERE id = ? AND version = ?")
      .run(defaultId(input.scope, input.harness), input.expectedVersion)
    if (result.changes !== 1) throw versionConflict()
    return true
  }

  private assertScope(scope: RuntimeDefaultScope): void {
    if (scope.type === "global") return
    const project = this.sqlite
      .prepare("SELECT id, archived_at FROM projects WHERE id = ?")
      .get(scope.id) as { id: string; archived_at: number | null } | undefined
    if (!project) {
      throw new RuntimeDefaultsError("project-missing", "Runtime defaults project is missing.")
    }
    if (project.archived_at !== null) {
      throw new RuntimeDefaultsError("project-missing", "Runtime defaults project is archived.")
    }
  }
}

export function createRuntimeDefaultsService(database: DatabaseLike): RuntimeDefaultsService {
  return new RuntimeDefaultsService(database)
}

function defaultId(scope: RuntimeDefaultScope, harness: string): string {
  return `${scope.type}:${scope.id ?? "global"}:${harness}`
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") {
    return database as Sqlite
  }
  return (database as unknown as { $client: Sqlite }).$client
}

function rowToDto(row: Row): AgentRuntimeDefaultDto {
  const type = String(row.scope_type) as RuntimeDefaultScope["type"]
  return {
    scope:
      type === "global"
        ? { type: "global", id: null }
        : { type: "project", id: String(row.scope_id) },
    harness: String(row.harness),
    preference: String(row.preference) as AgentRuntimePreference,
    version: Number(row.version),
    createdAt: epochMilliseconds(row.created_at),
    updatedAt: epochMilliseconds(row.updated_at),
  }
}

function versionConflict(): RuntimeDefaultsError {
  return new RuntimeDefaultsError(
    "settings-version-conflict",
    "Agent Runtime defaults version conflict.",
  )
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message)
}

function epochMilliseconds(value: unknown): number {
  const numeric = Number(value)
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
}
