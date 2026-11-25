export const chatStatusPriority = [
  "needs-input",
  "dependency-wait-failed",
  "failed",
  "blocked",
  "running",
  "stopped",
  "unread",
  "complete",
  "unknown",
] as const

export type ChatStatusKind = (typeof chatStatusPriority)[number]

export type ChatStatus = {
  kind: ChatStatusKind
  unread: boolean
}

/** A completed run establishes that the reply finished. */
export function resolveChatStatus({
  unread,
  running,
  needsInput,
  blocked,
  dependencyWaitFailed,
  runStatus,
}: {
  unread: boolean
  running: boolean
  needsInput: boolean
  blocked: boolean
  dependencyWaitFailed: boolean
  runStatus?: string | null
}): ChatStatusKind | null {
  if (needsInput || runStatus === "needs-input" || runStatus === "waiting_for_input")
    return "needs-input"
  if (dependencyWaitFailed || runStatus === "dependency-wait-failed")
    return "dependency-wait-failed"
  if (blocked) return "blocked"
  if (running || runStatus === "running" || runStatus === "pending") return "running"
  if (runStatus === "failure" || runStatus === "failed" || runStatus === "error") return "failed"
  if (runStatus === "blocked") return "blocked"
  if (runStatus === "cancelled" || runStatus === "stopped") return "stopped"
  if (unread) return "unread"
  if (runStatus === "success" || runStatus === "completed") return "complete"
  return runStatus ? "unknown" : null
}
