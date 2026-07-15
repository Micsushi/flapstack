export type EventRecord = Record<string, unknown>

export function eventRecord(value: unknown): EventRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as EventRecord) : {}
}

export function eventArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function eventString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function eventNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function eventFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function eventNonNegativeFiniteNumber(value: unknown): number | null {
  const result = eventFiniteNumber(value)
  return result !== null && result >= 0 ? result : null
}
