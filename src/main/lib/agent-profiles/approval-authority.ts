import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import {
  authorityApprovalContextHash,
  requestAuthorityApproval,
} from "../mcp-control/authority-approval"

export const AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL = "agent-profile.capability.widen"

type Database = BetterSQLite3Database<typeof schema>

export async function requestAgentProfileCapabilityApproval(
  database: Database,
  input: {
    callerChatId: string
    callerRunId?: string | null
    authority: unknown
  },
) {
  return requestAuthorityApproval(database, {
    ...input,
    toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
    errorLabel: "Agent Profile capability",
  })
}

export function agentProfileApprovalContextHash(input: {
  callerChatId: string
  callerRunId?: string | null
  authority: unknown
}) {
  return authorityApprovalContextHash({
    ...input,
    toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
  })
}
