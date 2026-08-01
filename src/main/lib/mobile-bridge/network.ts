import { networkInterfaces } from "node:os"
import { canBindMobileBridge, classifyMobileBindAddress } from "../../../shared/mobile-control"
import type { MobileNetworkInterface, MobileNetworkSource } from "./types"

export function listMobileNetworkInterfaces(): MobileNetworkInterface[] {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).map((entry) => ({
      name,
      address: stripIpv6Zone(entry.address),
      family: entry.family,
      internal: entry.internal,
    })),
  )
}

export function validateMobileBridgeBindAddress(
  address: string,
  interfaces: readonly MobileNetworkInterface[],
): MobileNetworkInterface {
  const normalized = stripIpv6Zone(address.trim())
  const approved = interfaces.filter((entry) => {
    const classification = classifyMobileBindAddress(entry.address)
    return !entry.internal && (classification === "private" || classification === "private-overlay")
  })
  if (
    !canBindMobileBridge(
      normalized,
      approved.map((entry) => entry.address),
    )
  ) {
    throw new Error("Mobile bridge bind address must match an active approved private interface.")
  }
  const match = approved.find((entry) => entry.address === normalized)
  if (!match) throw new Error("Mobile bridge bind address is not active.")
  return match
}

export class PollingMobileNetworkSource implements MobileNetworkSource {
  private readonly listeners = new Set<(interfaces: MobileNetworkInterface[]) => void>()
  private timer: NodeJS.Timeout | null = null
  private signature = ""

  constructor(
    private readonly intervalMs = 2_000,
    private readonly read = listMobileNetworkInterfaces,
  ) {}

  list(): MobileNetworkInterface[] {
    return this.read()
  }

  subscribe(listener: (interfaces: MobileNetworkInterface[]) => void): () => void {
    this.listeners.add(listener)
    try {
      if (!this.timer) {
        this.signature = networkSignature(this.read())
        this.timer = setInterval(() => this.poll(), this.intervalMs)
        this.timer.unref?.()
      }
    } catch (error) {
      this.listeners.delete(listener)
      throw error
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  private poll(): void {
    const interfaces = this.read()
    const next = networkSignature(interfaces)
    if (next === this.signature) return
    this.signature = next
    for (const listener of this.listeners) listener(interfaces)
  }
}

function stripIpv6Zone(address: string): string {
  return address.split("%", 1)[0]!
}

function networkSignature(interfaces: readonly MobileNetworkInterface[]): string {
  return interfaces
    .map(
      (entry) => `${entry.name}\u0000${entry.address}\u0000${entry.family}\u0000${entry.internal}`,
    )
    .sort()
    .join("\u0001")
}
