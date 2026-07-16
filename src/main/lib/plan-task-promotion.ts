import { createHash } from "node:crypto"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { ProjectPlanSnapshot } from "../../shared/plan-sources"
import type {
  PlanCandidateReference,
  PlanTaskPromotionConfirmInput,
  PlanTaskPromotionPreview,
  PlanTaskPromotionPreviewInput,
} from "../../shared/plan-task-promotion"
import { createRebalancedBoardOrders } from "../../shared/task-kanban"
import {
  parseCustomPermissionToggles,
  parsePermissionMode,
  type CustomPermissionToggles,
} from "./permissions"
import * as schema from "./db/schema"
import { agentRuns, chats, projects, subChats, tasks } from "./db/schema"

type Database = BetterSQLite3Database<typeof schema>

export class PlanTaskPromotionError extends Error {
  constructor(
    readonly code: "not-found" | "stale-source" | "invalid-candidate" | "inconsistent-state",
    message: string,
  ) {
    super(message)
    this.name = "PlanTaskPromotionError"
  }
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32)
  return `${prefix}-${digest}`
}

function parseStoredCustomPermissions(value: string | null): CustomPermissionToggles | null {
  if (!value) return null
  try {
    return parseCustomPermissionToggles(JSON.parse(value))
  } catch {
    return null
  }
}

function resolveCandidate(snapshot: ProjectPlanSnapshot, reference: PlanCandidateReference) {
  if (snapshot.projectId !== reference.sourceProjectId) {
    throw new PlanTaskPromotionError("not-found", "Plan source project is missing.")
  }
  const source = snapshot.sources.find(
    (item) => item.id === reference.sourceId && item.path === reference.sourcePath,
  )
  if (!source) throw new PlanTaskPromotionError("not-found", "Plan source is missing.")
  if (
    source.status !== "current" ||
    source.stale ||
    source.fingerprint !== reference.sourceFingerprint
  ) {
    throw new PlanTaskPromotionError(
      "stale-source",
      "The plan source changed. Refresh it before promoting this candidate.",
    )
  }
  const candidate = source.candidates.find((item) => item.id === reference.candidateId)
  if (!candidate) {
    throw new PlanTaskPromotionError(
      "stale-source",
      "The plan candidate changed or was removed. Refresh the plan before promoting it.",
    )
  }
  if (candidate.fingerprint !== reference.candidateFingerprint) {
    throw new PlanTaskPromotionError(
      "stale-source",
      "The plan candidate changed. Refresh it before promoting.",
    )
  }
  if (!(["task", "checklist"] as const).includes(candidate.kind as "task" | "checklist")) {
    throw new PlanTaskPromotionError(
      "invalid-candidate",
      "Only incomplete plan tasks and checklist items can be promoted.",
    )
  }
  if (candidate.completed === true) {
    throw new PlanTaskPromotionError("invalid-candidate", "Completed plan work cannot be promoted.")
  }
  return { source, candidate }
}

function getProject(database: Database, projectId: string) {
  const project = database.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project) throw new PlanTaskPromotionError("not-found", "Target project is missing.")
  return project
}

function buildSeedText(input: {
  title: string
  body: string | null
  candidatePath: string
  line: number
  sourceFingerprint: string
}): string {
  const context = input.body?.trim() || input.title
  return [
    `Implement the promoted plan task: ${input.title}`,
    "",
    `Source: ${input.candidatePath}:${input.line}`,
    `Source fingerprint: ${input.sourceFingerprint}`,
    "",
    "Plan context and acceptance:",
    context,
    "",
    "Review the current repository state before changing code. Do not assume the plan source has stayed unchanged.",
  ].join("\n")
}

export function buildPlanTaskPromotionPreview(
  database: Database,
  snapshot: ProjectPlanSnapshot,
  input: PlanTaskPromotionPreviewInput,
): PlanTaskPromotionPreview {
  const { source, candidate } = resolveCandidate(snapshot, input.reference)
  const project = getProject(database, input.targetProjectId ?? input.reference.sourceProjectId)
  const permissionMode = parsePermissionMode(project.defaultPermissionMode)
  const customPermissions = parseStoredCustomPermissions(project.defaultCustomPermissions)
  if (!permissionMode || (permissionMode === "custom" && !customPermissions)) {
    throw new PlanTaskPromotionError(
      "inconsistent-state",
      "The target project has invalid custom permission defaults.",
    )
  }

  return {
    reference: input.reference,
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      gitRemoteUrl: project.gitRemoteUrl,
      gitProvider: project.gitProvider,
      gitOwner: project.gitOwner,
      gitRepo: project.gitRepo,
    },
    source: {
      type: source.type,
      path: source.path,
      candidatePath: candidate.path,
      candidateLine: candidate.line,
    },
    task: {
      name: candidate.title,
      description: candidate.body,
      status: "in-progress",
    },
    permission: {
      mode: permissionMode,
      customPermissions,
    },
    worktree: {
      mode: "task-primary",
      label: "Task default (project checkout until a primary worktree exists)",
      path: null,
    },
    chat: {
      name: candidate.title,
      seedText: buildSeedText({
        title: candidate.title,
        body: candidate.body,
        candidatePath: candidate.path,
        line: candidate.line,
        sourceFingerprint: source.fingerprint,
      }),
    },
  }
}

function validatePermissions(input: PlanTaskPromotionConfirmInput): CustomPermissionToggles | null {
  const customPermissions = parseCustomPermissionToggles(input.customPermissions)
  if (input.permissionMode === "custom" && !customPermissions) {
    throw new PlanTaskPromotionError(
      "invalid-candidate",
      "Custom permission mode requires complete capability defaults.",
    )
  }
  if (input.permissionMode !== "custom" && input.customPermissions) {
    throw new PlanTaskPromotionError(
      "invalid-candidate",
      "Custom capabilities require custom permission mode.",
    )
  }
  return input.permissionMode === "custom" ? customPermissions : null
}

export function promotePlanCandidate(
  database: Database,
  snapshot: ProjectPlanSnapshot,
  input: PlanTaskPromotionConfirmInput,
) {
  const { source, candidate } = resolveCandidate(snapshot, input.reference)
  const project = getProject(database, input.targetProjectId)
  const customPermissions = validatePermissions(input)
  const taskId = stableId(
    "plan-task",
    project.id,
    input.reference.sourceProjectId,
    source.id,
    candidate.id,
  )
  // The request key owns the first chat identity. The source-candidate unique
  // index remains the stronger natural key, so a retry with a regenerated key
  // still returns the original pair instead of creating another one.
  const chatId = stableId("plan-chat", taskId, input.idempotencyKey)
  const subChatId = stableId("plan-subchat", chatId)
  const messageId = stableId("msg", taskId)

  return database.transaction((tx) => {
    const existingTask = tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, project.id),
          eq(tasks.sourcePath, candidate.path),
          eq(tasks.sourceCandidateId, candidate.id),
        ),
      )
      .get()
    if (existingTask) {
      const promotionChats = tx
        .select()
        .from(chats)
        .where(eq(chats.taskId, existingTask.id))
        .all()
        .filter((item) => item.id.startsWith("plan-chat-"))
      const existingChat = promotionChats[0]
      const promotionSubChats = existingChat
        ? tx.select().from(subChats).where(eq(subChats.chatId, existingChat.id)).all()
        : []
      const existingSubChat = promotionSubChats[0]
      if (
        promotionChats.length !== 1 ||
        promotionSubChats.length !== 1 ||
        !existingChat ||
        !existingSubChat
      ) {
        throw new PlanTaskPromotionError(
          "inconsistent-state",
          "This plan candidate has task state without its promotion chat.",
        )
      }
      return {
        created: false,
        idempotencyKey: input.idempotencyKey,
        project,
        task: existingTask,
        chat: existingChat,
        subChat: existingSubChat,
      }
    }

    const statusTasks = tx
      .select({ id: tasks.id, boardOrder: tasks.boardOrder })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, project.id),
          eq(tasks.status, input.status),
          isNull(tasks.archivedAt),
        ),
      )
      .orderBy(asc(tasks.boardOrder), asc(tasks.createdAt), asc(tasks.id))
      .all()
    const orders = createRebalancedBoardOrders([...statusTasks.map((task) => task.id), taskId])
    const now = new Date()
    for (const statusTask of statusTasks) {
      const boardOrder = orders.get(statusTask.id)
      if (boardOrder && boardOrder !== statusTask.boardOrder) {
        tx.update(tasks)
          .set({
            boardOrder,
            version: sql`${tasks.version} + 1`,
            updatedAt: now,
          })
          .where(eq(tasks.id, statusTask.id))
          .run()
      }
    }

    const task = tx
      .insert(tasks)
      .values({
        id: taskId,
        projectId: project.id,
        name: input.taskName,
        description: input.taskDescription,
        status: input.status,
        boardOrder: orders.get(taskId),
        sourceType: source.type,
        sourcePath: candidate.path,
        sourceCandidateId: candidate.id,
        sourceFingerprint: source.fingerprint,
        defaultPermissionMode: input.permissionMode,
        defaultCustomPermissions: customPermissions ? JSON.stringify(customPermissions) : null,
        vaultContextSections: project.vaultContextSections,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    const selectedWorktreePath = input.worktreeMode === "project-checkout" ? project.path : null
    const chat = tx
      .insert(chats)
      .values({
        id: chatId,
        name: input.taskName,
        projectId: project.id,
        taskId: task.id,
        scope: "task",
        permissionMode: input.permissionMode,
        customPermissions: customPermissions ? JSON.stringify(customPermissions) : null,
        worktreePath: selectedWorktreePath,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    const subChat = tx
      .insert(subChats)
      .values({
        id: subChatId,
        chatId: chat.id,
        name: input.taskName,
        mode: "write",
        permissionMode: input.permissionMode,
        worktreePath: selectedWorktreePath,
        runStatus: null,
        messages: JSON.stringify([
          {
            id: messageId,
            role: "user",
            parts: [{ type: "text", text: input.seedText }],
          },
        ]),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    const run = tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.chatId, chat.id))
      .get()
    if (run) {
      throw new PlanTaskPromotionError(
        "inconsistent-state",
        "Plan promotion must not launch an agent run.",
      )
    }

    return {
      created: true,
      idempotencyKey: input.idempotencyKey,
      project,
      task,
      chat,
      subChat,
    }
  })
}
