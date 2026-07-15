import Database from "better-sqlite3"
import { existsSync, lstatSync, realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type {
  SavedWorkspacePaneBinding,
  SavedWorkspacePinnedContext,
} from "../../../shared/saved-workspaces"
import {
  PathValidationError,
  assertRegisteredWorktree,
  resolvePathInWorktree,
  validateRelativePath,
} from "../git/security/path-validation"
import { getOperationWorkspaceProjection, SavedWorkspaceOperationError } from "./operations"
import { SavedWorkspaceLifecycleService } from "./service"

export type SavedWorkspaceTargetState = "ready" | "missing" | "stale"

export type SavedWorkspaceContextResolution = {
  id: string
  state: SavedWorkspaceTargetState
  label: string
  message: string
}

export type SavedWorkspacePaneResolution = {
  paneId: string
  state: SavedWorkspaceTargetState
  label: string
  message: string
  requiresExplicitTerminalStart: boolean
  terminalCwd: string | null
  chatIdentity: { harness: string; model: string | null } | null
  pinnedContext: SavedWorkspaceContextResolution[]
}

export function resolveSavedWorkspacePane(
  databasePath: string,
  workspaceId: string,
  paneId: string,
): SavedWorkspacePaneResolution {
  const workspace = new SavedWorkspaceLifecycleService(databasePath).get(workspaceId)
  const pane = workspace.layout ? findPane(workspace.layout.root, paneId) : null
  if (!pane) {
    return {
      paneId,
      state: workspace.layout ? "missing" : "stale",
      label: "Workspace pane",
      message: workspace.layoutIssue ?? `Pane ${paneId} no longer exists in this workspace.`,
      requiresExplicitTerminalStart: false,
      terminalCwd: null,
      chatIdentity: null,
      pinnedContext: [],
    }
  }

  const target = resolveBinding(databasePath, workspace, pane.binding)
  return {
    paneId,
    ...target,
    pinnedContext: (pane.pinnedContext ?? []).map((item) =>
      resolvePinnedContext(databasePath, item),
    ),
  }
}

function resolveBinding(
  databasePath: string,
  workspace: ReturnType<SavedWorkspaceLifecycleService["get"]>,
  binding: SavedWorkspacePaneBinding,
): Omit<SavedWorkspacePaneResolution, "paneId" | "pinnedContext"> {
  switch (binding.type) {
    case "chat":
      return withDatabase(databasePath, (database) => {
        const chat = database
          .prepare("SELECT name, archived_at, harness, model FROM chats WHERE id = ?")
          .get(binding.chatId) as
          | {
              name: string | null
              archived_at: number | null
              harness: string | null
              model: string | null
            }
          | undefined
        if (!chat) return target("missing", "Chat", "The bound chat was removed.")
        if (chat.archived_at !== null) {
          return target("stale", chat.name || "Archived chat", "The bound chat is archived.")
        }
        if (chat.harness === "local" && !chat.model) {
          return target(
            "stale",
            chat.name || "Local chat",
            "The saved local chat no longer has an exact model identity.",
          )
        }
        return target(
          "ready",
          chat.name || "Chat",
          "Using the current durable chat and model identity.",
          false,
          null,
          chat.harness ? { harness: chat.harness, model: chat.model } : null,
        )
      })
    case "terminal": {
      if (!binding.worktreePath) {
        return target("stale", "Terminal", "Choose a registered worktree before starting.", true)
      }
      const root = resolveWorktree(binding.worktreePath)
      if (root.state !== "ready" || !root.canonicalPath) {
        return { ...root, requiresExplicitTerminalStart: true }
      }
      const cwd = resolveDirectory(binding.worktreePath, root.canonicalPath, binding.cwd)
      if (cwd.state !== "ready" || !cwd.canonicalPath) {
        return { ...cwd, requiresExplicitTerminalStart: true }
      }
      return target(
        "ready",
        "Terminal",
        "Terminal metadata restored. Start creates a fresh process.",
        true,
        cwd.canonicalPath,
      )
    }
    case "diff": {
      const root = resolveWorktree(binding.worktreePath)
      if (root.state !== "ready") return root
      return target("ready", "Diff", "Using the existing worktree changes service.")
    }
    case "file": {
      if (!binding.worktreePath) {
        return target("stale", "File", "Choose a registered worktree for this file.")
      }
      const file = resolveFile(binding.worktreePath, binding.path)
      if (file.state !== "ready") return file
      return target("ready", "File", "Using the existing file viewer and registered root.")
    }
    case "browser":
      return target("ready", "Web link", "HTTP(S) link validated for explicit external opening.")
    case "agent-roster":
    case "selected-agent":
    case "activity": {
      if (
        workspace.owner.kind !== "orchestration" ||
        workspace.owner.orchestrationId !== binding.orchestrationId
      ) {
        return target(
          "stale",
          "Operation pane",
          "The pane identity does not match this operation workspace.",
        )
      }
      try {
        const operation = getOperationWorkspaceProjection(databasePath, workspace.id)
        if (binding.type === "selected-agent" && binding.agentId) {
          const agent = operation.agents.find((candidate) => candidate.agentId === binding.agentId)
          if (!agent) {
            return target(
              "missing",
              "Selected agent",
              "The selected agent is no longer present in durable lineage.",
            )
          }
        }
        return target(
          "ready",
          binding.type === "agent-roster"
            ? "Agent navigator"
            : binding.type === "selected-agent"
              ? "Selected agent"
              : "Operation activity",
          "Using current durable orchestration lineage.",
        )
      } catch (error) {
        if (error instanceof SavedWorkspaceOperationError) {
          return target(
            error.code === "not-found" ? "missing" : "stale",
            "Operation pane",
            error.message,
          )
        }
        throw error
      }
    }
  }
}

function resolvePinnedContext(
  databasePath: string,
  item: SavedWorkspacePinnedContext,
): SavedWorkspaceContextResolution {
  if (item.type === "browser") {
    return contextTarget(item.id, "ready", item.url, "HTTP(S) link is valid.")
  }
  if (item.type === "file") {
    const file = resolveFile(item.worktreePath, item.path)
    return contextTarget(item.id, file.state, item.path, file.message)
  }
  return withDatabase(databasePath, (database) => {
    const rows = database
      .prepare("SELECT messages FROM sub_chats WHERE chat_id = ?")
      .all(item.chatId) as Array<{ messages: string }>
    if (rows.length === 0) {
      return contextTarget(item.id, "missing", "Chat message", "The bound chat was removed.")
    }
    const found = rows.some((row) => messageExists(row.messages, item.messageId))
    return found
      ? contextTarget(item.id, "ready", "Chat message", "Pinned message still exists.")
      : contextTarget(item.id, "stale", "Chat message", "The pinned message is no longer present.")
  })
}

function messageExists(messagesJson: string, messageId: string): boolean {
  try {
    const messages = JSON.parse(messagesJson) as Array<{ id?: unknown }>
    return Array.isArray(messages) && messages.some((message) => message?.id === messageId)
  } catch {
    return false
  }
}

function resolveWorktree(worktreePath: string): ReturnType<typeof worktreeTarget> {
  if (!existsSync(worktreePath)) {
    return worktreeTarget("missing", "Worktree", "The bound worktree was removed.")
  }
  try {
    const registration = assertRegisteredWorktree(worktreePath)
    return worktreeTarget(
      "ready",
      "Worktree",
      "Registered worktree identity verified.",
      registration.canonicalPath,
    )
  } catch (error) {
    const message =
      error instanceof PathValidationError
        ? error.message
        : "The bound worktree could not be verified."
    return worktreeTarget("stale", "Worktree", message)
  }
}

function resolveDirectory(
  lexicalRoot: string,
  canonicalRoot: string,
  cwd: string,
): ReturnType<typeof worktreeTarget> {
  try {
    const relativeCwd = safeRelative(lexicalRoot, cwd)
    validateRelativePath(relativeCwd, { allowRoot: true })
    const targetPath = resolvePathInWorktree(canonicalRoot, relativeCwd, { allowRoot: true })
    if (!existsSync(targetPath)) {
      return worktreeTarget("missing", "Terminal", "The saved terminal directory was removed.")
    }
    const info = lstatSync(targetPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return worktreeTarget("stale", "Terminal", "The saved terminal directory is unsafe.")
    }
    const canonicalTarget = realpathSync(targetPath)
    if (!isInside(canonicalRoot, canonicalTarget)) {
      return worktreeTarget(
        "stale",
        "Terminal",
        "The saved terminal directory escapes its worktree.",
      )
    }
    return worktreeTarget("ready", "Terminal", "Terminal directory verified.", canonicalTarget)
  } catch (error) {
    return worktreeTarget(
      "stale",
      "Terminal",
      error instanceof Error ? error.message : "Terminal directory is invalid.",
    )
  }
}

function resolveFile(worktreePath: string, filePath: string): ReturnType<typeof target> {
  const root = resolveWorktree(worktreePath)
  if (root.state !== "ready" || !root.canonicalPath) return target(root.state, "File", root.message)
  try {
    const relativeFile = safeRelative(worktreePath, filePath)
    validateRelativePath(relativeFile)
    const targetPath = resolvePathInWorktree(root.canonicalPath, relativeFile)
    if (!existsSync(targetPath))
      return target("missing", "File", "The bound file was moved or removed.")
    const info = lstatSync(targetPath)
    if (info.isSymbolicLink() || !info.isFile()) {
      return target("stale", "File", "The bound file is not a safe regular file.")
    }
    if (!isInside(root.canonicalPath, realpathSync(targetPath))) {
      return target("stale", "File", "The bound file escapes its worktree.")
    }
    return target("ready", "File", "Registered file target verified.")
  } catch (error) {
    return target("stale", "File", error instanceof Error ? error.message : "File path is invalid.")
  }
}

function safeRelative(root: string, candidate: string): string {
  if (!isAbsolute(candidate)) return candidate
  const result = relative(root, resolve(candidate))
  if (result === ".." || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new PathValidationError("Path escapes the registered worktree", "PATH_TRAVERSAL")
  }
  return result || "."
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep)
}

function target(
  state: SavedWorkspaceTargetState,
  label: string,
  message: string,
  requiresExplicitTerminalStart = false,
  terminalCwd: string | null = null,
  chatIdentity: { harness: string; model: string | null } | null = null,
): Omit<SavedWorkspacePaneResolution, "paneId" | "pinnedContext"> {
  return { state, label, message, requiresExplicitTerminalStart, terminalCwd, chatIdentity }
}

function worktreeTarget(
  state: SavedWorkspaceTargetState,
  label: string,
  message: string,
  canonicalPath?: string,
) {
  return { ...target(state, label, message), canonicalPath }
}

function contextTarget(
  id: string,
  state: SavedWorkspaceTargetState,
  label: string,
  message: string,
): SavedWorkspaceContextResolution {
  return { id, state, label, message }
}

function findPane(
  node: import("../../../shared/saved-workspaces").SavedWorkspaceLayoutNode,
  paneId: string,
): {
  binding: SavedWorkspacePaneBinding
  pinnedContext?: SavedWorkspacePinnedContext[]
} | null {
  if (node.type === "tabs") return node.panes.find((pane) => pane.id === paneId) ?? null
  for (const child of node.children) {
    const pane = findPane(child, paneId)
    if (pane) return pane
  }
  return null
}

function withDatabase<T>(databasePath: string, operation: (database: Database.Database) => T): T {
  const database = new Database(databasePath, { readonly: true })
  try {
    return operation(database)
  } finally {
    database.close()
  }
}
