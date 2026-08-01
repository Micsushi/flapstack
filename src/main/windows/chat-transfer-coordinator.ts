import {
  chatTransferReserveSchema,
  chatTransferStartSchema,
  type ChatTransferDestination,
  type ChatTransferResult,
  type ChatTransferStart,
  type ChatTransferStartResult,
  type ChatTransferToken,
} from "../../shared/chat-window-transfer"
import { randomUUID } from "node:crypto"

const MAX_TRANSFER_TOMBSTONES = 256

export interface ChatTransferAuthority {
  getOwner(chatId: string): string | null
  compareAndTransfer(chatId: string, expectedOwner: string, nextOwner: string): boolean
  cancelReservation(reservationId: string): void
}

type Phase = "started" | "reserved" | "ready" | "ownership" | "destination-committed"

interface TransferRecord {
  transfer: ChatTransferToken
  phase: Phase
  destination: ChatTransferDestination | null
  reservationId: string | null
  ownershipMoved: boolean
}

type TerminalTransferResult =
  { status: "completed" } | { status: "rolled-back"; reason: string } | { status: "expired" }

export class ChatTransferCoordinator {
  private readonly active = new Map<string, TransferRecord>()
  private readonly terminalOutcomes = new Map<string, TerminalTransferResult>()
  private readonly now: () => number
  private readonly nonce: () => string
  private readonly ttlMs: number

  constructor(
    private readonly authority: ChatTransferAuthority,
    options?: { now?: () => number; nonce?: () => string; ttlMs?: number },
  ) {
    this.now = options?.now ?? Date.now
    this.nonce = options?.nonce ?? randomUUID
    this.ttlMs = options?.ttlMs ?? 15_000
  }

  start(raw: ChatTransferStart): ChatTransferStartResult {
    this.expire()
    const input = chatTransferStartSchema.parse(raw)
    if (this.authority.getOwner(input.chatId) !== input.sourceWindowId) {
      return {
        status: "ownership-conflict",
        ownerWindowId: this.authority.getOwner(input.chatId),
      }
    }
    let nonce = this.nonce()
    while (this.active.has(nonce) || this.terminalOutcomes.has(nonce)) nonce = this.nonce()
    const transfer: ChatTransferToken = {
      ...input,
      nonce,
      expiresAt: this.now() + this.ttlMs,
    }
    this.active.set(nonce, {
      transfer,
      phase: "started",
      destination: null,
      reservationId: null,
      ownershipMoved: false,
    })
    return { status: "started", transfer }
  }

  reserve(
    raw: Omit<Parameters<typeof chatTransferReserveSchema.parse>[0], "version">,
  ): ChatTransferResult {
    this.expire()
    const input = chatTransferReserveSchema.parse(raw)
    const found = this.lookup(input.nonce)
    if ("status" in found) return found
    if (found.phase !== "started") return { status: "invalid-phase" }
    found.destination = {
      windowId: input.destinationWindowId,
      groupId: input.destinationGroupId,
      zone: input.zone,
    }
    found.reservationId = input.reservationId ?? null
    found.phase = "reserved"
    return { status: "reserved", destination: found.destination }
  }

  destinationReady(nonce: string, destinationWindowId: string): ChatTransferResult {
    this.expire()
    const found = this.lookup(nonce)
    if ("status" in found) return found
    if (found.phase !== "reserved" || !found.destination) return { status: "invalid-phase" }
    if (found.destination.windowId !== destinationWindowId) return { status: "wrong-window" }
    found.phase = "ready"
    return { status: "ready", destination: found.destination }
  }

  transferOwnership(nonce: string): ChatTransferResult {
    this.expire()
    const found = this.lookup(nonce)
    if ("status" in found) return found
    if (found.phase !== "ready" || !found.destination) return { status: "invalid-phase" }
    if (found.transfer.operation === "read-only-copy") {
      found.phase = "ownership"
      return { status: "read-only" }
    }
    const moved = this.authority.compareAndTransfer(
      found.transfer.chatId,
      found.transfer.sourceWindowId,
      found.destination.windowId,
    )
    if (!moved) {
      return {
        status: "ownership-conflict",
        ownerWindowId: this.authority.getOwner(found.transfer.chatId),
      }
    }
    found.ownershipMoved = true
    found.phase = "ownership"
    return { status: "ownership-transferred" }
  }

  commitDestination(nonce: string, destinationWindowId: string): ChatTransferResult {
    this.expire()
    const found = this.lookup(nonce)
    if ("status" in found) return found
    if (found.phase !== "ownership" || !found.destination) return { status: "invalid-phase" }
    if (found.destination.windowId !== destinationWindowId) return { status: "wrong-window" }
    found.phase = "destination-committed"
    this.cancelReservation(found)
    const result: ChatTransferResult = {
      status: "destination-committed",
      readOnly: found.transfer.operation === "read-only-copy",
      removeSource:
        found.transfer.operation === "move"
          ? {
              sourceWindowId: found.transfer.sourceWindowId,
              sourceGroupId: found.transfer.sourceGroupId,
              chatId: found.transfer.chatId,
            }
          : null,
    }
    if (found.transfer.operation === "read-only-copy") {
      this.finish(nonce, found, { status: "completed" })
    }
    return result
  }

  commitSourceRemoval(nonce: string, sourceWindowId: string): ChatTransferResult {
    this.expire()
    const found = this.lookup(nonce)
    if ("status" in found) return found
    if (found.phase !== "destination-committed") return { status: "invalid-phase" }
    if (found.transfer.sourceWindowId !== sourceWindowId) return { status: "wrong-window" }
    this.finish(nonce, found, { status: "completed" })
    return { status: "completed" }
  }

  fail(nonce: string, reason: string): ChatTransferResult {
    const found = this.active.get(nonce)
    if (!found) return this.terminalOutcomes.get(nonce) ?? { status: "not-found" }
    if (found.phase === "destination-committed") return { status: "invalid-phase" }
    return this.rollback(nonce, found, reason)
  }

  windowUnavailable(windowId: string): ChatTransferResult[] {
    const results: ChatTransferResult[] = []
    for (const [nonce, found] of this.active) {
      if (found.phase === "destination-committed" && found.destination?.windowId === windowId) {
        results.push(this.rollback(nonce, found, "destination-unavailable-after-commit"))
        continue
      }
      if (found.phase === "destination-committed" && found.transfer.sourceWindowId === windowId) {
        this.finish(nonce, found, { status: "completed" })
        results.push({ status: "completed" })
        continue
      }
      if (found.phase === "destination-committed") continue
      if (found.transfer.sourceWindowId === windowId || found.destination?.windowId === windowId) {
        results.push(this.rollback(nonce, found, "window-unavailable"))
      }
    }
    return results
  }

  getOffer(nonce: string): {
    transfer: ChatTransferToken
    destination: ChatTransferDestination
  } | null {
    const found = this.active.get(nonce)
    return found?.destination ? { transfer: found.transfer, destination: found.destination } : null
  }

  isParticipant(nonce: string, windowId: string): boolean {
    const found = this.active.get(nonce)
    return Boolean(
      found &&
      (found.transfer.sourceWindowId === windowId || found.destination?.windowId === windowId),
    )
  }

  sweepExpired(): void {
    this.expire()
  }

  private lookup(nonce: string): TransferRecord | TerminalTransferResult | { status: "not-found" } {
    const found = this.active.get(nonce)
    if (found) return found
    return this.terminalOutcomes.get(nonce) ?? { status: "not-found" }
  }

  private expire(): void {
    const now = this.now()
    for (const [nonce, found] of this.active) {
      if (found.transfer.expiresAt > now) continue
      if (found.phase === "destination-committed") {
        this.finish(nonce, found, { status: "completed" })
      } else this.rollback(nonce, found, "expired")
    }
  }

  private rollback(nonce: string, found: TransferRecord, reason: string): ChatTransferResult {
    if (found.ownershipMoved && found.destination) {
      this.authority.compareAndTransfer(
        found.transfer.chatId,
        found.destination.windowId,
        found.transfer.sourceWindowId,
      )
    }
    this.cancelReservation(found)
    const result: TerminalTransferResult =
      reason === "expired" ? { status: "expired" } : { status: "rolled-back", reason }
    this.finish(nonce, found, result)
    return result
  }

  private cancelReservation(found: TransferRecord): void {
    if (!found.reservationId) return
    this.authority.cancelReservation(found.reservationId)
    found.reservationId = null
  }

  private finish(
    nonce: string,
    found: TransferRecord,
    terminalOutcome: TerminalTransferResult,
  ): void {
    this.cancelReservation(found)
    this.active.delete(nonce)
    this.terminalOutcomes.set(nonce, terminalOutcome)
    this.trimTerminalOutcomes()
  }

  private trimTerminalOutcomes(): void {
    while (this.terminalOutcomes.size > MAX_TRANSFER_TOMBSTONES) {
      const oldest = this.terminalOutcomes.keys().next().value
      if (!oldest) break
      this.terminalOutcomes.delete(oldest)
    }
  }
}
