const INTERNAL_PROVIDER_NAMES = /\b(?:OpenCode|1Code)\b/gi

/** Keep implementation and inherited-project names out of user-visible errors. */
export function sanitizeProviderErrorText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)

  if (/session\.fork failed:\s*HTTP 404/i.test(text)) {
    return "The previous provider session expired. Start a fresh response and retry."
  }

  return text
    .replace(INTERNAL_PROVIDER_NAMES, "Provider runtime")
    .replace(/session\.(?:create|fork|prompt_async)/gi, "session request")
}
