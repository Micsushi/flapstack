import { eq } from "drizzle-orm"
import { chats, getDatabase, projects, tasks, type Chat } from "./db"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { realpathSync } from "node:fs"
import { validateCustomWorktreePath } from "./git/validate-custom-worktree"
import { DETACHED_CHAT_CHECKOUTS_DIRECTORY } from "../../shared/checkout-path"
export {
  validateCustomWorktreePath,
  type CustomWorktreeValidation,
} from "./git/validate-custom-worktree"

export type WorktreeOption = {
  path: string
  label: string
  kind: "project" | "task" | "custom" | "detached"
  isDefault: boolean
}

export type WorktreeStatus =
  | { status: "none"; path: null; isDefault: boolean }
  | { status: "ok"; path: string; branch: string | null; isDefault: boolean }
  | { status: "detached"; path: string; branch: string | null; isDefault: false }
  | { status: "unknown"; path: string; isDefault: boolean; error: string }

export function getDetachedChatCheckoutPath(chatId: string): string {
  const configRoot = process.env.FLAPSTACK_CONFIG_DIR?.trim() || join(homedir(), ".flapstack")
  const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_")
  return resolve(configRoot, DETACHED_CHAT_CHECKOUTS_DIRECTORY, safeChatId)
}

export function isDetachedChatCheckoutPath(worktreePath: string): boolean {
  const detachedRootPath = resolve(
    process.env.FLAPSTACK_CONFIG_DIR?.trim() || join(homedir(), ".flapstack"),
    DETACHED_CHAT_CHECKOUTS_DIRECTORY,
  )
  const detachedRoot = realpathOrResolved(detachedRootPath)
  const candidate = realpathOrResolved(worktreePath)
  return candidate.startsWith(detachedRoot + sep)
}

function realpathOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function sameCheckoutPath(left: string | null, right: string | null): boolean {
  return Boolean(left && right && realpathOrResolved(left) === realpathOrResolved(right))
}

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
        isDefault: sameCheckoutPath(defaultPath, project.path),
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
        isDefault: sameCheckoutPath(defaultPath, task.primaryWorktreePath),
      })
    }
  }

  if (
    chat.worktreePath &&
    !options.some((option) => sameCheckoutPath(option.path, chat.worktreePath))
  ) {
    const detached = isDetachedChatCheckoutPath(chat.worktreePath)
    options.push({
      path: chat.worktreePath,
      label: detached ? "No project files" : "Selected worktree",
      kind: detached ? "detached" : "custom",
      isDefault: sameCheckoutPath(defaultPath, chat.worktreePath),
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

  const validation = await validateCustomWorktreePath(path)
  if (!validation.valid) {
    return {
      status: "unknown",
      path,
      isDefault: sameCheckoutPath(path, defaultPath),
      error: validation.error,
    }
  }

  if (isDetachedChatCheckoutPath(validation.path)) {
    return {
      status: "detached",
      path: validation.path,
      branch: validation.branch,
      isDefault: false,
    }
  }

  return {
    status: "ok",
    path: validation.path,
    branch: validation.branch,
    isDefault: sameCheckoutPath(validation.path, defaultPath),
  }
}
