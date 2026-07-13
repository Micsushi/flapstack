export {
  buildReasoningTimerState,
  formatReasoningDuration,
  formatReasoningStatus,
} from "../../../../shared/reasoning-duration"

const reasoningStartedAtByMessage = new Map<string, number>()

/** Keep a live timer stable when chat navigation remounts its message row. */
export function getReasoningStartedAt(messageKey: string, preferred?: number): number {
  const existing = reasoningStartedAtByMessage.get(messageKey)
  if (existing !== undefined) return existing
  const startedAt = preferred ?? Date.now()
  reasoningStartedAtByMessage.set(messageKey, startedAt)
  return startedAt
}
