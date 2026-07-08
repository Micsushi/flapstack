const SESSION_NOT_FOUND_PATTERN = /No conversation found with session ID/i

export function findMissingClaudeSessionMessage(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      if (SESSION_NOT_FOUND_PATTERN.test(value)) return value
      continue
    }

    if (Array.isArray(value)) {
      const nested = findMissingClaudeSessionMessage(...value)
      if (nested) return nested
      continue
    }

    if (value && typeof value === "object") {
      const candidate = value as {
        message?: unknown
        error?: unknown
        errors?: unknown
      }
      const nested = findMissingClaudeSessionMessage(
        candidate.message,
        candidate.error,
        candidate.errors,
      )
      if (nested) return nested
    }
  }

  return null
}

export function isMissingClaudeSessionError(...values: unknown[]): boolean {
  return findMissingClaudeSessionMessage(...values) !== null
}
