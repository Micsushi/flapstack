import type Database from "better-sqlite3"
import { posix, win32 } from "node:path"
import { parseStoredCustomPermissionCapabilities } from "../../../shared/permission-capabilities"
import type { OrchestrationSharedWorktrees } from "../../../shared/agent-orchestration"

// Launch resolves registered worktrees to canonical paths. This read-only projection
// compares those saved identities without filesystem or Git calls on overview polls.
export function sharedWorktreeKey(path: string | null, platform = process.platform): string | null {
  if (!path) return null
  const paths = platform === "win32" ? win32 : posix
  if (!paths.isAbsolute(path)) return null
  const resolved = paths.normalize(path)
  const normalized =
    resolved === paths.parse(resolved).root
      ? resolved
      : resolved.replace(platform === "win32" ? /[\\/]+$/ : /\/+$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

function access(mode: string, custom: string | null): "read-only" | "may-edit" | "unknown" {
  if (mode === "read-only") return "read-only"
  if (["ask-before-edits", "auto-edit-project-only", "full-access"].includes(mode))
    return "may-edit"
  if (mode === "custom") {
    const permissions = parseStoredCustomPermissionCapabilities(custom)
    if (permissions)
      return permissions.projectWrite ||
        permissions.shell ||
        permissions.git ||
        permissions.subagents ||
        permissions.productMcpWrite ||
        permissions.productMcpTier3 ||
        permissions.thirdPartyMcp
        ? "may-edit"
        : "read-only"
  }
  return "unknown"
}

export function projectSharedWorktrees(
  db: Database.Database,
  taskId: string,
): OrchestrationSharedWorktrees {
  const rows = db
    .prepare(
      `SELECT a.id agentId, r.id runId, r.chat_id chatId,
    r.worktree_path path, r.permission_mode mode, r.custom_permissions custom,
    json_extract(a.definition, '$.name') name
    FROM orchestration_agents a JOIN agent_runs r ON r.id=a.run_id AND r.chat_id=a.chat_id
    JOIN chats c ON c.id=r.chat_id JOIN tasks t ON t.id=a.task_id
    WHERE a.task_id=? AND c.task_id=t.id AND c.project_id=t.project_id
      AND r.status IN ('pending','running') AND r.provider_runtime_target='local'
    ORDER BY a.id`,
    )
    .all(taskId) as Array<{
    agentId: string
    runId: string
    chatId: string
    path: string | null
    mode: string
    custom: string | null
    name: string | null
  }>
  const groups = new Map<string, OrchestrationSharedWorktrees["groups"][number]>()
  const unknown: OrchestrationSharedWorktrees["unknown"] = []
  for (const row of rows) {
    const run = {
      agentId: row.agentId,
      runId: row.runId,
      chatId: row.chatId,
      name: row.name || row.agentId,
      access: access(row.mode, row.custom),
    }
    const key = sharedWorktreeKey(row.path)
    if (!key) {
      unknown.push(run)
      continue
    }
    const group = groups.get(key) ?? { path: row.path!, runs: [] }
    group.runs.push(run)
    groups.set(key, group)
  }
  return {
    groups: [...groups.values()].filter(
      (group) => group.runs.length > 1 && group.runs.some((run) => run.access !== "read-only"),
    ),
    unknown,
  }
}
