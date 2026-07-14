import { randomUUID } from "node:crypto"
import { createServer, type Server as HttpsServer } from "node:https"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocketServer, type RawData, type WebSocket } from "ws"
import { mobileControlLimits } from "../../../shared/mobile-control"
import type {
  MobileBridgeTransportFactory,
  MobileBridgeTransportHandle,
  MobileBridgeTransportSession,
} from "./types"
import { MOBILE_BRIDGE_MAX_BUFFERED_BYTES } from "./types"

export class NodeMobileBridgeTransportFactory implements MobileBridgeTransportFactory {
  async start(input: Parameters<MobileBridgeTransportFactory["start"]>[0]) {
    const sessions = new Map<WebSocket, MobileBridgeTransportSession>()
    const webSockets = new WebSocketServer({
      noServer: true,
      maxPayload: mobileControlLimits.eventBytes,
    })
    const server = createServer({
      cert: input.certificate.certPem,
      key: input.certificate.privateKeyPem,
      minVersion: "TLSv1.3",
      requestCert: false,
    })

    server.on("request", (request, response) => {
      void handleHttpsRequest(input, request, response)
    })
    server.on("upgrade", (request, socket, head) => {
      handleWebSocketUpgrade(input, webSockets, sessions, request, socket, head)
    })

    await listen(server, input.address, input.port)
    let stopped = false
    server.on("error", (error) => {
      if (!stopped) input.onFailure?.(toError(error))
    })

    const handle: MobileBridgeTransportHandle = {
      address: input.address,
      port: input.port,
      closeSessions(code = 1001, reason = "bridge-stopped") {
        for (const session of sessions.values()) session.close(code, reason)
      },
      async stop() {
        if (stopped) return
        stopped = true
        handle.closeSessions(1001, "bridge-stopped")
        for (const socket of webSockets.clients) socket.terminate()
        input.admission.reset()
        await closeServer(server)
      },
    }
    return handle
  }
}

async function handleHttpsRequest(
  input: Parameters<MobileBridgeTransportFactory["start"]>[0],
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const remoteAddress = request.socket.remoteAddress ?? "unknown"
  if (!input.admission.acceptRequest(remoteAddress)) {
    respond(response, 429)
    return
  }
  const authorization = input.requestPolicy.authorize(
    { host: firstHeader(request.headers.host), origin: firstHeader(request.headers.origin) },
    "https",
  )
  if (!authorization.allowed) {
    respond(response, authorization.status)
    return
  }
  if (!input.onRequest) {
    respond(response, 404)
    return
  }
  try {
    await input.onRequest(request, response)
  } catch {
    if (!response.headersSent) respond(response, 500)
    else response.destroy()
  }
}

function handleWebSocketUpgrade(
  input: Parameters<MobileBridgeTransportFactory["start"]>[0],
  webSockets: WebSocketServer,
  sessions: Map<WebSocket, MobileBridgeTransportSession>,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const remoteAddress = request.socket.remoteAddress ?? "unknown"
  if (!input.admission.acceptRequest(remoteAddress)) {
    rejectUpgrade(socket, 429)
    return
  }
  const authorization = input.requestPolicy.authorize(
    { host: firstHeader(request.headers.host), origin: firstHeader(request.headers.origin) },
    "websocket",
  )
  if (!authorization.allowed) {
    rejectUpgrade(socket, authorization.status)
    return
  }
  if (!input.admission.openConnection(remoteAddress)) {
    rejectUpgrade(socket, 429)
    return
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    const messageListeners = new Set<(data: Uint8Array) => void>()
    const closeListeners = new Set<() => void>()
    let closed = false
    const session: MobileBridgeTransportSession = {
      id: randomUUID(),
      remoteAddress,
      send(data) {
        const bytes = Buffer.byteLength(data)
        if (bytes > mobileControlLimits.snapshotBytes) {
          session.close(1009, "payload-too-large")
          return false
        }
        if (
          webSocket.readyState !== webSocket.OPEN ||
          webSocket.bufferedAmount + bytes > MOBILE_BRIDGE_MAX_BUFFERED_BYTES
        ) {
          session.close(1013, "client-too-slow")
          return false
        }
        webSocket.send(data)
        return true
      },
      onMessage(listener) {
        messageListeners.add(listener)
        return () => messageListeners.delete(listener)
      },
      onClose(listener) {
        closeListeners.add(listener)
        return () => closeListeners.delete(listener)
      },
      close(code = 1001, reason = "bridge-stopped") {
        if (
          webSocket.readyState === webSocket.OPEN ||
          webSocket.readyState === webSocket.CONNECTING
        )
          webSocket.close(code, truncateCloseReason(reason))
      },
    }
    sessions.set(webSocket, session)
    webSocket.on("message", (data) => {
      const bytes = toBytes(data)
      for (const listener of messageListeners) listener(bytes)
    })
    webSocket.once("close", () => {
      if (closed) return
      closed = true
      sessions.delete(webSocket)
      messageListeners.clear()
      for (const listener of closeListeners) listener()
      closeListeners.clear()
      input.admission.closeConnection(remoteAddress)
    })
    webSocket.once("error", () => webSocket.terminate())
    try {
      if (input.onWebSocket) input.onWebSocket(session, request)
      else session.close(1008, "endpoint-not-ready")
    } catch {
      session.close(1011, "handler-failed")
    }
  })
}

function listen(server: HttpsServer, address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen({ host: address, port, exclusive: true })
  })
}

function closeServer(server: HttpsServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections?.()
  })
}

function rejectUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${statusText(status)}\r\nConnection: close\r\n\r\n`)
}

function respond(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": "0",
    "x-content-type-options": "nosniff",
  })
  response.end()
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function statusText(status: number): string {
  if (status === 400) return "Bad Request"
  if (status === 403) return "Forbidden"
  if (status === 429) return "Too Many Requests"
  return "Rejected"
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

function truncateCloseReason(reason: string): string {
  return Buffer.from(reason).subarray(0, 123).toString("utf8")
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Mobile bridge transport failed.")
}
