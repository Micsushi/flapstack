import { eq } from "drizzle-orm"
import { chats, getDatabase, projects, tasks, type Chat } from "./db"
import { getCurrentBranch } from "./git/worktree"
import { homedir } from "node:os"
import { resolve, sep } from "node:path"
export {
  validateCustomWorktreePath,
  type CustomWorktreeValidation,
} from "./git/validate-custom-worktree"

export type WorktreeOption = {
  path: string
  label: string
  kind: "project" | "task" | "custom"
  isDefault: boolean
}

export type WorktreeStatus =
  | { status: "none"; path: null; isDefault: boolean }
  | { status: "ok"; path: string; branch: string | null; isDefault: boolean }
  | { status: "unknown"; path: string; isDefault: boolean; error: string }

export function isManagedFlapstackWorktreePath(worktreePath: string): boolean {
  const managedRoot = resolve(homedir(), ".flapstack", "worktrees")
  const candidate = resolve(worktreePath)
  return candidate === managedRoot || candidate.startsWith(managedRoot + sep)
}

export function resolveDefaultWorktree(chat: Chat): string | null {
  if (chat.scope === "global") return null

  const db = getDatabase()
  if (chat.scope === "task" && chat.taskId) {
    const task = db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
    if (task?.primaryWorktreePath) return task.primaryWorktreePath
  }

  if (!chat.projectId) return null
  const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
  return project?.path ?? null
}

export function listWorktreeOptions(chatId: string): WorktreeOption[] {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")

  const defaultPath = resolveDefaultWorktree(chat)
  const options: WorktreeOption[] = []

  if (chat.projectId) {
    const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
    if (project) {
      options.push({
        path: project.path,
        label: "Project checkout",
        kind: "project",
        isDefault: defaultPath === project.path,
      })
    }
  }

  if (chat.taskId) {
    const task = db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
    if (task?.primaryWorktreePath) {
      options.push({
        path: task.primaryWorktreePath,
        label: "Task worktree",
        kind: "task",
        isDefault: defaultPath === task.primaryWorktreePath,
      })
    }
  }

  if (chat.worktreePath && !options.some((option) => option.path === chat.worktreePath)) {
    options.push({
      path: chat.worktreePath,
      label: "Selected worktree",
      kind: "custom",
      isDefault: defaultPath === chat.worktreePath,
    })
  }

  return options
}

export async function getResolvedWorktreeStatus(
  chatId: string,
  pathOverride?: string,
): Promise<WorktreeStatus> {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")

  const path = pathOverride ?? chat.worktreePath ?? resolveDefaultWorktree(chat)
  const defaultPath = resolveDefaultWorktree(chat)
  if (!path) return { status: "none", path: null, isDefault: true }

  try {
    const branch = await getCurrentBranch(path)
    return { status: "ok", path, branch, isDefault: path === defaultPath }
  } catch (error) {
    return {
      status: "unknown",
      path,
      isDefault: path === defaultPath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
