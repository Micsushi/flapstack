import { randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import { TextDecoder } from "node:util"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest, isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js"
import { verifyExternalMcpProof } from "./external-grant"
import { createSqliteMcpCallerStore, resolveTrustedMcpCaller } from "./identity"
import type { McpCallerIdentity, McpControlResponse } from "./types"
import { childLiveKey } from "./child-live-key"
import { createMcpControlServer } from "./server"
import {
  MCP_PORT_HOST,
  MCP_PROOF_HEADER,
  MCP_PROOF_WINDOW_MS,
  MCP_REQUEST_BYTES,
  mcpHttpPayload,
  mcpHttpProof,
  signChildRequest,
} from "./http-auth"

export type DesktopMcpInvoke = (
  name: string,
  input: Record<string, unknown>,
  resolveCaller: () => McpCallerIdentity,
  signal: AbortSignal,
) => Promise<McpControlResponse>

const MAX_HTTP_SESSIONS = 64
const MAX_FRESH_PROOFS = 8192
const SESSION_IDLE_MS = 15 * 60_000

type Session = {
  principal: string
  exposure: "lazy" | "direct"
  transport: StreamableHTTPServerTransport
  close: () => Promise<void>
  lastRequest: number
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const part of req) {
    const chunk = Buffer.from(part)
    bytes += chunk.length
    if (bytes > MCP_REQUEST_BYTES) throw new Error("MCP request exceeds the transport limit.")
    chunks.push(chunk)
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))
}

function validateRequestId(message: unknown) {
  if (Array.isArray(message)) return false
  if (!message || typeof message !== "object" || !("id" in message)) return true
  return (
    message.id === null ||
    typeof message.id === "number" ||
    (typeof message.id === "string" && message.id.length <= 128)
  )
}

export async function startDesktopMcpTransport(
  databasePath: string,
  invoke: DesktopMcpInvoke,
  store = createSqliteMcpCallerStore(databasePath),
  assertDiffVisible?: (caller: McpCallerIdentity, chatId: string) => void,
) {
  let endpoint: string
  const route = "/mcp/" + randomUUID()
  const sessions = new Map<string, Session>()
  const proofs = new Map<string, number>()
  let startingSessions = 0
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    const reply = (status: number, message: string) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }))
    }
    const handle = async () => {
      const method = req.method ?? ""
      if (req.url !== route || req.headers.host !== new URL(endpoint).host || req.headers.origin)
        return reply(403, "Forbidden MCP destination.")
      if (!["GET", "POST", "DELETE"].includes(method)) return reply(405, "Unsupported method.")
      const proofHeader = req.headers[MCP_PROOF_HEADER]
      const sessionId = req.headers["mcp-session-id"] ?? ""
      if (
        typeof proofHeader !== "string" ||
        proofHeader.length > 2048 ||
        typeof sessionId !== "string" ||
        (sessionId && !/^[a-f0-9-]{36}$/.test(sessionId))
      )
        return reply(401, "A valid Flapstack MCP proof is required.")

      let proof
      let body: string
      try {
        proof = mcpHttpProof.parse(
          JSON.parse(Buffer.from(proofHeader, "base64url").toString("utf8")),
        )
        if (Math.abs(Date.now() - proof.at) > MCP_PROOF_WINDOW_MS)
          return reply(401, "The Flapstack MCP proof expired.")
        body = method === "POST" ? await readBody(req) : ""
      } catch {
        return reply(400, "Invalid MCP request.")
      }
      const payload = mcpHttpPayload(endpoint, method, sessionId, body, proof)
      const credentials = proof.credentials
      const principal =
        credentials.kind === "owner"
          ? "owner:" + credentials.grantId
          : JSON.stringify(["child", credentials.chatId, credentials.runId])
      let resolveCaller: () => McpCallerIdentity
      try {
        if (credentials.kind === "owner") {
          resolveCaller = () => verifyExternalMcpProof(databasePath, credentials, payload)
        } else {
          const expected = Buffer.from(
            signChildRequest(childLiveKey(credentials.chatId, credentials.runId), payload),
          )
          const signature = Buffer.from(credentials.signature)
          if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
            throw new Error("Invalid proof.")
          resolveCaller = () =>
            resolveTrustedMcpCaller({ chatId: credentials.chatId, runId: credentials.runId }, store)
        }
        resolveCaller()
      } catch {
        return reply(401, "The Flapstack MCP proof was rejected.")
      }
      const now = Date.now()
      if (Math.abs(now - proof.at) > MCP_PROOF_WINDOW_MS)
        return reply(401, "The Flapstack MCP proof expired.")
      for (const [nonce, expires] of proofs) if (expires < now) proofs.delete(nonce)
      const nonceKey = JSON.stringify([principal, proof.nonce])
      if (proofs.has(nonceKey)) return reply(409, "The MCP proof was already used.")
      if (proofs.size >= MAX_FRESH_PROOFS) return reply(429, "Too many MCP requests.")
      proofs.set(nonceKey, proof.at + MCP_PROOF_WINDOW_MS)

      let message: unknown
      if (method === "POST") {
        try {
          message = JSON.parse(body)
          if (!validateRequestId(message))
            return reply(400, "Expected a single MCP message with a bounded request ID.")
        } catch {
          return reply(400, "Invalid JSON-RPC message.")
        }
      }

      if (sessionId) {
        const session = sessions.get(sessionId)
        if (!session || session.principal !== principal || session.exposure !== proof.exposure)
          return reply(404, "MCP session is unavailable.")
        session.lastRequest = now
        if (method === "POST" && isJSONRPCRequest(message)) {
          const id = message.id
          res.once("close", () => {
            if (res.writableFinished) return
            session.transport.onmessage?.({
              jsonrpc: "2.0",
              method: "notifications/cancelled",
              params: { requestId: id, reason: "The MCP HTTP request disconnected." },
            })
          })
        }
        return await session.transport.handleRequest(req, res, message)
      }
      if (method !== "POST" || !isInitializeRequest(message))
        return reply(400, "Initialize a Flapstack MCP session first.")
      for (const [id, session] of sessions) {
        if (session.lastRequest + SESSION_IDLE_MS > now) continue
        sessions.delete(id)
        void session.close()
      }
      if (sessions.size + startingSessions >= MAX_HTTP_SESSIONS)
        return reply(429, "Too many MCP sessions.")

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, session)
        },
        onsessionclosed: (id) => {
          sessions.delete(id)
          void session.close()
        },
      })
      const control = createMcpControlServer(
        resolveCaller,
        async (name, input, signal) => {
          const liveCaller = () => {
            signal.throwIfAborted()
            return resolveCaller()
          }
          try {
            liveCaller()
          } catch {
            return {
              ok: false,
              error: {
                code: "invalid-caller",
                message: "The owner grant or active chat run is no longer valid.",
              },
            }
          }
          try {
            return await invoke(name, input, liveCaller, signal)
          } catch {
            return {
              ok: false,
              error: {
                code: "reconciliation-required",
                message:
                  "The desktop could not confirm completion. Inspect the target before retrying.",
              },
            }
          }
        },
        proof.exposure,
        assertDiffVisible,
      )
      const session: Session = {
        principal,
        exposure: proof.exposure,
        transport,
        close: () => control.close(),
        lastRequest: now,
      }
      startingSessions++
      try {
        await control.connect(transport)
        await transport.handleRequest(req, res, message)
        if (!transport.sessionId) await control.close()
      } catch (error) {
        if (transport.sessionId) sessions.delete(transport.sessionId)
        await control.close()
        throw error
      } finally {
        startingSessions--
      }
    }
    void handle().catch(() => {
      if (!res.headersSent) reply(500, "The desktop could not confirm the MCP request.")
      else res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, MCP_PORT_HOST, () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string")
        return reject(new Error("MCP loopback port unavailable."))
      endpoint = "http://" + MCP_PORT_HOST + ":" + address.port + route
      resolve()
    })
  })

  return {
    endpoint: endpoint!,
    stop: async () => {
      const closing = new Promise<void>((resolve) => server.close(() => resolve()))
      await Promise.allSettled([...sessions.values()].map((session) => session.close()))
      sessions.clear()
      server.closeAllConnections()
      await closing
    },
  }
}
