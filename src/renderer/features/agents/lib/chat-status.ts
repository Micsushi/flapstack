export type WorkOutcome =
  "verified-complete" | "stopped-incomplete" | "blocked" | "failed" | "unknown"
export type ChatStatus = {
  unread: boolean
  running: boolean
  needsHelp: boolean
  outcome: WorkOutcome
}

/** Process success is deliberately not work verification. Never inspect message text. */
export function resolveChatStatus(input: {
  unread?: boolean
  running?: boolean
  needsHelp?: boolean
  runStatuses?: readonly (string | null)[]
}): ChatStatus {
  const statuses = input.runStatuses ?? []
  return {
    unread: !!input.unread,
    running:
      !!input.running || statuses.some((status) => status === "running" || status === "pending"),
    needsHelp:
      !!input.needsHelp ||
      statuses.some((status) => status === "needs-input" || status === "waiting_for_input"),
    outcome: statuses.some(
      (status) => status === "failure" || status === "failed" || status === "error",
    )
      ? "failed"
      : statuses.includes("blocked")
        ? "blocked"
        : statuses.some((status) => status === "cancelled" || status === "stopped")
          ? "stopped-incomplete"
          : "unknown",
  }
}

export const outcomeLabels: Record<WorkOutcome, string> = {
  "verified-complete": "Verified work complete",
  "stopped-incomplete": "Agent stopped; work incomplete",
  blocked: "Work blocked",
  failed: "Run failed; work not verified",
  unknown: "Work outcome unknown",
}

/** Keep every distinct outcome: a group's running member cannot hide a failed one. */
export function summarizeChatStatuses(statuses: readonly ChatStatus[]) {
  return {
    unread: statuses.filter((status) => status.unread).length,
    running: statuses.filter((status) => status.running).length,
    needsHelp: statuses.filter((status) => status.needsHelp).length,
    outcomes: [...new Set(statuses.map((status) => status.outcome))],
  }
}
