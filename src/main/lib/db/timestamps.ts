/** SQLite representation used by Drizzle's integer(..., { mode: "timestamp" }). */
export function nowEpochSeconds(now: () => number = Date.now): number {
  return millisecondsToEpochSeconds(now())
}

export function millisecondsToEpochSeconds(value: number): number {
  return Math.floor(value / 1_000)
}

/** Public orchestration DTOs keep JavaScript's millisecond timestamp convention. */
export function epochSecondsToMilliseconds(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1_000 : null
}
