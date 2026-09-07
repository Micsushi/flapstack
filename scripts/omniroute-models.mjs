import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"

const catalogSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(512),
        name: z.string().max(1024).optional(),
        owned_by: z.string().max(256).optional(),
        context_length: z.number().int().nonnegative().optional(),
        capabilities: z
          .object({
            tool_calling: z.boolean().optional(),
            reasoning: z.boolean().optional(),
            thinking: z.boolean().optional(),
            vision: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .max(10_000),
})

export function omniRouteModelsEndpoint(baseUrl) {
  const url = new URL(baseUrl)
  if (url.username || url.password || url.search || url.hash)
    throw new Error("OmniRoute URL must not contain credentials, a query, or a fragment")
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("OmniRoute requires HTTPS, except for explicit loopback HTTP")
  const base = url.pathname.replace(/\/+$/, "")
  url.pathname = `${base.endsWith("/v1") ? base : `${base}/v1`}/models`
  return url
}

export async function fetchOmniRouteModels({ baseUrl, apiKey, signal, timeoutMs = 10_000 }) {
  const endpoint = omniRouteModelsEndpoint(baseUrl)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new Error("OmniRoute timeout must be between 1 and 10000 milliseconds")
  if (apiKey != null && (typeof apiKey !== "string" || /[\r\n]/.test(apiKey)))
    throw new Error("Invalid OmniRoute API key format")
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response
  try {
    response = await fetch(endpoint, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: "manual",
      signal: requestSignal,
    })
  } catch {
    throw new Error(
      requestSignal.aborted
        ? "OmniRoute request cancelled or timed out"
        : "OmniRoute connection failed",
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`OmniRoute model catalog returned HTTP ${response.status}`)
  }
  if (!response.body) throw new Error("OmniRoute model catalog body is missing")
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2 * 1024 * 1024) throw new Error("OmniRoute model catalog exceeded 2 MiB")
      chunks.push(value)
    }
  } catch {
    throw new Error(
      requestSignal.aborted
        ? "OmniRoute request cancelled or timed out"
        : "OmniRoute model catalog could not be read within its limit",
    )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  let payload
  try {
    payload = catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  } catch {
    throw new Error("OmniRoute model catalog does not match the supported contract")
  }
  if (new Set(payload.data.map((model) => model.id)).size !== payload.data.length)
    throw new Error("OmniRoute model catalog contains duplicate IDs")
  if (apiKey && JSON.stringify(payload).includes(JSON.stringify(apiKey).slice(1, -1)))
    throw new Error("OmniRoute model catalog contains credential material")
  return { provider: "omniroute", endpoint: endpoint.href, models: payload.data }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2 || !process.env.FLAPSTACK_OMNIROUTE_URL)
      throw new Error(
        "Set FLAPSTACK_OMNIROUTE_URL and optionally FLAPSTACK_OMNIROUTE_API_KEY; this command takes no arguments",
      )
    console.log(
      JSON.stringify(
        await fetchOmniRouteModels({
          baseUrl: process.env.FLAPSTACK_OMNIROUTE_URL,
          apiKey: process.env.FLAPSTACK_OMNIROUTE_API_KEY,
        }),
      ),
    )
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }))
    process.exitCode = 1
  }
}
