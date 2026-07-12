export function formatReasoningDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`
}

export function formatReasoningStatus(isWorking: boolean, durationMs?: number): string {
  const verb = isWorking ? "Working" : "Worked"
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return verb
  return `${verb} for ${formatReasoningDuration(durationMs)}`
}
