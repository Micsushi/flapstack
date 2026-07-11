import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

const MAX_REQUEST_BYTES = 64 * 1024 * 1024
const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export interface GenerationProxyHandle {
  baseUrl: string
  takeGenerationId(): string | undefined
  close(): void
}

/** Local-only OpenRouter pass-through used to retain the official
 * X-Generation-Id response header that OpenCode otherwise discards. */
export async function startOpenRouterGenerationProxy(
  upstreamBaseUrl = "https://openrouter.ai/api/v1",
  fetchImpl: typeof fetch = fetch,
): Promise<GenerationProxyHandle> {
  const generationIds: string[] = []
  const server = createServer(async (request, response) => {
    try {
      const body = await readRequestBody(request)
      const upstream = new URL(
        (request.url ?? "/").replace(/^\//, ""),
        `${upstreamBaseUrl.replace(/\/$/, "")}/`,
      )
      const upstreamResponse = await fetchImpl(upstream, {
        method: request.method,
        headers: forwardedRequestHeaders(request.headers),
        ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
      })
      const generationId = upstreamResponse.headers.get("x-generation-id")?.trim()
      if (generationId) generationIds.push(generationId)
      response.statusCode = upstreamResponse.status
      response.statusMessage = upstreamResponse.statusText
      upstreamResponse.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) response.setHeader(key, value)
      })
      if (!upstreamResponse.body) {
        response.end()
        return
      }
      Readable.fromWeb(upstreamResponse.body as unknown as NodeReadableStream).pipe(response)
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : String(error) },
        }),
      )
    }
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Generation proxy did not bind TCP")
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    takeGenerationId: () => generationIds.shift(),
    close: () => server.close(),
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_REQUEST_BYTES) throw new Error("OpenRouter proxy request exceeded 64 MB")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function forwardedRequestHeaders(headers: IncomingHttpHeaders): Headers {
  const forwarded = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === "host" || value == null) continue
    if (Array.isArray(value)) value.forEach((item) => forwarded.append(key, item))
    else forwarded.set(key, value)
  }
  return forwarded
}
