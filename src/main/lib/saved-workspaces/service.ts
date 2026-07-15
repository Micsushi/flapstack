import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import {
  savedWorkspaceLayoutJsonSchema,
  savedWorkspaceLayoutSchema,
  savedWorkspacePaneBindingSchema,
  type SavedWorkspaceLayout,
  type SavedWorkspaceOwner,
  type SavedWorkspacePaneBinding,
  type SavedWorkspaceRosterEntry,
  type SavedWorkspaceScope,
} from "../../../shared/saved-workspaces"
import { epochSecondsToMilliseconds, nowEpochSeconds } from "../db/timestamps"
import {
  deriveOperationRoster,
  isOperationWorkspaceDeletionIntent,
  markOperationWorkspaceDeletedInTransaction,
} from "./operations"

const WORKSPACE_COLUMNS = `
  id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
  layout_version, layout_json, sort_order, version, created_at, updated_at, archived_at
`

type WorkspaceRow = {
  id: string
  name: string
  scope_type: "project" | "task"
  project_id: string | null
  task_id: string | null
  owner_kind: "manual" | "orchestration"
  orchestration_id: string | null
  layout_version: number
  layout_json: string
  sort_order: string
  version: number
  created_at: number
  updated_at: number
  archived_at: number | null
}

export type SavedWorkspaceRecord = {
  id: string
  name: string
  scope: SavedWorkspaceScope
  owner: SavedWorkspaceOwner
  layoutVersion: 1
  layout: SavedWorkspaceLayout | null
  layoutIssue: string | null
  roster: SavedWorkspaceRosterEntry[]
  sortOrder: string
  version: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type SavedWorkspaceSummary = Omit<
  SavedWorkspaceRecord,
  "layout" | "layoutIssue" | "roster"
> & {
  layoutState: "ready" | "repair-required"
}

export type SavedWorkspaceDeleteImpact = {
  workspaceId: string
  workspaceVersion: number
  metadataOnly: true
  scope: SavedWorkspaceScope
  owner: SavedWorkspaceOwner
  layoutMalformed: boolean
  references: {
    chatIds: string[]
    orchestrationIds: string[]
    filePaths: string[]
    worktreePaths: string[]
    browserUrls: string[]
  }
  operation: {
    taskId: string
    status: string
    active: boolean
    agentCount: number
    materializedChatCount: number
    canRegenerateFromLineage: true
  } | null
  preserves: readonly [
    "projects",
    "tasks",
    "chats",
    "runs",
    "files",
    "orchestrations",
    "orchestration-agents",
    "usage",
  ]
}

export type SavedWorkspaceLifecycleErrorCode =
  "not-found" | "conflict" | "invalid-input" | "repair-target-not-found"

export class SavedWorkspaceLifecycleError extends Error {
  constructor(
    readonly code: SavedWorkspaceLifecycleErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "SavedWorkspaceLifecycleError"
  }
}

export type SavedWorkspaceLifecycleOperation =
  | "create"
  | "save-layout"
  | "rename"
  | "duplicate"
  | "archive"
  | "restore"
  | "delete"
  | "repair-binding"

export type SavedWorkspaceLifecycleHooks = {
  afterWriteBeforeCommit?: (operation: SavedWorkspaceLifecycleOperation) => void
}

export class SavedWorkspaceLifecycleService {
  constructor(
    private readonly databasePath: string,
    private readonly hooks: SavedWorkspaceLifecycleHooks = {},
  ) {}

  list(
    input: {
      projectId?: string
      taskId?: string
      archive?: "active" | "archived" | "all"
      ownerKind?: "manual" | "orchestration"
      search?: string
    } = {},
  ): SavedWorkspaceSummary[] {
    if (input.projectId && input.taskId) {
      fail("invalid-input", "Filter by one project or one task, not both.")
    }
    return this.withDatabase((database) => {
      const conditions: string[] = []
      const parameters: unknown[] = []
      if (input.projectId) {
        conditions.push(
          "((scope_type = 'project' AND project_id = ?) OR (scope_type = 'task' AND task_id IN (SELECT id FROM tasks WHERE project_id = ?)))",
        )
        parameters.push(input.projectId, input.projectId)
      }
      if (input.taskId) {
        conditions.push("scope_type = 'task' AND task_id = ?")
        parameters.push(input.taskId)
      }
      if ((input.archive ?? "active") === "active") conditions.push("archived_at IS NULL")
      if (input.archive === "archived") conditions.push("archived_at IS NOT NULL")
      if (input.ownerKind) {
        conditions.push("owner_kind = ?")
        parameters.push(input.ownerKind)
      }
      const search = input.search?.trim()
      if (search) {
        conditions.push("name COLLATE NOCASE LIKE ? ESCAPE '\\'")
        parameters.push(`%${escapeLike(search)}%`)
      }
      const rows = database
        .prepare(
          `SELECT ${WORKSPACE_COLUMNS} FROM saved_workspaces
           ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
           ORDER BY (archived_at IS NOT NULL), sort_order, updated_at DESC, id`,
        )
        .all(...parameters) as WorkspaceRow[]
      return rows
        .filter((row) => !isOperationWorkspaceDeletionIntent(row))
        .map((row) => {
          const record = toRecord(database, row, false)
          const { layout, layoutIssue, roster: _roster, ...summary } = record
          return {
            ...summary,
            layoutState: layout && !layoutIssue ? "ready" : "repair-required",
          }
        })
    })
  }

  get(workspaceId: string): SavedWorkspaceRecord {
    return this.withDatabase((database) => toRecord(database, requireRow(database, workspaceId)))
  }

  create(input: {
    name: string
    scope: SavedWorkspaceScope
    layout: SavedWorkspaceLayout
    sortOrder?: string
  }): SavedWorkspaceRecord {
    const name = validName(input.name)
    const layout = savedWorkspaceLayoutSchema.parse(input.layout)
    const sortOrder = validSortOrder(input.sortOrder ?? "a0")
    return this.withDatabase((database) =>
      database
        .transaction(() => {
          const id = randomUUID()
          const now = nowEpochSeconds()
          database
            .prepare(
              `INSERT INTO saved_workspaces
                 (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
                  layout_version, layout_json, sort_order, version, created_at, updated_at,
                  archived_at)
               VALUES (?, ?, ?, ?, ?, 'manual', NULL, 1, ?, ?, 1, ?, ?, NULL)`,
            )
            .run(
              id,
              name,
              input.scope.type,
              input.scope.type === "project" ? input.scope.projectId : null,
              input.scope.type === "task" ? input.scope.taskId : null,
              JSON.stringify(layout),
              sortOrder,
              now,
              now,
            )
          this.afterWrite("create")
          return toRecord(database, requireRow(database, id))
        })
        .immediate(),
    )
  }

  saveLayout(input: {
    workspaceId: string
    expectedVersion: number
    layout: SavedWorkspaceLayout
  }): SavedWorkspaceRecord {
    const layout = savedWorkspaceLayoutSchema.parse(input.layout)
    return this.casUpdate(
      input.workspaceId,
      input.expectedVersion,
      "save-layout",
      (database, now) =>
        database
          .prepare(
            `UPDATE saved_workspaces
           SET layout_version = 1, layout_json = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
          )
          .run(JSON.stringify(layout), now, input.workspaceId, input.expectedVersion),
    )
  }

  rename(input: {
    workspaceId: string
    expectedVersion: number
    name: string
  }): SavedWorkspaceRecord {
    const name = validName(input.name)
    return this.casUpdate(input.workspaceId, input.expectedVersion, "rename", (database, now) =>
      database
        .prepare(
          `UPDATE saved_workspaces
           SET name = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(name, now, input.workspaceId, input.expectedVersion),
    )
  }

  duplicate(input: {
    workspaceId: string
    expectedVersion: number
    name?: string
  }): SavedWorkspaceRecord {
    return this.withDatabase((database) =>
      database
        .transaction(() => {
          const source = requireRow(database, input.workspaceId)
          requireVersion(source, input.expectedVersion)
          if (source.owner_kind === "orchestration") {
            fail("invalid-input", "Operation workspaces cannot be duplicated as manual workspaces.")
          }
          const parsedLayout = savedWorkspaceLayoutJsonSchema.safeParse(source.layout_json)
          if (!parsedLayout.success) {
            fail("invalid-input", "Repair the source workspace layout before duplicating it.")
          }
          const id = randomUUID()
          const now = nowEpochSeconds()
          database
            .prepare(
              `INSERT INTO saved_workspaces
                 (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
                  layout_version, layout_json, sort_order, version, created_at, updated_at,
                  archived_at)
               VALUES (?, ?, ?, ?, ?, 'manual', NULL, 1, ?, ?, 1, ?, ?, NULL)`,
            )
            .run(
              id,
              validName(input.name ?? `${source.name} copy`),
              source.scope_type,
              source.project_id,
              source.task_id,
              JSON.stringify(parsedLayout.data),
              source.sort_order,
              now,
              now,
            )
          this.afterWrite("duplicate")
          return toRecord(database, requireRow(database, id))
        })
        .immediate(),
    )
  }

  archive(input: {
    workspaceId: string
    expectedVersion: number
    confirmActiveOperationImpact?: boolean
  }): {
    workspace: SavedWorkspaceRecord
    undo: { workspaceId: string; expectedVersion: number }
  } {
    const workspace = this.casUpdate(
      input.workspaceId,
      input.expectedVersion,
      "archive",
      (database, now) => {
        requireActiveOperationImpactConfirmation(
          database,
          requireRow(database, input.workspaceId),
          input.confirmActiveOperationImpact,
        )
        return database
          .prepare(
            `UPDATE saved_workspaces
             SET archived_at = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND archived_at IS NULL`,
          )
          .run(now, now, input.workspaceId, input.expectedVersion)
      },
    )
    return {
      workspace,
      undo: { workspaceId: workspace.id, expectedVersion: workspace.version },
    }
  }

  restore(input: { workspaceId: string; expectedVersion: number }): SavedWorkspaceRecord {
    return this.casUpdate(input.workspaceId, input.expectedVersion, "restore", (database, now) =>
      database
        .prepare(
          `UPDATE saved_workspaces
           SET archived_at = NULL, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ? AND archived_at IS NOT NULL`,
        )
        .run(now, input.workspaceId, input.expectedVersion),
    )
  }

  previewDelete(workspaceId: string): SavedWorkspaceDeleteImpact {
    return this.withDatabase((database) =>
      deleteImpact(database, requireRow(database, workspaceId)),
    )
  }

  delete(input: {
    workspaceId: string
    expectedVersion: number
    confirmActiveOperationImpact?: boolean
  }): {
    deleted: true
    impact: SavedWorkspaceDeleteImpact
  } {
    return this.withDatabase((database) =>
      database
        .transaction(() => {
          const row = requireRow(database, input.workspaceId)
          requireVersion(row, input.expectedVersion)
          requireActiveOperationImpactConfirmation(
            database,
            row,
            input.confirmActiveOperationImpact,
          )
          const impact = deleteImpact(database, row)
          const result =
            row.owner_kind === "orchestration" && row.task_id
              ? markOperationWorkspaceDeletedInTransaction(database, {
                  workspaceId: row.id,
                  taskId: row.task_id,
                  expectedVersion: input.expectedVersion,
                })
              : database
                  .prepare("DELETE FROM saved_workspaces WHERE id = ? AND version = ?")
                  .run(input.workspaceId, input.expectedVersion)
          if (result.changes !== 1) conflict(database, input.workspaceId)
          this.afterWrite("delete")
          return { deleted: true as const, impact }
        })
        .immediate(),
    )
  }

  repairBinding(input: {
    workspaceId: string
    expectedVersion: number
    paneId: string
    binding: SavedWorkspacePaneBinding
  }): SavedWorkspaceRecord {
    const binding = savedWorkspacePaneBindingSchema.parse(input.binding)
    return this.withDatabase((database) =>
      database
        .transaction(() => {
          const row = requireRow(database, input.workspaceId)
          requireVersion(row, input.expectedVersion)
          let raw: unknown
          try {
            raw = JSON.parse(row.layout_json) as unknown
          } catch {
            fail("invalid-input", "Workspace layout JSON cannot be repaired as a pane binding.")
          }
          const matches = replacePaneBinding(raw, input.paneId, binding)
          if (matches === 0) {
            fail("repair-target-not-found", `Pane ${input.paneId} does not exist.`)
          }
          if (matches > 1) {
            fail("invalid-input", `Pane ${input.paneId} is ambiguous.`)
          }
          const layout = savedWorkspaceLayoutSchema.safeParse(raw)
          if (!layout.success) {
            fail(
              "invalid-input",
              `Workspace still has invalid layout data: ${layout.error.issues[0]?.message ?? "unknown error"}`,
            )
          }
          const now = nowEpochSeconds()
          const result = database
            .prepare(
              `UPDATE saved_workspaces
               SET layout_json = ?, layout_version = 1, version = version + 1, updated_at = ?
               WHERE id = ? AND version = ?`,
            )
            .run(JSON.stringify(layout.data), now, input.workspaceId, input.expectedVersion)
          if (result.changes !== 1) conflict(database, input.workspaceId)
          this.afterWrite("repair-binding")
          return toRecord(database, requireRow(database, input.workspaceId))
        })
        .immediate(),
    )
  }

  private casUpdate(
    workspaceId: string,
    expectedVersion: number,
    operation: SavedWorkspaceLifecycleOperation,
    update: (database: Database.Database, now: number) => Database.RunResult,
  ): SavedWorkspaceRecord {
    return this.withDatabase((database) =>
      database
        .transaction(() => {
          requireVersion(requireRow(database, workspaceId), expectedVersion)
          const result = update(database, nowEpochSeconds())
          if (result.changes !== 1) conflict(database, workspaceId)
          this.afterWrite(operation)
          return toRecord(database, requireRow(database, workspaceId))
        })
        .immediate(),
    )
  }

  private afterWrite(operation: SavedWorkspaceLifecycleOperation): void {
    this.hooks.afterWriteBeforeCommit?.(operation)
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    const database = new Database(this.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } catch (error) {
      if (error instanceof SavedWorkspaceLifecycleError) throw error
      const message = error instanceof Error ? error.message : "Saved workspace lifecycle failed."
      if (/FOREIGN KEY|CHECK constraint|UNIQUE constraint/i.test(message)) {
        fail("invalid-input", message)
      }
      throw error
    } finally {
      database.close()
    }
  }
}

function requireRow(database: Database.Database, workspaceId: string): WorkspaceRow {
  const row = database
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM saved_workspaces WHERE id = ?`)
    .get(workspaceId) as WorkspaceRow | undefined
  if (!row || isOperationWorkspaceDeletionIntent(row)) {
    fail("not-found", `Saved workspace ${workspaceId} was not found.`)
  }
  return row
}

function requireVersion(row: WorkspaceRow, expectedVersion: number): void {
  if (row.version !== expectedVersion) {
    fail(
      "conflict",
      `Saved workspace changed in another window. Expected version ${expectedVersion}; current version is ${row.version}.`,
    )
  }
}

function conflict(database: Database.Database, workspaceId: string): never {
  const current = database
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM saved_workspaces WHERE id = ?`)
    .get(workspaceId) as WorkspaceRow | undefined
  if (!current || isOperationWorkspaceDeletionIntent(current)) {
    fail("not-found", `Saved workspace ${workspaceId} was not found.`)
  }
  fail(
    "conflict",
    `Saved workspace changed in another window. Current version is ${current.version}.`,
  )
}

function toRecord(
  database: Database.Database,
  row: WorkspaceRow,
  includeRoster = true,
): SavedWorkspaceRecord {
  const parsed = savedWorkspaceLayoutJsonSchema.safeParse(row.layout_json)
  const scope: SavedWorkspaceScope =
    row.scope_type === "project"
      ? { type: "project", projectId: row.project_id! }
      : { type: "task", taskId: row.task_id! }
  const owner: SavedWorkspaceOwner =
    row.owner_kind === "manual"
      ? { kind: "manual" }
      : { kind: "orchestration", orchestrationId: row.orchestration_id! }
  return {
    id: row.id,
    name: row.name,
    scope,
    owner,
    layoutVersion: 1,
    layout: parsed.success ? parsed.data : null,
    layoutIssue: parsed.success
      ? null
      : parsed.error.issues.map((issue) => issue.message).join(" "),
    roster:
      includeRoster && row.owner_kind === "orchestration" && row.task_id
        ? deriveOperationRoster(database, row.task_id)
        : [],
    sortOrder: row.sort_order,
    version: row.version,
    createdAt: epochSecondsToMilliseconds(row.created_at) ?? 0,
    updatedAt: epochSecondsToMilliseconds(row.updated_at) ?? 0,
    archivedAt: epochSecondsToMilliseconds(row.archived_at),
  }
}

function deleteImpact(database: Database.Database, row: WorkspaceRow): SavedWorkspaceDeleteImpact {
  const references = {
    chatIds: new Set<string>(),
    orchestrationIds: new Set<string>(),
    filePaths: new Set<string>(),
    worktreePaths: new Set<string>(),
    browserUrls: new Set<string>(),
  }
  if (row.orchestration_id) references.orchestrationIds.add(row.orchestration_id)
  let raw: unknown
  try {
    raw = JSON.parse(row.layout_json) as unknown
  } catch {
    raw = null
  }
  if (raw) {
    visitObjects(raw, (value) => {
      const binding = value.binding
      if (!binding || typeof binding !== "object") return
      const item = binding as Record<string, unknown>
      if (item.type === "chat" && typeof item.chatId === "string") {
        references.chatIds.add(item.chatId)
      }
      if (
        ["agent-roster", "selected-agent", "activity"].includes(String(item.type)) &&
        typeof item.orchestrationId === "string"
      ) {
        references.orchestrationIds.add(item.orchestrationId)
      }
      if (item.type === "file" && typeof item.path === "string") {
        references.filePaths.add(item.path)
      }
      if (typeof item.worktreePath === "string") references.worktreePaths.add(item.worktreePath)
      if (item.type === "browser" && typeof item.url === "string") {
        references.browserUrls.add(item.url)
      }
    })
  }
  const scope: SavedWorkspaceScope =
    row.scope_type === "project"
      ? { type: "project", projectId: row.project_id! }
      : { type: "task", taskId: row.task_id! }
  const owner: SavedWorkspaceOwner =
    row.owner_kind === "manual"
      ? { kind: "manual" }
      : { kind: "orchestration", orchestrationId: row.orchestration_id! }
  return {
    workspaceId: row.id,
    workspaceVersion: row.version,
    metadataOnly: true,
    scope,
    owner,
    layoutMalformed: !savedWorkspaceLayoutJsonSchema.safeParse(row.layout_json).success,
    references: {
      chatIds: [...references.chatIds].sort(),
      orchestrationIds: [...references.orchestrationIds].sort(),
      filePaths: [...references.filePaths].sort(),
      worktreePaths: [...references.worktreePaths].sort(),
      browserUrls: [...references.browserUrls].sort(),
    },
    operation: operationImpact(database, row),
    preserves: [
      "projects",
      "tasks",
      "chats",
      "runs",
      "files",
      "orchestrations",
      "orchestration-agents",
      "usage",
    ],
  }
}

function operationImpact(
  database: Database.Database,
  row: WorkspaceRow,
): SavedWorkspaceDeleteImpact["operation"] {
  if (row.owner_kind !== "orchestration" || !row.task_id) return null
  const operation = database
    .prepare(
      `SELECT o.status,
              count(a.id) AS agent_count,
              count(DISTINCT a.chat_id) AS materialized_chat_count
       FROM task_orchestrations o
       LEFT JOIN orchestration_agents a ON a.task_id = o.task_id
       WHERE o.task_id = ?
       GROUP BY o.task_id, o.status`,
    )
    .get(row.task_id) as
    { status: string; agent_count: number; materialized_chat_count: number } | undefined
  if (!operation) return null
  return {
    taskId: row.task_id,
    status: operation.status,
    active: !["completed", "failed", "stopped"].includes(operation.status),
    agentCount: operation.agent_count,
    materializedChatCount: operation.materialized_chat_count,
    canRegenerateFromLineage: true,
  }
}

function requireActiveOperationImpactConfirmation(
  database: Database.Database,
  row: WorkspaceRow,
  confirmed: boolean | undefined,
): void {
  const impact = operationImpact(database, row)
  if (impact?.active && !confirmed) {
    fail(
      "invalid-input",
      "Preview and confirm the active operation impact before archiving or deleting this workspace.",
    )
  }
}

function replacePaneBinding(
  value: unknown,
  paneId: string,
  binding: SavedWorkspacePaneBinding,
): number {
  let matches = 0
  visitObjects(value, (item) => {
    if (item.id === paneId && Object.prototype.hasOwnProperty.call(item, "binding")) {
      item.binding = binding
      matches += 1
    }
  })
  return matches
}

function visitObjects(value: unknown, visitor: (value: Record<string, unknown>) => void): void {
  const pending: unknown[] = [value]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== "object") continue
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    const record = current as Record<string, unknown>
    visitor(record)
    pending.push(...Object.values(record))
  }
}

function validName(value: string): string {
  const name = value.trim()
  if (!name || name.length > 256) fail("invalid-input", "Workspace name must be 1-256 characters.")
  return name
}

function validSortOrder(value: string): string {
  const order = value.trim()
  if (!order || order.length > 512) {
    fail("invalid-input", "Workspace sort order must be 1-512 characters.")
  }
  return order
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function fail(code: SavedWorkspaceLifecycleErrorCode, message: string): never {
  throw new SavedWorkspaceLifecycleError(code, message)
}
