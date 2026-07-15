const formatterCache = new Map<string, Intl.DateTimeFormat>()

export type UsageLocalTime = {
  year: number
  month: number
  day: number
  hour: number
}

export function epochMs(value: unknown, parseStrings = false): number | null {
  if (value instanceof Date) return value.getTime()
  if (parseStrings && typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1_000 : value
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function zonedParts(timestampMs: number, timezone: string) {
  let formatter = formatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    formatterCache.set(timezone, formatter)
  }
  const values = Object.fromEntries(
    formatter
      .formatToParts(timestampMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

export function zonedLocalToUtc(local: UsageLocalTime, timezone: string): number {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour)
  let guess = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(guess, timezone)
    const actualLocal = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour)
    const adjustment = target - actualLocal
    if (adjustment === 0) return guess
    guess += adjustment
  }
  return guess
}

export function normalizeLocal(local: UsageLocalTime): UsageLocalTime {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
  }
}
