import type {
  McpGateResult,
  McpSelfReferenceBlockedReason,
  McpSelfReferenceOperation,
  McpSelfReferenceResult,
  McpSelfReferenceTargetKind,
} from "./types"

export type McpSelfReferenceCaller = {
  chatId: string
  runId?: string
  taskId?: string | null
  projectId?: string | null
}

export type McpSelfReferenceTarget = {
  kind: McpSelfReferenceTargetKind
  id: string
}

type SelfReferenceRule = "allow" | "deny"

// Every operation/own-target pair is explicit. Write is allowed here because a
// worktree write does not itself replace, archive, move, or relaunch a caller.
// Its permission and approval requirements remain owned by the F3-T1 gate.
const ownTargetRules: Record<
  McpSelfReferenceOperation,
  Record<McpSelfReferenceTargetKind, SelfReferenceRule>
> = {
  rename: { chat: "allow", run: "allow", task: "allow", project: "allow" },
  move: { chat: "deny", run: "deny", task: "deny", project: "deny" },
  archive: { chat: "deny", run: "deny", task: "deny", project: "deny" },
  write: { chat: "allow", run: "allow", task: "allow", project: "allow" },
  launch: { chat: "deny", run: "deny", task: "deny", project: "deny" },
  spawn: { chat: "deny", run: "deny", task: "deny", project: "deny" },
}

export function evaluateMcpSelfReference(input: {
  caller: McpSelfReferenceCaller
  operation: McpSelfReferenceOperation
  target: McpSelfReferenceTarget
}): McpSelfReferenceResult {
  if (!isOwnTarget(input.caller, input.target)) {
    return { decision: "allowed", reason: "Target is outside the caller execution context." }
  }

  if (ownTargetRules[input.operation][input.target.kind] === "allow") {
    return {
      decision: "allowed",
      reason: `Self ${input.target.kind} ${input.operation} does not invalidate the caller execution context.`,
    }
  }

  const blockedReason: McpSelfReferenceBlockedReason = {
    code: "self-reference",
    operation: input.operation,
    targetKind: input.target.kind,
    targetId: input.target.id,
  }
  return {
    decision: "denied",
    reason: `Cannot ${input.operation} the caller's own ${input.target.kind}.`,
    blockedReason,
  }
}

/**
 * Applies self-reference safety after F3-T1. This policy never upgrades a
 * prior denial or approval requirement, and a self-reference denial wins.
 */
export function evaluateMcpGateWithSelfReference(input: {
  gate: McpGateResult
  caller: McpSelfReferenceCaller
  operation: McpSelfReferenceOperation
  target: McpSelfReferenceTarget
}): McpGateResult & { blockedReason?: McpSelfReferenceBlockedReason } {
  const selfReference = evaluateMcpSelfReference(input)
  if (selfReference.decision === "denied") {
    return {
      decision: "denied",
      reason: selfReference.reason,
      requiresApproval: false,
      blockedReason: selfReference.blockedReason,
    }
  }
  return input.gate
}

function isOwnTarget(caller: McpSelfReferenceCaller, target: McpSelfReferenceTarget): boolean {
  return (
    (target.kind === "chat" && target.id === caller.chatId) ||
    (target.kind === "run" && target.id === caller.runId) ||
    (target.kind === "task" && target.id === caller.taskId) ||
    (target.kind === "project" && target.id === caller.projectId)
  )
}
