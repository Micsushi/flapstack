import { and, asc, eq, gt, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { AgentInputRequest } from "../../../shared/agent-input"
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
  fileChangeManifests,
  mcpApprovalRequests,
  orchestrationAgents,
  projects,
  taskOrchestrations,
  tasks,
  visualArtifactLinks,
  visualArtifacts,
} from "../db/schema"

type Database = BetterSQLite3Database<typeof schema>
export type MobileProjectedKind =
  | "project"
  | "task"
  | "chat"
  | "run"
  | "orchestration"
  | "automation"
  | "approval"
  | "agent-input"
  | "artifact"
  | "diff"
  | "check"

export const mobileProjectedKinds: readonly MobileProjectedKind[] = [
  "project",
  "task",
  "chat",
  "run",
  "orchestration",
  "automation",
  "approval",
  "agent-input",
  "artifact",
  "diff",
  "check",
]

type GrantScope = Record<MobileProjectedKind, string[]> & {
  project: string[]
  task: string[]
  chat: string[]
  run: string[]
  orchestration: string[]
  automation: string[]
  approval: string[]
  "agent-input": string[]
  artifact: string[]
  diff: string[]
  check: string[]
}

export class MobileSnapshotProjector {
  constructor(
    private readonly database: Database,
    private readonly now: () => number = Date.now,
    private readonly listAgentInputs: () => AgentInputRequest[] = () => [],
  ) {}

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
      case "approval":
        return (
          refs.has("project") ||
          refs.has("task") ||
          refs.has("chat") ||
          refs.has("run") ||
          refs.has("approval")
        )
      case "agent-input":
        return (
          refs.has("project") ||
          refs.has("task") ||
          refs.has("chat") ||
          refs.has("run") ||
          refs.has("agent-input")
        )
      case "artifact":
        return (
          refs.has("project") ||
          refs.has("task") ||
          refs.has("chat") ||
          refs.has("run") ||
          refs.has("artifact")
        )
      case "diff":
        return (
          refs.has("project") ||
          refs.has("task") ||
          refs.has("chat") ||
          refs.has("run") ||
          refs.has("diff")
        )
      case "check":
        return (
          refs.has("project") ||
          refs.has("task") ||
          refs.has("chat") ||
          refs.has("run") ||
          refs.has("check")
        )
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
      case "approval":
        return this.readApprovals(scope, afterId, limit, exactId)
      case "agent-input":
        return this.readAgentInputs(scope, afterId, limit, exactId)
      case "artifact":
        return this.readArtifacts(scope, afterId, limit, exactId)
      case "diff":
        return this.readDiffs(scope, afterId, limit, exactId)
      case "check":
        return this.readChecks(scope, afterId, limit, exactId)
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

  private readApprovals(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select({ approval: mcpApprovalRequests, projectId: chats.projectId, taskId: chats.taskId })
      .from(mcpApprovalRequests)
      .innerJoin(chats, eq(mcpApprovalRequests.callerChatId, chats.id))
      .where(
        and(
          isNull(mcpApprovalRequests.decision),
          gt(mcpApprovalRequests.expiresAt, new Date(this.now())),
          or(
            oneOf(mcpApprovalRequests.id, scope.approval),
            oneOf(mcpApprovalRequests.callerRunId, scope.run),
            oneOf(mcpApprovalRequests.callerChatId, scope.chat),
            oneOf(chats.projectId, scope.project),
            oneOf(chats.taskId, scope.task),
          ),
          idBounds(mcpApprovalRequests.id, afterId, exactId),
        ),
      )
      .orderBy(asc(mcpApprovalRequests.id))
      .limit(limit)
      .all()
      .map(({ approval, projectId, taskId }) =>
        item({
          kind: "approval",
          id: approval.id,
          version: version(approval.createdAt),
          updatedAt: timestamp(approval.createdAt),
          chatId: approval.callerChatId,
          ...(approval.callerRunId ? { runId: approval.callerRunId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(taskId ? { taskId } : {}),
          action: safeText(approval.toolName, 240, "Approval"),
          risk:
            approval.tier >= 3 ? "privileged" : approval.tier === 2 ? "lifecycle" : "bounded-input",
          expiresAt: approval.expiresAt.getTime(),
        }),
      )
  }

  private readArtifacts(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    const runId = sql<string>`(
      select ${visualArtifactLinks.consumerId}
      from ${visualArtifactLinks}
      where ${visualArtifactLinks.artifactId} = ${visualArtifacts.id}
        and ${visualArtifactLinks.consumerKind} = 'run'
      order by ${visualArtifactLinks.consumerId}
      limit 1
    )`
    return this.database
      .select({ artifact: visualArtifacts, runId })
      .from(visualArtifacts)
      .where(
        and(
          isNull(visualArtifacts.archivedAt),
          sql`exists (
            select 1 from ${visualArtifactLinks}
            where ${visualArtifactLinks.artifactId} = ${visualArtifacts.id}
              and ${visualArtifactLinks.consumerKind} = 'run'
          )`,
          or(
            oneOf(visualArtifacts.id, scope.artifact),
            oneOf(visualArtifacts.projectId, scope.project),
            oneOf(visualArtifacts.taskId, scope.task),
            oneOf(visualArtifacts.chatId, scope.chat),
            sql`${runId} in (${sql.join(
              scope.run.map((value) => sql`${value}`),
              sql`, `,
            )})`,
          ),
          idBounds(visualArtifacts.id, afterId, exactId),
        ),
      )
      .orderBy(asc(visualArtifacts.id))
      .limit(limit)
      .all()
      .map(({ artifact, runId: linkedRunId }) =>
        item({
          kind: "artifact",
          id: artifact.id,
          version: Math.max(1, artifact.createdAt),
          updatedAt: artifact.createdAt,
          runId: linkedRunId,
          name: "Visual capture",
          mediaType: artifact.mimeType,
          sizeBytes: artifact.byteLength,
        }),
      )
  }

  private readAgentInputs(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    const now = this.now()
    return this.listAgentInputs()
      .filter(
        (request) =>
          request.status === "pending" &&
          (request.expiresAt === undefined || request.expiresAt > now) &&
          (exactId ? request.requestId === exactId : !afterId || request.requestId > afterId),
      )
      .sort((left, right) => left.requestId.localeCompare(right.requestId))
      .flatMap((request) => {
        const owner = this.database
          .select({
            runId: agentRuns.id,
            chatId: chats.id,
            projectId: chats.projectId,
            taskId: chats.taskId,
          })
          .from(agentRuns)
          .innerJoin(chats, eq(agentRuns.chatId, chats.id))
          .where(and(eq(agentRuns.id, request.runId), eq(chats.id, request.chatId)))
          .get()
        if (
          !owner ||
          !(
            scope["agent-input"].includes(request.requestId) ||
            scope.run.includes(owner.runId) ||
            scope.chat.includes(owner.chatId) ||
            (owner.projectId !== null && scope.project.includes(owner.projectId)) ||
            (owner.taskId !== null && scope.task.includes(owner.taskId))
          )
        )
          return []
        return [
          item({
            kind: "agent-input",
            id: request.requestId,
            version: Math.max(1, request.createdAt),
            updatedAt: request.createdAt,
            chatId: request.chatId,
            runId: request.runId,
            ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
            questions: request.questions.map((question) => ({
              id: question.id,
              question: safeText(question.question, 2_000, "Question"),
              options: question.options.map((option) =>
                safeText(option.label, 200, "Unavailable option"),
              ),
              multiSelect: question.multiSelect,
              allowCustom: question.allowCustom,
            })),
          }),
        ]
      })
      .slice(0, limit)
  }

  private readDiffs(
    scope: GrantScope,
    afterId: string | undefined,
    limit: number,
    exactId?: string,
  ): MobileSnapshotItem[] {
    return this.database
      .select({
        run: agentRuns,
        filesChanged: sql<number>`count(${fileChangeManifests.id})`,
        additions: sql<number>`coalesce(sum(${fileChangeManifests.additions}), 0)`,
        deletions: sql<number>`coalesce(sum(${fileChangeManifests.deletions}), 0)`,
      })
      .from(agentRuns)
      .innerJoin(chats, eq(agentRuns.chatId, chats.id))
      .innerJoin(fileChangeManifests, eq(fileChangeManifests.runId, agentRuns.id))
      .where(
        and(
          or(oneOf(agentRuns.id, scope.diff), runScope(scope)),
          idBounds(agentRuns.id, afterId, exactId),
        ),
      )
      .groupBy(agentRuns.id)
      .orderBy(asc(agentRuns.id))
      .limit(limit)
      .all()
      .map(({ run, filesChanged, additions, deletions }) =>
        item({
          kind: "diff",
          id: run.id,
          version: version(run.completedAt ?? run.startedAt),
          updatedAt: timestamp(run.completedAt ?? run.startedAt),
          runId: run.id,
          filesChanged: Number(filesChanged),
          additions: Number(additions),
          deletions: Number(deletions),
          truncated: Number(filesChanged) > 100,
        }),
      )
  }

  private readChecks(
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
          or(oneOf(agentRuns.id, scope.check), runScope(scope)),
          idBounds(agentRuns.id, afterId, exactId),
        ),
      )
      .orderBy(asc(agentRuns.id))
      .limit(limit)
      .all()
      .map(({ run }) =>
        item({
          kind: "check",
          id: run.id,
          version: version(run.completedAt ?? run.startedAt),
          updatedAt: timestamp(run.completedAt ?? run.startedAt),
          runId: run.id,
          label: "Run status",
          status: checkStatus(run.status),
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
    approval: [],
    "agent-input": [],
    artifact: [],
    diff: [],
    check: [],
  }
  for (const resource of grant.resources) {
    if (resource.kind in scope) scope[resource.kind as MobileProjectedKind].push(resource.id)
  }
  return scope
}

function runScope(scope: GrantScope): SQL {
  return or(
    oneOf(agentRuns.id, scope.run),
    oneOf(chats.id, scope.chat),
    oneOf(chats.projectId, scope.project),
    oneOf(chats.taskId, scope.task),
  )!
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

function checkStatus(status: string): "pending" | "running" | "passed" | "failed" | "cancelled" {
  if (status === "success") return "passed"
  if (status === "failure") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "pending" || status === "queued") return "pending"
  return "running"
}
