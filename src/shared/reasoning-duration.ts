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

export function buildReasoningTimerState(input: {
  status: string
  startedAtMs?: number
  completedAtMs?: number
  durationMs?: number
  nowMs?: number
}) {
  const isWorking = input.status === "running"
  const startedAtMs = input.startedAtMs
  const durationMs =
    startedAtMs === undefined
      ? input.durationMs
      : isWorking
        ? Math.max(0, (input.nowMs ?? Date.now()) - startedAtMs)
        : (input.durationMs ??
          (input.completedAtMs === undefined
            ? undefined
            : Math.max(0, input.completedAtMs - startedAtMs)))

  return {
    status: input.status,
    isWorking,
    startedAtMs: startedAtMs ?? null,
    completedAtMs: input.completedAtMs ?? null,
    durationMs: durationMs ?? null,
    label: formatReasoningStatus(isWorking, durationMs),
  }
}
