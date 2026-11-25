import { dirname, isAbsolute, join } from "node:path"
import { readFileSync, realpathSync } from "node:fs"
import { parseArgs } from "node:util"
import { signExternalMcpProof, verifyExternalMcpGrant } from "./external-grant"
import { PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV } from "../../../shared/product-mcp-invalidation"
import { openAppDatabase } from "../db/access"
import { z } from "zod"
import { parseCustomPermissionToggles, parsePermissionMode } from "../permissions"
import type Database from "better-sqlite3"
import type { McpCallerIdentity, McpCallerStore } from "./types"
import { readDurableAgentProfileRuntimeAuthority } from "../agent-profiles/runtime-authority"
import { canonicalMcpChatScope } from "./scope"
import { CHILD_LIVE_KEY } from "./child-live-key"

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

let signDesktopRequest: ((payload: string) => { grantId: string; signature: string }) | undefined

export function signLaunchedExternalMcpProof(payload: string) {
  if (!signDesktopRequest) throw new Error("External MCP signing credential is unavailable.")
  return signDesktopRequest(payload)
}

/** Returns a resolver which rechecks the original grant, including after an approval wait. */
export function readMcpLaunch(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): {
  caller: McpCallerIdentity
  resolveExternal?: () => McpCallerIdentity
  exposure: "lazy" | "direct"
} {
  const { values } = parseArgs({
    args,
    options: {
      external: { type: "boolean" },
      profile: { type: "string" },
      "tool-exposure": { type: "string" },
    },
  })
  const external = values.external || environment.FLAPSTACK_MCP_CALLER_MODE === "external"
  const exposure =
    values["tool-exposure"] ??
    environment.FLAPSTACK_MCP_TOOL_EXPOSURE ??
    (external ? "direct" : "lazy")
  if (exposure !== "lazy" && exposure !== "direct")
    throw new Error("Unknown MCP tool exposure mode.")
  if (!external) {
    const caller = readMcpCallerIdentity(environment)
    if (!environment[CHILD_LIVE_KEY]) throw new Error("Missing launcher-issued MCP credential.")
    return { caller, exposure }
  }
  if (
    environment.FLAPSTACK_MCP_CHAT_ID !== undefined ||
    environment.FLAPSTACK_MCP_RUN_ID !== undefined
  )
    throw new Error("A Flapstack child identity cannot use external MCP mode.")
  const credentialPath = environment.FLAPSTACK_MCP_OWNER_TOKEN_FILE
  let token = environment.FLAPSTACK_MCP_OWNER_TOKEN
  if (credentialPath) {
    if (!isAbsolute(credentialPath)) throw new Error("Use an absolute owner credential path.")
    try {
      token = readFileSync(credentialPath, "utf8").trim()
    } catch {
      throw new Error("The external MCP owner credential file is unavailable.")
    }
  }
  if (!token) throw new Error("External MCP requires an owner-issued credential.")
  const ownerToken = token
  const profile = values.profile
  if (profile && !isAbsolute(profile))
    throw new Error("External MCP profile must be an absolute path.")
  const database =
    environment.FLAPSTACK_DB_PATH ||
    (profile
      ? join(profile, "data", "agents.db")
      : environment.FLAPSTACK_CONFIG_DIR
        ? join(environment.FLAPSTACK_CONFIG_DIR, "agents.db")
        : undefined)
  if (!database || !isAbsolute(database))
    throw new Error("Select a Flapstack profile with --profile or FLAPSTACK_CONFIG_DIR.")
  const databasePath = realpathSync.native(database)
  if (profile && realpathSync.native(join(profile, "data", "agents.db")) !== databasePath)
    throw new Error("The requested profile and database do not match.")
  const configDir = realpathSync.native(environment.FLAPSTACK_CONFIG_DIR || dirname(databasePath))
  const resolveExternal = () => verifyExternalMcpGrant(databasePath, ownerToken, configDir)
  const caller = resolveExternal()
  delete environment.FLAPSTACK_MCP_OWNER_TOKEN
  delete environment.FLAPSTACK_MCP_OWNER_TOKEN_FILE
  if (environment === process.env)
    signDesktopRequest = (payload) => signExternalMcpProof(ownerToken, payload)
  environment.FLAPSTACK_DB_PATH = databasePath
  environment.FLAPSTACK_CONFIG_DIR = configDir
  delete environment[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]
  return { caller, resolveExternal, exposure }
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
  if (run?.profileRuntimeAuthority === "invalid") {
    throw new Error("MCP caller has invalid frozen Agent Profile provenance.")
  }

  return {
    chatId: chat.id,
    runId: run?.id,
    ...(chat.projectId !== undefined ? { projectId: chat.projectId } : {}),
    ...(chat.taskId !== undefined ? { taskId: chat.taskId } : {}),
    permissionMode: mode,
    customPermissions: customPermissions ?? undefined,
    ...(run?.profileRuntimeAuthority
      ? { profileRuntimeAuthority: run.profileRuntimeAuthority }
      : {}),
  }
}

/**
 * Opens a fresh read-only view for each caller check. The stdio child must not
 * trust the immutable launch environment after the chat or run has changed.
 */
export function createSqliteMcpCallerStore(
  databasePath = process.env.FLAPSTACK_DB_PATH,
  activeDatabase?: () => Database.Database,
): McpCallerStore {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP caller validation.")

  const read = <T>(operation: (db: Database.Database) => T): T => {
    if (activeDatabase) return operation(activeDatabase())
    const db = openAppDatabase(databasePath, { readonly: true, fileMustExist: true })
    try {
      db.pragma("query_only = ON")
      db.pragma("busy_timeout = 5000")
      return operation(db)
    } finally {
      db.close()
    }
  }
  const query = (sql: string, params: unknown[]) =>
    read((db) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined)

  return {
    findChat(chatId) {
      const row = query(
        `SELECT c.id, c.scope, c.project_id, c.task_id, c.permission_mode, c.archived_at,
                c.mcp_exposure_enabled, p.id valid_project_id, t.project_id task_project_id
         FROM chats c
         LEFT JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
         LEFT JOIN tasks t ON t.id = c.task_id AND t.archived_at IS NULL
         WHERE c.id = ?`,
        [chatId],
      )
      const scope = row ? canonicalMcpChatScope(row) : null
      return row && scope
        ? {
            id: scope.chatId,
            projectId: scope.projectId,
            taskId: scope.taskId,
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
      if (!row) return null
      return read((db) => {
        const profile = readDurableAgentProfileRuntimeAuthority(db, runId)
        return {
          id: String(row.id),
          chatId: String(row.chat_id),
          permissionMode: typeof row.permission_mode === "string" ? row.permission_mode : null,
          active: row.status === "running",
          ...(profile.kind === "authority"
            ? { profileRuntimeAuthority: profile.authority }
            : profile.kind === "invalid"
              ? { profileRuntimeAuthority: "invalid" as const }
              : {}),
        }
      })
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
