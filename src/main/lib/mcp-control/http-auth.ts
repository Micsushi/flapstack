import { createHmac, randomBytes } from "node:crypto"
import { request, Agent } from "node:http"
import { Readable } from "node:stream"
import { z } from "zod"
import { signLaunchedExternalMcpProof } from "./identity"
import type { McpCallerIdentity } from "./types"
import { CHILD_LIVE_KEY } from "./child-live-key"
import { validProductMcpHttpEndpoint } from "./live-discovery"

export const MCP_REQUEST_BYTES = 512 * 1024
export const MCP_PORT_HOST = "127.0.0.1"
export const MCP_PROOF_HEADER = "x-flapstack-mcp-proof"
export const MCP_PROOF_WINDOW_MS = 30_000
const id = z.string().min(1).max(256)
export const mcpHttpProof = z
  .object({
    at: z.number().int(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    exposure: z.enum(["lazy", "direct"]),
    credentials: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("child"), chatId: id, runId: id, signature: id }).strict(),
      z.object({ kind: z.literal("owner"), grantId: id, signature: id }).strict(),
    ]),
  })
  .strict()

export function mcpHttpPayload(
  endpoint: string,
  method: string,
  session: string,
  body: string,
  proof: Pick<z.infer<typeof mcpHttpProof>, "at" | "nonce" | "exposure">,
) {
  return JSON.stringify([
    "flapstack-mcp-http-v1",
    endpoint,
    method,
    session,
    body,
    proof.at,
    proof.nonce,
    proof.exposure,
  ])
}

export function signChildRequest(key: string, payload: string) {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

const loopbackAgent = new Agent({ keepAlive: true, maxSockets: 16 })

export function signedMcpHttpFetch(
  endpoint: string,
  caller: McpCallerIdentity,
  exposure: "lazy" | "direct",
): typeof globalThis.fetch {
  if (!validProductMcpHttpEndpoint(endpoint))
    throw new Error("Invalid Flapstack loopback endpoint.")
  return async (url, args) => {
    if (String(url) !== endpoint) throw new Error("Unexpected MCP request destination.")
    const headers = new Headers(args?.headers)
    const proof = { at: Date.now(), nonce: randomBytes(16).toString("base64url"), exposure }
    const method = args?.method ?? "GET"
    const body = args?.body ?? ""
    if (typeof body !== "string" || Buffer.byteLength(body) > MCP_REQUEST_BYTES)
      throw new Error("MCP request exceeds the transport limit.")
    const payload = mcpHttpPayload(
      endpoint,
      method,
      headers.get("mcp-session-id") ?? "",
      body,
      proof,
    )
    let credentials: z.infer<typeof mcpHttpProof>["credentials"]
    if (caller.callerKind === "external-owner") {
      credentials = { kind: "owner", ...signLaunchedExternalMcpProof(payload) }
    } else {
      const key = process.env[CHILD_LIVE_KEY]
      if (!key || !caller.runId) throw new Error("Missing launcher-issued MCP credential.")
      credentials = {
        kind: "child",
        chatId: caller.chatId,
        runId: caller.runId,
        signature: signChildRequest(key, payload),
      }
    }
    headers.set(
      MCP_PROOF_HEADER,
      Buffer.from(JSON.stringify({ ...proof, credentials })).toString("base64url"),
    )
    const signal =
      method === "GET"
        ? args?.signal
        : AbortSignal.any([...(args?.signal ? [args.signal] : []), AbortSignal.timeout(75_000)])
    // This local transport deliberately does not follow redirects or proxy environment settings.
    const requestHeaders: Record<string, string> = {}
    headers.forEach((value, name) => {
      requestHeaders[name] = value
    })
    return await new Promise<Response>((resolve, reject) => {
      const connection = request(
        endpoint,
        {
          method,
          signal: signal ?? undefined,
          headers: requestHeaders,
          agent: loopbackAgent,
        },
        (response) => {
          const status = response.statusCode ?? 500
          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") responseHeaders.set(name, value)
            else if (value) for (const item of value) responseHeaders.append(name, item)
          }
          if (status === 204 || status === 205 || status === 304) {
            response.resume()
            resolve(new Response(null, { status, headers: responseHeaders }))
          } else {
            resolve(
              new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
                status,
                headers: responseHeaders,
              }),
            )
          }
        },
      )
      connection.once("error", reject)
      connection.end(body)
    })
  }
}
