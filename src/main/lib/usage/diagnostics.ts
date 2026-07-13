const SECRET_FIELD =
  /("?(?:credential|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|webhook[_-]?url)"?\s*[:=]\s*)("?)([^\s,"'}]+)/gi

/** Redact provider and webhook credentials before a diagnostic reaches SQLite,
 * logs, IPC, or the renderer. Provider adapters should still avoid including
 * credentials in errors; this is the final shared boundary. */
export function redactUsageDiagnostic(value: unknown): string {
  return String((value as Error)?.message ?? value ?? "Unknown usage error")
    .replace(/(\bAuthorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(\bx-api-key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(SECRET_FIELD, "$1$2[redacted]")
    .replace(
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"')]+/gi,
      "[redacted-discord-webhook]",
    )
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{8,}\b/g, "[redacted-credential]")
    .slice(0, 2_000)
}
