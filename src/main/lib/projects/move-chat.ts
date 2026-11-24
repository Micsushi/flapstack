import type Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { assertChatAssignmentProjectMove } from "../chat-assignment"
import { isManagedFlapstackWorktreePath } from "../worktree-resolver"

export function moveStoredChat(
  sqlite: Database.Database,
  input: {
    id: string
    scope: "global" | "project" | "task"
    projectId?: string
    taskId?: string
  },
  rehomeAcrossProjects = false,
) {
  const db = drizzle(sqlite, { schema })
  const { chats, tasks, projects } = schema
  return db.transaction(
    (tx) => {
      const chat = tx.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat || chat.archivedAt) throw new Error("Chat is missing or archived.")
      const task =
        input.scope === "task" && input.taskId
          ? tx.select().from(tasks).where(eq(tasks.id, input.taskId)).get()
          : undefined
      if (
        input.scope === "task" &&
        (!task || task.archivedAt || (input.projectId && task.projectId !== input.projectId))
      )
        throw new Error("Select an active task in the requested project.")
      const projectId = input.scope === "global" ? null : (task?.projectId ?? input.projectId)
      const project = projectId
        ? tx.select().from(projects).where(eq(projects.id, projectId)).get()
        : undefined
      if (input.scope !== "global" && (!project || project.archivedAt))
        throw new Error("Select an active project.")
      assertChatAssignmentProjectMove(sqlite, chat.id, project?.id ?? null)
      if (chat.projectId !== (project?.id ?? null)) {
        const linked = sqlite
          .prepare(
            "SELECT 1 FROM record_chat_links WHERE chat_id=? UNION ALL SELECT 1 FROM record_task_worktrees WHERE chat_id=? LIMIT 1",
          )
          .get(chat.id, chat.id)
        if (linked)
          throw new Error(
            "Detach the Records association before moving this Chat to another project.",
          )
        if (
          sqlite
            .prepare(
              "SELECT 1 FROM agent_runs WHERE chat_id=? AND status IN ('pending','running') LIMIT 1",
            )
            .get(chat.id)
        )
          throw new Error("Wait for this Chat's active work before changing its project.")
      }
      const previousTask = chat.taskId
        ? tx.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
        : undefined
      const previousProject = chat.projectId
        ? tx.select().from(projects).where(eq(projects.id, chat.projectId)).get()
        : undefined
      const keepCustom =
        !!chat.worktreePath &&
        (!rehomeAcrossProjects || chat.projectId === (project?.id ?? null)) &&
        chat.worktreePath !== (previousTask?.primaryWorktreePath ?? previousProject?.path) &&
        !isManagedFlapstackWorktreePath(chat.worktreePath)
      const worktreePath = keepCustom
        ? chat.worktreePath
        : (task?.primaryWorktreePath ?? project?.path ?? null)
      if (worktreePath !== chat.worktreePath)
        tx.update(schema.subChats)
          .set({ worktreePath, updatedAt: new Date() })
          .where(eq(schema.subChats.chatId, chat.id))
          .run()
      return tx
        .update(chats)
        .set({
          scope: input.scope,
          projectId: project?.id ?? null,
          taskId: task?.id ?? null,
          worktreePath,
          branch: keepCustom ? chat.branch : (task?.primaryBranch ?? null),
          baseBranch: keepCustom ? chat.baseBranch : null,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    },
    { behavior: "immediate" },
  )
}
