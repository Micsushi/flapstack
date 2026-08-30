const INTERNAL_PROVIDER_NAMES = /\b(?:OpenCode|1Code)\b/gi

/** Keep implementation and inherited-project names out of user-visible errors. */
export function sanitizeProviderErrorText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)

  if (/session\.fork failed:\s*HTTP 404/i.test(text)) {
    return "The previous provider session expired. Start a fresh response and retry."
  }

  if (
    /(?:fetch failed|network request failed|socket hang up|ECONNRESET|ENETUNREACH|ENOTFOUND|EAI_AGAIN)/i.test(
      text,
    )
  ) {
    return "The provider connection was interrupted. Check your network and retry. Local credentials were kept."
  }

  return text
    .replace(INTERNAL_PROVIDER_NAMES, "Provider runtime")
    .replace(/session\.(?:create|fork|prompt_async)/gi, "session request")
}
