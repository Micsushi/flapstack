import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import {
  authorityApprovalContextHash,
  requestAuthorityApproval,
} from "../mcp-control/authority-approval"

export const POLICY_APPROVAL_TOOL = "orchestration.policy.relax"
export const TEMPLATE_LAUNCH_APPROVAL_TOOL = "orchestration.template.launch"

export type OrchestrationAuthorityTool =
  typeof POLICY_APPROVAL_TOOL | typeof TEMPLATE_LAUNCH_APPROVAL_TOOL

type Database = BetterSQLite3Database<typeof schema>

export async function requestOrchestrationAuthorityApproval(
  database: Database,
  input: {
    toolName: OrchestrationAuthorityTool
    callerChatId: string
    callerRunId?: string | null
    authority: unknown
  },
): Promise<string> {
  return requestAuthorityApproval(database, {
    ...input,
    errorLabel: "Orchestration authority",
  })
}

export function approvalContextHash(input: {
  toolName: OrchestrationAuthorityTool
  callerChatId: string
  callerRunId?: string | null
  authority: unknown
}): string {
  return authorityApprovalContextHash(input)
}
