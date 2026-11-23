// A 429 alone does not establish exhausted quota or a known reset time.
const QUOTA =
  /\b(?:insufficient[_ -]quota|usage[_ -]limit(?:[_ -]reached)?|quota[_ -]exceeded|out of (?:usage|credits))\b/i
const RATE = /\b(?:rate[_ -]limit(?:ed|[_ -](?:exceeded|error))?|too many requests)\b/i
const HTTP_429 = /(?:^\s*429\b|\b(?:http|status(?: code)?|error(?: code)?)\s*[:=]?\s*429\b)/i

export function monthlySpendLimit(message: string): boolean {
  return /\bmonthly spend(?:ing)? limit\b/i.test(message)
}

export const MONTHLY_SPEND_LIMIT_MESSAGE =
  "The monthly spend limit for this model has been reached. Switch models or manage usage credits in your provider account."

export function classifyProviderLimitError(
  message: string,
  code?: unknown,
): "quota" | "rate" | null {
  if (
    code === "insufficient_quota" ||
    code === "usage_limit_reached" ||
    QUOTA.test(message) ||
    monthlySpendLimit(message)
  )
    return "quota"
  if (
    code === "rate_limit_exceeded" ||
    code === "rate_limit_error" ||
    RATE.test(message) ||
    HTTP_429.test(message)
  )
    return "rate"
  return null
}
