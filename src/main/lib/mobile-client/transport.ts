import { Agent, request } from "node:https"
import { connect, type TLSSocket } from "node:tls"
import { X509Certificate } from "node:crypto"
import WebSocket from "ws"
import { classifyMobileBindAddress, mobileControlLimits } from "../../../shared/mobile-control"

export function remoteEndpoint(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !url.port ||
    !["private", "private-overlay"].includes(classifyMobileBindAddress(host))
  )
    throw new Error("Use the exact HTTPS private-network address from the host pairing offer.")
  return url
}

export function verifyRemoteCertificate(raw: Buffer, fingerprint: string, now = Date.now()) {
  const cert = new X509Certificate(raw)
  if (
    `sha256:${cert.fingerprint256.replaceAll(":", "").toLowerCase()}` !== fingerprint ||
    now < Date.parse(cert.validFrom) ||
    now > Date.parse(cert.validTo)
  )
    throw new Error("Remote certificate changed or expired. Confirm a fresh host offer.")
}

export function pinnedAgent(endpoint: string, fingerprint: string) {
  const url = remoteEndpoint(endpoint)
  const agent = new Agent({ keepAlive: false, maxSockets: 1 })
  // Only this socket uses explicit certificate pin trust. No bytes are handed to
  // HTTP/WebSocket until the exact peer certificate has been verified.
  agent.createConnection = ((
    _options: unknown,
    done: (error: Error | null, socket?: TLSSocket) => void,
  ) => {
    const socket = connect({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port),
      rejectUnauthorized: false,
    })
    let finished = false
    const finish = (error: Error | null) => {
      if (finished) return
      finished = true
      if (error) socket.destroy()
      done(error, error ? undefined : socket)
    }
    socket.setTimeout(10_000, () => finish(new Error("Remote TLS connection timed out.")))
    socket.once("error", finish)
    socket.once("secureConnect", () => {
      try {
        verifyRemoteCertificate(socket.getPeerCertificate().raw, fingerprint)
        socket.setTimeout(0)
        finish(null)
      } catch {
        finish(new Error("Remote certificate verification failed."))
      }
    })
    return undefined
  }) as typeof agent.createConnection
  return agent
}

export class RemoteTransport {
  readonly agent: Agent
  readonly origin: string
  constructor(endpoint: string, fingerprint: string) {
    this.origin = remoteEndpoint(endpoint).origin
    this.agent = pinnedAgent(endpoint, fingerprint)
  }
  post(
    path: "/mobile/v1/pair" | "/mobile/v1/challenge" | "/mobile/v1/authenticate",
    body: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = request(
        new URL(path, this.origin),
        {
          agent: this.agent,
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: this.origin },
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          res.on("data", (chunk: Buffer) => {
            size += chunk.length
            if (size > mobileControlLimits.snapshotBytes)
              res.destroy(new Error("Remote response exceeds limit."))
            else chunks.push(chunk)
          })
          res.on("error", reject)
          res.on("end", () => {
            try {
              if (res.statusCode !== (path === "/mobile/v1/challenge" ? 200 : 201))
                throw new Error("Remote host refused the request. Check pairing and grant.")
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      req.on("timeout", () => req.destroy(new Error("Remote request timed out.")))
      req.on("error", reject)
      req.end(JSON.stringify(body))
    })
  }
  socket() {
    return new WebSocket(this.origin.replace("https:", "wss:") + "/mobile/v1/events", {
      agent: this.agent,
      origin: this.origin,
      followRedirects: false,
      maxPayload: mobileControlLimits.snapshotBytes,
      handshakeTimeout: 10_000,
    })
  }
  close() {
    this.agent.destroy()
  }
}
