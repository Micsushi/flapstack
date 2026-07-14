import type { AutomationNextFireCalculator, AutomationScheduleTrigger } from "./scheduler"

const MINUTE_MS = 60_000
const MAX_LOOKAHEAD_DAYS = 366 * 5
const MONTH_NAMES = new Map(
  ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map(
    (name, index) => [name, index + 1],
  ),
)
const WEEKDAY_NAMES = new Map(
  ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((name, index) => [name, index]),
)

interface CronField {
  values: number[]
  matches: Set<number>
  wildcard: boolean
}

interface ParsedCron {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

interface LocalDateTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export class AutomationCronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AutomationCronError"
  }
}

export class CronAutomationNextFireCalculator implements AutomationNextFireCalculator {
  private readonly formatters = new Map<string, Intl.DateTimeFormat>()

  nextFireAfter(trigger: AutomationScheduleTrigger, afterMs: number): number | null {
    if (!Number.isSafeInteger(afterMs)) {
      throw new AutomationCronError("Cron reference time must be a safe integer timestamp.")
    }
    const cron = parseCron(trigger.cron)
    const formatter = this.formatter(trigger.timezone)
    const localStart = localParts(formatter, afterMs)
    const firstDate = Date.UTC(localStart.year, localStart.month - 1, localStart.day)

    for (let dayOffset = 0; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset += 1) {
      const date = new Date(firstDate + dayOffset * 86_400_000)
      const year = date.getUTCFullYear()
      const month = date.getUTCMonth() + 1
      const day = date.getUTCDate()
      if (!dateMatches(cron, year, month, day)) continue

      const offsets = possibleOffsets(formatter, Date.UTC(year, month - 1, day, 12))
      let earliest: number | null = null
      for (const hour of cron.hour.values) {
        for (const minute of cron.minute.values) {
          const candidates = resolveLocalTime(formatter, offsets, {
            year,
            month,
            day,
            hour,
            minute,
          })
          for (const candidate of candidates) {
            if (candidate > afterMs && (earliest === null || candidate < earliest)) {
              earliest = candidate
            }
          }
        }
      }
      if (earliest !== null) return earliest
    }
    return null
  }

  private formatter(timezone: string): Intl.DateTimeFormat {
    const existing = this.formatters.get(timezone)
    if (existing) return existing
    let formatter: Intl.DateTimeFormat
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        calendar: "gregory",
        numberingSystem: "latn",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      formatter.format(0)
    } catch {
      throw new AutomationCronError(`Invalid automation timezone: ${timezone}`)
    }
    this.formatters.set(timezone, formatter)
    return formatter
  }
}

function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new AutomationCronError("Automation schedules require five cron fields.")
  }
  return {
    minute: parseField(fields[0], 0, 59, "minute"),
    hour: parseField(fields[1], 0, 23, "hour"),
    dayOfMonth: parseField(fields[2], 1, 31, "day-of-month"),
    month: parseField(fields[3], 1, 12, "month", MONTH_NAMES),
    dayOfWeek: parseField(fields[4], 0, 7, "day-of-week", WEEKDAY_NAMES, normalizeWeekday),
  }
}

function parseField(
  source: string,
  minimum: number,
  maximum: number,
  name: string,
  aliases = new Map<string, number>(),
  normalize: (value: number) => number = (value) => value,
): CronField {
  const values = new Set<number>()
  for (const item of source.toUpperCase().split(",")) {
    if (!item) throw new AutomationCronError(`Invalid empty ${name} cron item.`)
    const [rangeSource, stepSource, extra] = item.split("/")
    if (extra !== undefined) throw new AutomationCronError(`Invalid ${name} cron step: ${item}`)
    const step = stepSource === undefined ? 1 : parseInteger(stepSource, name)
    if (step <= 0) throw new AutomationCronError(`${name} cron step must be positive.`)

    let start: number
    let end: number
    if (rangeSource === "*") {
      start = minimum
      end = maximum
    } else if (rangeSource.includes("-")) {
      const [startSource, endSource, rangeExtra] = rangeSource.split("-")
      if (rangeExtra !== undefined) throw new AutomationCronError(`Invalid ${name} range: ${item}`)
      start = parseValue(startSource, aliases, name)
      end = parseValue(endSource, aliases, name)
    } else {
      start = parseValue(rangeSource, aliases, name)
      end = stepSource === undefined ? start : maximum
    }
    if (start < minimum || end > maximum || start > end) {
      throw new AutomationCronError(`${name} cron value is outside ${minimum}-${maximum}: ${item}`)
    }
    for (let value = start; value <= end; value += step) values.add(normalize(value))
  }
  if (values.size === 0) throw new AutomationCronError(`${name} cron field has no values.`)
  return {
    values: [...values].sort((left, right) => left - right),
    matches: values,
    wildcard: source === "*" || source === "*/1",
  }
}

function parseValue(source: string, aliases: Map<string, number>, name: string): number {
  const alias = aliases.get(source)
  return alias ?? parseInteger(source, name)
}

function parseInteger(source: string, name: string): number {
  if (!/^\d+$/.test(source)) throw new AutomationCronError(`Invalid ${name} cron value: ${source}`)
  return Number(source)
}

function normalizeWeekday(value: number): number {
  return value === 7 ? 0 : value
}

function dateMatches(cron: ParsedCron, year: number, month: number, day: number): boolean {
  if (!cron.month.matches.has(month)) return false
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const dayOfMonthMatches = cron.dayOfMonth.matches.has(day)
  const dayOfWeekMatches = cron.dayOfWeek.matches.has(weekday)
  if (cron.dayOfMonth.wildcard) return dayOfWeekMatches
  if (cron.dayOfWeek.wildcard) return dayOfMonthMatches
  return dayOfMonthMatches || dayOfWeekMatches
}

function possibleOffsets(formatter: Intl.DateTimeFormat, localNoonAsUtc: number): number[] {
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = localNoonAsUtc + hours * 3_600_000
    const parts = localParts(formatter, instant)
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    offsets.add(represented - Math.floor(instant / MINUTE_MS) * MINUTE_MS)
  }
  return [...offsets]
}

function resolveLocalTime(
  formatter: Intl.DateTimeFormat,
  offsets: number[],
  expected: LocalDateTime,
): number[] {
  const represented = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  )
  const matches = new Set<number>()
  for (const offset of offsets) {
    const candidate = represented - offset
    if (sameLocalTime(localParts(formatter, candidate), expected)) matches.add(candidate)
  }
  return [...matches].sort((left, right) => left - right)
}

function sameLocalTime(actual: LocalDateTime, expected: LocalDateTime): boolean {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute
  )
}

function localParts(formatter: Intl.DateTimeFormat, timestamp: number): LocalDateTime {
  const parts = new Map(
    formatter
      .formatToParts(timestamp)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: requiredPart(parts, "year"),
    month: requiredPart(parts, "month"),
    day: requiredPart(parts, "day"),
    hour: requiredPart(parts, "hour"),
    minute: requiredPart(parts, "minute"),
  }
}

function requiredPart(parts: Map<string, number>, name: string): number {
  const value = parts.get(name)
  if (value === undefined || !Number.isFinite(value)) {
    throw new AutomationCronError(`Timezone formatter omitted ${name}.`)
  }
  return value
}
