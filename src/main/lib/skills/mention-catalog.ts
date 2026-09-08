import { eq } from "drizzle-orm"
import type { getDatabase } from "../db"
import { chats, projects, subChats, tasks } from "../db/schema"
import { resolveExtensionInventoryState } from "../extension-management/enablement-policy"
import { assertRegisteredWorktree } from "../git/security/path-validation"

export type SkillMentionScope = {
  subChatId?: string
  projectId?: string
  taskId?: string
  harness?: string
}

/** Resolve existing chats from durable identity, never the globally focused pane. */
export async function listNativeSkillMentions(
  database: ReturnType<typeof getDatabase>,
  input: SkillMentionScope,
  options: { homeDir?: string } = {},
) {
  let { projectId, taskId, harness } = input
  let cwd: string | undefined
  if (input.subChatId) {
    const row = database
      .select({
        projectId: chats.projectId,
        taskId: chats.taskId,
        harness: subChats.harness,
        chatHarness: chats.harness,
        worktreePath: subChats.worktreePath,
        chatWorktreePath: chats.worktreePath,
      })
      .from(subChats)
      .innerJoin(chats, eq(chats.id, subChats.chatId))
      .where(eq(subChats.id, input.subChatId))
      .get()
    if (!row) throw new Error("Chat not found")
    projectId = row.projectId ?? undefined
    taskId = row.taskId ?? undefined
    harness = row.harness ?? row.chatHarness ?? undefined
    cwd = row.worktreePath ?? row.chatWorktreePath ?? undefined
  }
  if (taskId) {
    const task = database
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get()
    if (!task || !projectId || task.projectId !== projectId)
      throw new Error("Task does not belong to the requested project")
  }
  if (projectId) {
    const project = database
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
    if (!project) throw new Error("Project not found")
    cwd ??= project.path
  }
  if (cwd) cwd = assertRegisteredWorktree(cwd).canonicalPath
  // A filesystem path alone cannot establish task policy or a compatible runtime.
  if (harness !== "codex" && harness !== "claude-code") return { harness, skills: [] }
  const state = await resolveExtensionInventoryState(database, {
    ...options,
    cwd,
    projectId,
    taskId,
    harness,
  })
  const native = state
    .filter(({ extension }) => extension.kind === "skill")
    .sort(
      (a, b) =>
        Number(b.extension.source === "project") - Number(a.extension.source === "project") ||
        Number(a.extension.capabilities.discovery === "compatibility") -
          Number(b.extension.capabilities.discovery === "compatibility"),
    )
  const seen = new Set<string>()
  const skills = native
    .filter(({ extension, resolved }) => {
      // Name-only mention syntax cannot address aliases separately. Keep the preferred
      // native entry, including its disabled state, instead of reviving a legacy alias.
      if (seen.has(extension.name)) return false
      seen.add(extension.name)
      return resolved.support === "supported" && resolved.enabled
    })
    .map(({ extension }) => ({
      name: extension.name,
      description: extension.description,
      source: extension.source,
      path: extension.path,
      content: extension.content ?? "",
      provider: extension.provider,
      compatibility: extension.capabilities.discovery === "compatibility",
    }))
  return { harness, skills }
}
