import { UsageProviderError, type UsageProviderId } from "../types"

export async function getProviderJson<T>(params: {
  providerId: UsageProviderId
  url: string
  apiKey: string
  auth?: "bearer" | "x-api-key"
  headers?: Record<string, string>
}): Promise<T> {
  const headers: Record<string, string> = { ...params.headers }
  if (params.auth === "x-api-key") headers["x-api-key"] = params.apiKey
  else headers.authorization = `Bearer ${params.apiKey}`
  const response = await fetch(params.url, {
    headers,
  })
  if (response.status === 401 || response.status === 403) {
    throw new UsageProviderError(
      params.providerId,
      "auth-failed",
      "Provider rejected the configured credential",
    )
  }
  if (response.status === 429) {
    throw new UsageProviderError(
      params.providerId,
      "rate-limited",
      "Provider rate limited the usage request",
    )
  }
  if (!response.ok) {
    throw new UsageProviderError(
      params.providerId,
      "source-unavailable",
      `Provider usage endpoint returned HTTP ${response.status}`,
    )
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new UsageProviderError(
      params.providerId,
      "source-unavailable",
      "Provider usage endpoint returned invalid JSON",
    )
  }
}

export function iso(value: Date): string {
  return value.toISOString()
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}
