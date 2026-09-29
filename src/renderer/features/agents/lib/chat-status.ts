export type WorkOutcome =
  | "verified-complete"
  | "completed-unverified"
  | "stopped-incomplete"
  | "blocked"
  | "dependency-wait-failed"
  | "failed"
  | "unknown"
export type ChatStatus = {
  unread: boolean
  running: boolean
  needsHelp: boolean
  outcome: WorkOutcome
  outcomes: readonly WorkOutcome[]
}

function resolveWorkOutcomes(statuses: readonly (string | null)[]): WorkOutcome[] {
  const outcomes: WorkOutcome[] = []
  if (statuses.some((status) => status === "failure" || status === "failed" || status === "error"))
    outcomes.push("failed")
  if (statuses.includes("dependency-wait-failed")) outcomes.push("dependency-wait-failed")
  if (statuses.includes("blocked")) outcomes.push("blocked")
  if (statuses.some((status) => status === "cancelled" || status === "stopped"))
    outcomes.push("stopped-incomplete")
  if (statuses.some((status) => status === "success" || status === "completed"))
    outcomes.push("completed-unverified")
  return outcomes.length > 0 ? outcomes : ["unknown"]
}

/** Process success is deliberately not work verification. Never inspect message text. */
export function resolveChatStatus(input: {
  unread?: boolean
  running?: boolean
  needsHelp?: boolean
  blocked?: boolean
  dependencyWaitFailed?: boolean
  runStatuses?: readonly (string | null)[]
}): ChatStatus {
  const statuses = [
    ...(input.runStatuses ?? []),
    ...(input.blocked ? ["blocked"] : []),
    ...(input.dependencyWaitFailed ? ["dependency-wait-failed"] : []),
  ]
  const outcomes = resolveWorkOutcomes(statuses)
  return {
    unread: !!input.unread,
    running:
      !!input.running || statuses.some((status) => status === "running" || status === "pending"),
    needsHelp:
      !!input.needsHelp ||
      statuses.some((status) => status === "needs-input" || status === "waiting_for_input"),
    outcome: outcomes[0]!,
    outcomes,
  }
}

export const outcomeLabels: Record<WorkOutcome, string> = {
  "verified-complete": "Verified work complete",
  "completed-unverified": "Run completed; work not verified",
  "stopped-incomplete": "Agent stopped; work incomplete",
  blocked: "Work blocked",
  "dependency-wait-failed": "Dependency wait failed",
  failed: "Run failed; work not verified",
  unknown: "Work outcome unknown",
}

/** Keep every distinct outcome: a group's running member cannot hide a failed one. */
export function summarizeChatStatuses(statuses: readonly ChatStatus[]) {
  return {
    unread: statuses.filter((status) => status.unread).length,
    running: statuses.filter((status) => status.running).length,
    needsHelp: statuses.filter((status) => status.needsHelp).length,
    outcomes: [...new Set(statuses.flatMap((status) => status.outcomes))],
  }
}
