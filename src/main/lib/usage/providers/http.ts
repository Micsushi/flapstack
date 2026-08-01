import { UsageProviderError, type UsageProviderId } from "../types"

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000
export const DEFAULT_PROVIDER_MAX_ATTEMPTS = 3

export async function fetchProviderResponse(params: {
  providerId: UsageProviderId
  url: string
  init?: RequestInit
  timeoutMs?: number
}): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(params.url, { ...params.init, signal: controller.signal })
  } catch (error) {
    throw new UsageProviderError(
      params.providerId,
      "source-unavailable",
      controller.signal.aborted
        ? `Provider usage request timed out after ${timeoutMs}ms`
        : "Provider usage request failed",
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function getProviderJson<T>(params: {
  providerId: UsageProviderId
  url: string
  apiKey: string
  auth?: "bearer" | "x-api-key"
  headers?: Record<string, string>
  timeoutMs?: number
  maxAttempts?: number
}): Promise<T> {
  return (await getProviderJsonResponse<T>(params)).payload
}

export async function getProviderJsonResponse<T>(params: {
  providerId: UsageProviderId
  url: string
  apiKey: string
  auth?: "bearer" | "x-api-key"
  headers?: Record<string, string>
  timeoutMs?: number
  maxAttempts?: number
}): Promise<{ payload: T; headers: Headers }> {
  const headers: Record<string, string> = { ...params.headers }
  if (params.auth === "x-api-key") headers["x-api-key"] = params.apiKey
  else headers.authorization = `Bearer ${params.apiKey}`
  const maxAttempts = Math.max(1, Math.min(params.maxAttempts ?? DEFAULT_PROVIDER_MAX_ATTEMPTS, 5))
  let lastStatus = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchProviderResponse({
      providerId: params.providerId,
      url: params.url,
      init: { headers },
      timeoutMs: params.timeoutMs,
    })
    lastStatus = response.status
    if (response.status === 401 || response.status === 403) {
      throw new UsageProviderError(
        params.providerId,
        "auth-failed",
        "Provider rejected the configured credential",
      )
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < maxAttempts) {
        await retryDelay(response.headers.get("retry-after"), attempt)
        continue
      }
      throw new UsageProviderError(
        params.providerId,
        response.status === 429 ? "rate-limited" : "source-unavailable",
        response.status === 429
          ? "Provider rate limited the usage request"
          : `Provider usage endpoint returned HTTP ${response.status}`,
      )
    }
    if (!response.ok) {
      throw new UsageProviderError(
        params.providerId,
        "source-unavailable",
        `Provider usage endpoint returned HTTP ${response.status}`,
      )
    }
    return {
      payload: await readProviderJson<T>(response, params.providerId, params.timeoutMs),
      headers: response.headers,
    }
  }
  throw new UsageProviderError(
    params.providerId,
    "source-unavailable",
    `Provider usage endpoint returned HTTP ${lastStatus}`,
  )
}

/** Keep the deadline active through body consumption. A server can send
 * headers and then stall forever; aborting fetch alone does not protect mocked
 * or non-standard Response implementations, so the body read is also raced. */
export async function readProviderJson<T>(
  response: Response,
  providerId: UsageProviderId,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    return await Promise.race([
      response.json() as Promise<T>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          void response.body?.cancel("Provider usage response body timed out").catch(() => {})
          reject(
            new UsageProviderError(
              providerId,
              "source-unavailable",
              `Provider usage response body timed out after ${timeoutMs}ms`,
            ),
          )
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    if (error instanceof UsageProviderError) throw error
    throw new UsageProviderError(
      providerId,
      "source-unavailable",
      "Provider usage endpoint returned invalid JSON",
    )
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut) void response.body?.cancel().catch(() => {})
  }
}

export function iso(value: Date): string {
  return value.toISOString()
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

async function retryDelay(retryAfter: string | null, attempt: number): Promise<void> {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter)
  const milliseconds = Number.isFinite(seconds)
    ? Math.max(0, Math.min(seconds * 1_000, 5_000))
    : Math.min(100 * 2 ** (attempt - 1), 1_000)
  if (milliseconds === 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
