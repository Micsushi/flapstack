import { z } from "zod"
import type { McpCallerIdentity } from "./types"

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
    permissionMode: parsed.data.FLAPSTACK_MCP_PERMISSION_MODE,
  }
}
