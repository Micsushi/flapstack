/**
 * Utilities for managing command buffer and extracting tab titles.
 */

/**
 * Sanitize a command string for use as a tab title.
 * Removes control characters, trims whitespace, and limits length.
 *
 * @param command - The raw command buffer contents
 * @returns A sanitized string suitable for use as a tab title
 */
export function sanitizeForTitle(command: string): string {
  if (!command) return ""

  // Remove ANSI escape sequences
  let cleaned = command.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")

  // Remove other control characters
  cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, "")

  // Terminal titles are persisted. Remove credential-bearing forms before
  // truncation so a useful-looking prefix cannot durably retain a secret.
  cleaned = cleaned
    .replace(
      /(\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /(--(?:api[-_]?key|token|secret|password|credential)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]",
    )
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s'"]+/gi, "$1[redacted]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
      "[redacted]",
    )

  // Trim and limit length
  cleaned = cleaned.trim()

  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 47) + "..."
  }

  return cleaned
}
