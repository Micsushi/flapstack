import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, rmSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { z } from "zod"
import { createProductMcpInvalidationEndpoint } from "./invalidation-bridge"
import { readProductMcpRuntimePointer } from "./live-discovery"
import { verifyExternalMcpProof } from "./external-grant"
import {
  createSqliteMcpCallerStore,
  resolveTrustedMcpCaller,
  signLaunchedExternalMcpProof,
} from "./identity"
import type { McpCallerIdentity, McpControlResponse } from "./types"

import { CHILD_LIVE_KEY, childLiveKey } from "./child-live-key"

const shortId = z.string().min(1).max(256)
const signedRequest = z
  .object({
    name: shortId,
    input: z.record(z.unknown()),
    proof: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("child"), chatId: shortId, runId: shortId, signature: shortId })
        .strict(),
      z.object({ kind: z.literal("owner"), grantId: shortId, signature: shortId }).strict(),
    ]),
  })
  .strict()
const MAX_REPLY_BYTES = 2 * 1024 * 1024
const offline = (): McpControlResponse => ({
  ok: false,
  error: {
    code: "tool-unavailable",
    message: "The selected Flapstack profile must be running to use this control.",
  },
})

function readFrame(socket: Socket, maxBytes: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => fail(), timeoutMs)
    timer.unref()
    function cleanup() {
      clearTimeout(timer)
      socket.off("data", data).off("close", fail).off("error", fail)
    }
    function fail() {
      cleanup()
      reject(new Error("Invalid or incomplete desktop control frame."))
    }
    function data(chunk: Buffer) {
      bytes += chunk.length
      if (bytes > maxBytes) return fail()
      chunks.push(chunk)
      const index = chunk.indexOf(10)
      if (index < 0) return
      if (index !== chunk.length - 1) return fail()
      cleanup()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        fail()
      }
    }
    socket.on("data", data).once("close", fail).once("error", fail)
  })
}

function payloadFor(nonce: string, name: string, input: unknown) {
  return JSON.stringify(["flapstack-desktop-control-v1", nonce, name, input])
}

function signChild(key: string, payload: string) {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

export type DesktopMcpInvoke = (
  name: string,
  input: Record<string, unknown>,
  resolveCaller: () => McpCallerIdentity,
  signal: AbortSignal,
) => Promise<McpControlResponse>

export async function startDesktopMcpTransport(databasePath: string, invoke: DesktopMcpInvoke) {
  const endpoint = createProductMcpInvalidationEndpoint()
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("error", () => socket.destroy())
    const abort = new AbortController()
    socket.on("close", () => {
      sockets.delete(socket)
      abort.abort()
    })
    const execute = async () => {
      const nonce = randomBytes(32).toString("base64url")
      socket.write(JSON.stringify({ nonce }) + "\n")
      const { name, input, proof } = signedRequest.parse(await readFrame(socket, 512 * 1024, 5000))
      const payload = payloadFor(nonce, name, input)
      const resolveCaller = () => {
        if (abort.signal.aborted) throw new Error("Desktop client disconnected.")
        if (proof.kind === "owner") return verifyExternalMcpProof(databasePath, proof, payload)
        const expected = Buffer.from(signChild(childLiveKey(proof.chatId, proof.runId), payload))
        const signature = Buffer.from(proof.signature)
        if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
          throw new Error("Invalid child proof.")
        return resolveTrustedMcpCaller(
          { chatId: proof.chatId, runId: proof.runId },
          createSqliteMcpCallerStore(databasePath),
        )
      }
      resolveCaller()
      return await invoke(name, input, resolveCaller, abort.signal)
    }
    void execute()
      .catch((): McpControlResponse => ({
        ok: false,
        error: {
          code: "invalid-caller",
          message: "Desktop request could not be authenticated or completed.",
        },
      }))
      .then((response) => {
        const frame = JSON.stringify(response)
        socket.end(
          (Buffer.byteLength(frame) < MAX_REPLY_BYTES
            ? frame
            : JSON.stringify({
                ok: false,
                error: {
                  code: "invalid-input",
                  message: "Desktop reply exceeded the transport limit; request a smaller result.",
                },
              })) + "\n",
        )
      })
      .catch(() => socket.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, () => {
      server.off("error", reject)
      resolve()
    })
  })
  if (process.platform !== "win32") chmodSync(endpoint, 0o600)
  return {
    endpoint,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (process.platform !== "win32") rmSync(endpoint, { force: true })
    },
  }
}

export async function callDesktopMcpTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
): Promise<McpControlResponse> {
  const pointer = readProductMcpRuntimePointer()
  if (!pointer) return offline()
  const socket = createConnection(pointer.controlEndpoint)
  socket.on("error", () => socket.destroy())
  let sent = false
  try {
    const { nonce } = z
      .object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(await readFrame(socket, 256, 5000))
    const payload = payloadFor(nonce, name, input)
    let proof: z.infer<typeof signedRequest>["proof"]
    if (caller.callerKind === "external-owner") {
      proof = { kind: "owner", ...signLaunchedExternalMcpProof(payload) }
    } else {
      const key = process.env[CHILD_LIVE_KEY]
      if (!key || !caller.runId)
        return {
          ok: false,
          error: { code: "invalid-caller", message: "This client has no live run registration." },
        }
      proof = {
        kind: "child",
        chatId: caller.chatId,
        runId: caller.runId,
        signature: signChild(key, payload),
      }
    }
    socket.write(JSON.stringify({ name, input, proof }) + "\n")
    sent = true
    const reply = await readFrame(socket, MAX_REPLY_BYTES, 120_000)
    if (!reply || typeof reply !== "object" || !("ok" in reply) || typeof reply.ok !== "boolean")
      throw new Error("Invalid reply.")
    return reply as McpControlResponse
  } catch {
    return sent
      ? {
          ok: false,
          error: {
            code: "reconciliation-required",
            message:
              "Desktop reply was interrupted. Inspect the target or audit log before retrying.",
          },
        }
      : offline()
  } finally {
    socket.destroy()
  }
}
