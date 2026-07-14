import { isIP } from "node:net"
import {
  MOBILE_BRIDGE_MAX_CONNECTIONS,
  MOBILE_BRIDGE_MAX_CONNECTIONS_PER_ADDRESS,
  MOBILE_BRIDGE_MAX_RATE_BUCKETS,
  MOBILE_BRIDGE_REQUESTS_PER_MINUTE,
  type MobileBridgeAdmissionController,
  type MobileBridgeRequestPolicy,
} from "./types"

export class ExactMobileBridgeRequestPolicy implements MobileBridgeRequestPolicy {
  private readonly authority: string
  private readonly origin: string

  constructor(address: string, port: number) {
    this.authority = formatAuthority(address, port)
    this.origin = `https://${this.authority}`
  }

  authorize(headers: { host?: string; origin?: string }, kind: "https" | "websocket") {
    if (!headers.host || headers.host.toLowerCase() !== this.authority.toLowerCase()) {
      return { allowed: false, status: 400, reason: "host-rejected" } as const
    }
    if (headers.origin !== undefined && headers.origin !== this.origin) {
      return { allowed: false, status: 403, reason: "origin-rejected" } as const
    }
    if (kind === "websocket" && headers.origin === undefined) {
      return { allowed: false, status: 403, reason: "origin-required" } as const
    }
    return { allowed: true } as const
  }
}

export class SlidingWindowMobileBridgeAdmission implements MobileBridgeAdmissionController {
  private readonly requestTimes = new Map<string, number[]>()
  private readonly connections = new Map<string, number>()
  private totalConnections = 0

  constructor(
    private readonly requestsPerMinute = MOBILE_BRIDGE_REQUESTS_PER_MINUTE,
    private readonly maxConnections = MOBILE_BRIDGE_MAX_CONNECTIONS,
    private readonly maxConnectionsPerAddress = MOBILE_BRIDGE_MAX_CONNECTIONS_PER_ADDRESS,
    private readonly maxRateBuckets = MOBILE_BRIDGE_MAX_RATE_BUCKETS,
  ) {}

  acceptRequest(remoteAddress: string, now = Date.now()): boolean {
    const key = normalizeRemoteAddress(remoteAddress)
    const cutoff = now - 60_000
    if (!this.requestTimes.has(key) && this.requestTimes.size >= this.maxRateBuckets) {
      this.evictOldestRequestBucket()
    }
    const recent = (this.requestTimes.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= this.requestsPerMinute) {
      this.requestTimes.set(key, recent)
      return false
    }
    recent.push(now)
    this.requestTimes.set(key, recent)
    return true
  }

  openConnection(remoteAddress: string): boolean {
    const key = normalizeRemoteAddress(remoteAddress)
    const current = this.connections.get(key) ?? 0
    if (this.totalConnections >= this.maxConnections || current >= this.maxConnectionsPerAddress)
      return false
    this.connections.set(key, current + 1)
    this.totalConnections += 1
    return true
  }

  closeConnection(remoteAddress: string): void {
    const key = normalizeRemoteAddress(remoteAddress)
    const current = this.connections.get(key) ?? 0
    if (current <= 0) return
    if (current === 1) this.connections.delete(key)
    else this.connections.set(key, current - 1)
    this.totalConnections -= 1
  }

  reset(): void {
    this.requestTimes.clear()
    this.connections.clear()
    this.totalConnections = 0
  }

  private evictOldestRequestBucket(): void {
    let oldestKey: string | null = null
    let oldestTimestamp = Number.POSITIVE_INFINITY
    for (const [key, timestamps] of this.requestTimes) {
      const latest = timestamps.at(-1) ?? Number.NEGATIVE_INFINITY
      if (latest < oldestTimestamp) {
        oldestKey = key
        oldestTimestamp = latest
      }
    }
    if (oldestKey !== null) this.requestTimes.delete(oldestKey)
  }
}

function formatAuthority(address: string, port: number): string {
  return `${isIP(address) === 6 ? `[${address}]` : address}:${port}`
}

function normalizeRemoteAddress(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address
}
