import { z } from "zod"
import { parsePermissionMode } from "../permissions"
import type { McpCallerIdentity, McpCallerStore } from "./types"

const callerEnvironmentSchema = z.object({
  FLAPSTACK_MCP_CHAT_ID: z.string().trim().min(1),
  FLAPSTACK_MCP_RUN_ID: z.string().trim().min(1).optional(),
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
