import type { CustomPermissionToggles, PermissionMode } from "../permissions"

export type McpRiskTier = 0 | 1 | 2 | 3
export type McpGateDecision = "allowed" | "denied" | "approval-required"
export type McpCapability = Exclude<keyof CustomPermissionToggles, "schemaVersion">

export type McpControlTool = {
  name: string
  description: string
  tier: McpRiskTier
  requiredCapabilities: readonly McpCapability[]
  status: "scaffolded" | "implemented" | "stubbed"
}

export type McpCallerIdentity = {
  chatId: string
  runId?: string
  permissionMode?: PermissionMode
  customPermissions?: CustomPermissionToggles
}

export type McpCallerRecord = {
  id: string
  permissionMode: string | null
  archived: boolean
  exposureEnabled: boolean
}

export type McpRunRecord = {
  id: string
  chatId: string
  permissionMode: string | null
  active: boolean
}

export type McpCallerStore = {
  findChat(chatId: string): McpCallerRecord | null
  findRun(runId: string): McpRunRecord | null
  findCustomPermissions(chatId: string, runId?: string): CustomPermissionToggles | null
}

export type McpControlErrorCode =
  | "invalid-caller"
  | "permission-denied"
  | "stale-caller"
  | "stale-target"
  | "approval-denied"
  | "approval-timeout"
  | "approval-cancelled"
  | "approval-shutdown"
  | "tool-not-found"
  | "tool-unavailable"
  | "invalid-input"
  | "out-of-scope"
  | "forbidden-loop"
  | "forbidden-target"
  | "secret-detected"
  | "not-found"
  | "reconciliation-required"
  | "conflict"
  | "internal-error"

export type McpMutationService = {
  invoke(name: string, caller: McpCallerIdentity, input: unknown): Promise<McpControlResponse>
}

export type McpControlResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: McpControlErrorCode; message: string } }

export type McpGateResult = {
  decision: McpGateDecision
  reason: string
  requiresApproval: boolean
}

export type McpSelfReferenceOperation = "rename" | "move" | "archive" | "write" | "launch" | "spawn"

export type McpSelfReferenceTargetKind = "chat" | "run" | "task" | "project"

export type McpSelfReferenceBlockedReason = {
  code: "self-reference"
  operation: McpSelfReferenceOperation
  targetKind: McpSelfReferenceTargetKind
  targetId: string
}

export type McpSelfReferenceResult =
  | { decision: "allowed"; reason: string; blockedReason?: undefined }
  | { decision: "denied"; reason: string; blockedReason: McpSelfReferenceBlockedReason }
