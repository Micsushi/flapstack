import { validateLocalModelEndpoint } from "../../../shared/local-model-contract"

/** Bounded local-only Ollama requests, including the complete response body. */
export async function requestOllamaJson(
  endpoint: "/api/tags" | "/api/generate",
  options: { timeoutMs: number; maxBytes: number; body?: unknown; baseUrl?: string },
): Promise<unknown> {
  const config = validateLocalModelEndpoint(options.baseUrl ?? "http://localhost:11434")
  if (!config.valid) throw new Error(config.message)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(`${config.endpoint}${endpoint}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error("Local model request failed")
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > options.maxBytes) throw new Error("Local model response exceeded limit")
      chunks.push(value)
    }
    controller.signal.throwIfAborted()
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } finally {
    controller.abort()
    clearTimeout(timer)
    if (reader) {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
}
