import type { IncomingMessage, ServerResponse } from "node:http"

export const MOBILE_BRIDGE_DEFAULT_PORT = 4317
export const MOBILE_BRIDGE_REQUESTS_PER_MINUTE = 120
export const MOBILE_BRIDGE_MAX_CONNECTIONS = 32
export const MOBILE_BRIDGE_MAX_CONNECTIONS_PER_ADDRESS = 4
export const MOBILE_BRIDGE_MAX_BUFFERED_BYTES = 1024 * 1024

export type MobileBridgeSettings = {
  version: 1
  enabled: boolean
  bindAddress: string | null
  port: number
}

export type MobileNetworkInterface = {
  name: string
  address: string
  family: "IPv4" | "IPv6"
  internal: boolean
}

export type MobileBridgeCertificate = {
  certPem: string
  privateKeyPem: string
  fingerprint: `sha256:${string}`
  notBefore: number
  notAfter: number
}

export type MobileBridgeTransportSession = {
  id: string
  remoteAddress: string
  send(data: string | Uint8Array): boolean
  onMessage(listener: (data: Uint8Array) => void): () => void
  onClose(listener: () => void): () => void
  close(code?: number, reason?: string): void
}

export type MobileBridgeTransportHandle = {
  address: string
  port: number
  closeSessions(code?: number, reason?: string): void
  stop(): Promise<void>
}

export type MobileBridgeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

export type MobileBridgeWebSocketHandler = (
  session: MobileBridgeTransportSession,
  request: IncomingMessage,
) => void

export type MobileBridgeTransportFactory = {
  start(input: {
    address: string
    port: number
    certificate: MobileBridgeCertificate
    requestPolicy: MobileBridgeRequestPolicy
    admission: MobileBridgeAdmissionController
    onRequest?: MobileBridgeRequestHandler
    onWebSocket?: MobileBridgeWebSocketHandler
    onFailure?: (error: Error) => void
  }): Promise<MobileBridgeTransportHandle>
}

export type MobileBridgeCertificateProvider = {
  getOrCreate(address: string): Promise<MobileBridgeCertificate>
}

export type MobileBridgeSettingsStore = {
  read(): MobileBridgeSettings
  write(settings: MobileBridgeSettings): void
}

export type MobileNetworkSource = {
  list(): MobileNetworkInterface[]
  subscribe(listener: (interfaces: MobileNetworkInterface[]) => void): () => void
}

export type MobileBridgeRequestPolicy = {
  authorize(
    headers: { host?: string; origin?: string },
    kind: "https" | "websocket",
  ): { allowed: true } | { allowed: false; status: 400 | 403; reason: string }
}

export type MobileBridgeAdmissionController = {
  acceptRequest(remoteAddress: string, now?: number): boolean
  openConnection(remoteAddress: string): boolean
  closeConnection(remoteAddress: string): void
  reset(): void
}

export type MobileBridgeLifecycleState =
  "disabled" | "starting" | "running" | "stopping" | "faulted"

export type MobileBridgeStatus = {
  state: MobileBridgeLifecycleState
  enabled: boolean
  bindAddress: string | null
  port: number
  fingerprint: `sha256:${string}` | null
  failure: string | null
}
