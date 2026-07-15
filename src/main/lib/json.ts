export function parseJsonText(value: unknown, invalid: () => Error): unknown {
  if (typeof value !== "string") throw invalid()
  try {
    return JSON.parse(value)
  } catch {
    throw invalid()
  }
}

export function tryParseJsonText(value: unknown, fallback: unknown = null): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function parseNullableJsonText(value: string | null): unknown {
  return value ? tryParseJsonText(value) : null
}
