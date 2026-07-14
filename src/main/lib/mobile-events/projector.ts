import { and, asc, eq, or, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  mobileSnapshotItemSchema,
  redactMobileText,
  type MobileAuthorityGrant,
  type MobileSnapshotItem,
} from "../../../shared/mobile-control"
import * as schema from "../db/schema"
import {
  agentRuns,
  automations,
  chats,
  orchestrationAgents,
  projects,
  taskOrchestrations,
  tasks,
} from "../db/schema"

type Database = BetterSQLite3Database<typeof schema>
export type MobileProjectedKind =
  "project" | "task" | "chat" | "run" | "orchestration" | "automation"

export const mobileProjectedKinds: readonly MobileProjectedKind[] = [
  "project",
  "task",
  "chat",
  "run",
  "orchestration",
  "automation",
]

type GrantScope = Record<MobileProjectedKind, string[]> & {
  project: string[]
  task: string[]
  chat: string[]
  run: string[]
  orchestration: string[]
  automation: string[]
}

export class MobileSnapshotProjector {
  constructor(private readonly database: Database) {}

  readPage(input: {
    grant: MobileAuthorityGrant
    after?: { kind: MobileProjectedKind; id: string }
    limit: number
  }): MobileSnapshotItem[] {
    const scope = grantScope(input.grant)
    const result: MobileSnapshotItem[] = []
    for (const kind of mobileProjectedKinds) {
      if (input.after && kindIndex(kind) < kindIndex(input.after.kind)) continue
      const afterId = input.after?.kind === kind ? input.after.id : undefined
      const remaining = input.limit - result.length
      if (remaining <= 0) break
      result.push(...this.readKind(kind, scope, afterId, remaining))
    }
    return result
  }

  readResource(
    grant: MobileAuthorityGrant,
    kind: MobileProjectedKind,
    id: string,
  ): MobileSnapshotItem | null {
    return this.readKind(kind, grantScope(grant), undefined, 1, id)[0] ?? null
  }

  resourceExists(kind: MobileProjectedKind, id: string): boolean {
    switch (kind) {
      case "project":
        return Boolean(
          this.database.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get(),
        )
      case "task":
        return Boolean(
          this.database.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get(),
        )
      case "chat":
        return Boolean(
          this.database.select({ id: chats.id }).from(chats).where(eq(chats.id, id)).get(),
        )
      case "run":
        return Boolean(
          this.database
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(eq(agentRuns.id, id))
            .get(),
        )
      case "orchestration":
        return Boolean(
          this.database
            .select({ id: taskOrchestrations.taskId })
            .from(taskOrchestrations)
            .where(eq(taskOrchestrations.taskId, id))
            .get(),
        )
      case "automation":
        return Boolean(
          this.database
            .select({ id: automations.id })
            .from(automations)
            .where(eq(automations.id, id))
            .get(),
        )
    }
  }

  grantCouldContain(grant: MobileAuthorityGrant, kind: MobileProjectedKind): boolean {
    const refs = new Set(grant.resources.map((resource) => resource.kind))
    switch (kind) {
      case "project":
        return refs.has("project")
      case "task":
        return refs.has("project") || refs.has("task")
      case "chat":
        return refs.has("project") || refs.has("task") || refs.has("chat")
      case "run":
        return refs.has("project") || refs.has("task") || refs.has("chat") || refs.has("run")
      case "orchestration":
        return refs.has("project") || refs.has("task") || refs.has("orchestration")
      case "automation":
        return refs.has("project") || refs.has("task") || refs.has("chat") || refs.has("automation")
    }
  }

  private readKind(
    kind: MobileProjectedKind,
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    switch (kind) {
      case "project":
        return this.readProjects(scope, afterId, limit, exactId)
      case "task":
        return this.readTasks(scope, afterId, limit, exactId)
      case "chat":
        return this.readChats(scope, afterId, limit, exactId)
      case "run":
        return this.readRuns(scope, afterId, limit, exactId)
      case "orchestration":
        return this.readOrchestrations(scope, afterId, limit, exactId)
      case "automation":
        return this.readAutomations(scope, afterId, limit, exactId)
    }
  }

  private readProjects(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select()
      .from(projects)
      .where(and(oneOf(projects.id, scope.project), idBounds(projects.id, afterId, exactId)))
      .orderBy(asc(projects.id))
      .limit(limit)
      .all()
      .map((row) =>
        item({
          kind: "project",
          id: row.id,
          version: version(row.updatedAt ?? row.createdAt),
          updatedAt: timestamp(row.updatedAt ?? row.createdAt),
          name: safeText(row.name, 240, "Project"),
        }),
      )
  }

  private readTasks(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select()
      .from(tasks)
      .where(
        and(
          or(oneOf(tasks.id, scope.task), oneOf(tasks.projectId, scope.project)),
          idBounds(tasks.id, afterId, exactId),
        ),
      )
      .orderBy(asc(tasks.id))
      .limit(limit)
      .all()
      .map((row) =>
        item({
          kind: "task",
          id: row.id,
          version: row.version,
          updatedAt: timestamp(row.updatedAt ?? row.createdAt),
          projectId: row.projectId,
          name: safeText(row.name, 240, "Task"),
          status: safeText(row.status, 80, "unknown"),
        }),
      )
  }

  private readChats(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select()
      .from(chats)
      .where(
        and(
          or(
            oneOf(chats.id, scope.chat),
            oneOf(chats.projectId, scope.project),
            oneOf(chats.taskId, scope.task),
          ),
          idBounds(chats.id, afterId, exactId),
        ),
      )
      .orderBy(asc(chats.id))
      .limit(limit)
      .all()
      .map((row) =>
        item({
          kind: "chat",
          id: row.id,
          version: version(row.updatedAt ?? row.createdAt),
          updatedAt: timestamp(row.updatedAt ?? row.createdAt),
          ...(row.projectId ? { projectId: row.projectId } : {}),
          ...(row.taskId ? { taskId: row.taskId } : {}),
          name: safeText(row.name, 240, "Chat"),
          harness: safeText(row.harness, 80, "unassigned"),
        }),
      )
  }

  private readRuns(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select({ run: agentRuns })
      .from(agentRuns)
      .innerJoin(chats, eq(agentRuns.chatId, chats.id))
      .where(
        and(
          or(
            oneOf(agentRuns.id, scope.run),
            oneOf(chats.id, scope.chat),
            oneOf(chats.projectId, scope.project),
            oneOf(chats.taskId, scope.task),
          ),
          idBounds(agentRuns.id, afterId, exactId),
        ),
      )
      .orderBy(asc(agentRuns.id))
      .limit(limit)
      .all()
      .map(({ run }) =>
        item({
          kind: "run",
          id: run.id,
          version: version(run.completedAt ?? run.startedAt),
          updatedAt: timestamp(run.completedAt ?? run.startedAt),
          chatId: run.chatId,
          harness: safeText(run.harness, 80, "unknown"),
          status: safeText(run.status, 80, "unknown"),
          startedAt: timestamp(run.startedAt),
          ...(run.completedAt ? { completedAt: run.completedAt.getTime() } : {}),
        }),
      )
  }

  private readOrchestrations(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select({ orchestration: taskOrchestrations, projectId: tasks.projectId })
      .from(taskOrchestrations)
      .innerJoin(tasks, eq(taskOrchestrations.taskId, tasks.id))
      .where(
        and(
          or(
            oneOf(taskOrchestrations.taskId, scope.orchestration),
            oneOf(taskOrchestrations.taskId, scope.task),
            oneOf(tasks.projectId, scope.project),
          ),
          idBounds(taskOrchestrations.taskId, afterId, exactId),
        ),
      )
      .orderBy(asc(taskOrchestrations.taskId))
      .limit(limit)
      .all()
      .map(({ orchestration }) =>
        item({
          kind: "orchestration",
          id: orchestration.taskId,
          version: version(orchestration.updatedAt ?? orchestration.createdAt),
          updatedAt: timestamp(orchestration.updatedAt ?? orchestration.createdAt),
          taskId: orchestration.taskId,
          status: safeText(orchestration.status, 80, "unknown"),
          progressPercent: this.orchestrationProgress(orchestration.taskId),
        }),
      )
  }

  private readAutomations(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select({
        automation: automations,
        taskProjectId: tasks.projectId,
        chatProjectId: chats.projectId,
        chatTaskId: chats.taskId,
      })
      .from(automations)
      .leftJoin(tasks, eq(automations.taskId, tasks.id))
      .leftJoin(chats, eq(automations.chatId, chats.id))
      .where(
        and(
          or(
            oneOf(automations.id, scope.automation),
            oneOf(automations.projectId, scope.project),
            oneOf(automations.taskId, scope.task),
            oneOf(automations.chatId, scope.chat),
            oneOf(tasks.projectId, scope.project),
            oneOf(chats.projectId, scope.project),
            oneOf(chats.taskId, scope.task),
          ),
          idBounds(automations.id, afterId, exactId),
        ),
      )
      .orderBy(asc(automations.id))
      .limit(limit)
      .all()
      .map(({ automation, taskProjectId, chatProjectId }) =>
        item({
          kind: "automation",
          id: automation.id,
          version: automation.version,
          updatedAt: timestamp(automation.updatedAt ?? automation.createdAt),
          ...(automation.projectId || taskProjectId || chatProjectId
            ? { projectId: automation.projectId ?? taskProjectId ?? chatProjectId! }
            : {}),
          name: safeText(automation.name, 240, "Automation"),
          status: safeText(automation.state, 80, "unknown"),
        }),
      )
  }

  private orchestrationProgress(taskId: string): number {
    const result = this.database
      .select({ value: sql<number>`coalesce(avg(${orchestrationAgents.progressPercent}), 0)` })
      .from(orchestrationAgents)
      .where(eq(orchestrationAgents.taskId, taskId))
      .get()
    return Math.max(0, Math.min(100, Math.round(Number(result?.value ?? 0))))
  }
}

function grantScope(grant: MobileAuthorityGrant): GrantScope {
  const scope: GrantScope = {
    project: [],
    task: [],
    chat: [],
    run: [],
    orchestration: [],
    automation: [],
  }
  for (const resource of grant.resources) {
    if (resource.kind in scope) scope[resource.kind as MobileProjectedKind].push(resource.id)
  }
  return scope
}

function oneOf(column: SQLWrapper, values: readonly string[]): SQL {
  if (values.length === 0) return sql`0`
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`
}

function idBounds(column: SQLWrapper, afterId?: string, exactId?: string): SQL | undefined {
  if (exactId) return sql`${column} = ${exactId}`
  return afterId ? sql`${column} > ${afterId}` : undefined
}

function item(value: unknown): MobileSnapshotItem {
  return mobileSnapshotItemSchema.parse(value)
}

function safeText(value: string | null | undefined, max: number, fallback: string): string {
  const redacted = redactMobileText(value?.trim() || fallback)
    .slice(0, max)
    .trim()
  return redacted || fallback
}

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

function version(value: Date | null | undefined): number {
  return Math.max(1, timestamp(value))
}

function kindIndex(kind: MobileProjectedKind): number {
  return mobileProjectedKinds.indexOf(kind)
}
