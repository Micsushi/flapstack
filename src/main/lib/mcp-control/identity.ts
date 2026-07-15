import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { z } from "zod"
import { parseCustomPermissionToggles, parsePermissionMode } from "../permissions"
import type { McpCallerIdentity, McpCallerStore } from "./types"

const callerEnvironmentSchema = z.object({
  FLAPSTACK_MCP_CHAT_ID: z.string().trim().min(1),
  FLAPSTACK_MCP_RUN_ID: z.string().trim().min(1),
  FLAPSTACK_MCP_PERMISSION_MODE: z.string().trim().min(1).optional(),
})

export function readMcpCallerIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): McpCallerIdentity {
  const parsed = callerEnvironmentSchema.safeParse(environment)
  if (!parsed.success) {
    throw new Error("Flapstack MCP requires launcher-provided caller identity.")
  }
  return {
    chatId: parsed.data.FLAPSTACK_MCP_CHAT_ID,
    runId: parsed.data.FLAPSTACK_MCP_RUN_ID,
    permissionMode: parsePermissionMode(parsed.data.FLAPSTACK_MCP_PERMISSION_MODE) ?? undefined,
  }
}

export function resolveTrustedMcpCaller(
  launchIdentity: Pick<McpCallerIdentity, "chatId" | "runId">,
  store: McpCallerStore,
): McpCallerIdentity {
  const chat = store.findChat(launchIdentity.chatId)
  if (!chat || chat.archived) {
    throw new Error(`MCP caller chat is missing or stale: ${launchIdentity.chatId}`)
  }
  if (!chat.exposureEnabled) {
    throw new Error(`MCP exposure is disabled for caller chat: ${launchIdentity.chatId}`)
  }

  const run = launchIdentity.runId ? store.findRun(launchIdentity.runId) : null
  if (launchIdentity.runId && (!run || !run.active)) {
    throw new Error(`MCP caller run is missing or stale: ${launchIdentity.runId}`)
  }
  if (run && run.chatId !== chat.id) {
    throw new Error("MCP caller run does not belong to the launcher-owned chat.")
  }

  const mode = parsePermissionMode(run?.permissionMode ?? chat.permissionMode)
  if (!mode) {
    throw new Error("MCP caller has an unsupported stored permission mode.")
  }

  const customPermissions =
    mode === "custom" ? store.findCustomPermissions(chat.id, run?.id) : undefined
  if (mode === "custom" && !customPermissions) {
    throw new Error("MCP custom caller is missing stored capability toggles.")
  }

  return {
    chatId: chat.id,
    runId: run?.id,
    permissionMode: mode,
    customPermissions: customPermissions ?? undefined,
  }
}

/**
 * Opens a fresh read-only view for each caller check. The stdio child must not
 * trust the immutable launch environment after the chat or run has changed.
 */
export function createSqliteMcpCallerStore(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpCallerStore {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP caller validation.")

  const query = (sql: string, params: unknown[]): Record<string, unknown> | undefined => {
    const db = openAppDatabase(databasePath, { readonly: true, fileMustExist: true })
    try {
      db.pragma("query_only = ON")
      db.pragma("busy_timeout = 5000")
      return db.prepare(sql).get(...params) as Record<string, unknown> | undefined
    } finally {
      db.close()
    }
  }

  return {
    findChat(chatId) {
      const row = query(
        "SELECT id, permission_mode, archived_at, mcp_exposure_enabled FROM chats WHERE id = ?",
        [chatId],
      )
      return row
        ? {
            id: String(row.id),
            permissionMode: typeof row.permission_mode === "string" ? row.permission_mode : null,
            archived: row.archived_at != null,
            exposureEnabled: row.mcp_exposure_enabled === 1,
          }
        : null
    },
    findRun(runId) {
      const row = query(
        "SELECT id, chat_id, permission_mode, status FROM agent_runs WHERE id = ?",
        [runId],
      )
      return row
        ? {
            id: String(row.id),
            chatId: String(row.chat_id),
            permissionMode: typeof row.permission_mode === "string" ? row.permission_mode : null,
            active: row.status === "running",
          }
        : null
    },
    findCustomPermissions(chatId, runId) {
      const row = runId
        ? query("SELECT custom_permissions FROM agent_runs WHERE id = ? AND chat_id = ?", [
            runId,
            chatId,
          ])
        : query("SELECT custom_permissions FROM chats WHERE id = ?", [chatId])
      if (!row || typeof row.custom_permissions !== "string") return null
      try {
        return parseCustomPermissionToggles(JSON.parse(row.custom_permissions))
      } catch {
        return null
      }
    },
  }
}
