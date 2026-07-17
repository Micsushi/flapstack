const MIN_REASONABLE_TIMESTAMP_MS = Date.UTC(2000, 0, 1)
const MAX_REASONABLE_TIMESTAMP_MS = Date.UTC(2200, 0, 1)

export type ScopeChatTask = {
  id: string
  name: string
  description?: string | null
  archivedAt?: Date | string | number | null
}

export function normalizeScopeChatDate(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null

  let timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : /^\d+$/.test(value)
          ? Number(value)
          : Date.parse(value)

  if (!Number.isFinite(timestamp)) return null
  if (timestamp > 0 && timestamp < 10_000_000_000) timestamp *= 1_000

  // Old fixture cleanup wrote milliseconds into SQLite timestamp columns that
  // store seconds. Drizzle then multiplied those values by 1,000 on hydration.
  const repaired = timestamp / 1_000
  if (
    timestamp > MAX_REASONABLE_TIMESTAMP_MS &&
    repaired >= MIN_REASONABLE_TIMESTAMP_MS &&
    repaired <= MAX_REASONABLE_TIMESTAMP_MS
  ) {
    timestamp = repaired
  }

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

export function scopeChatTimestampMs(value: Date | string | number | null | undefined): number {
  return normalizeScopeChatDate(value)?.getTime() ?? 0
}

export function formatScopeChatTimestamp(value: Date | string | number | null | undefined): string {
  return normalizeScopeChatDate(value)?.toLocaleString() ?? "Unknown update time"
}

export function getScopeChatContext(
  chat: { name?: string | null; taskId?: string | null },
  task: ScopeChatTask | null | undefined,
): {
  taskName: string | null
  taskArchived: boolean
  testFixture: boolean
} {
  const fixtureText = [chat.name, task?.name, task?.description].filter(Boolean).join(" ")
  return {
    taskName: task?.name ?? null,
    taskArchived: Boolean(task?.archivedAt),
    testFixture: /\bfixture\b/i.test(fixtureText) || /\b\d{13}\b/.test(fixtureText),
  }
}
