import { describe, expect, it } from "vitest"
import {
  ChatTransferCoordinator,
  type ChatTransferAuthority,
} from "../src/main/windows/chat-transfer-coordinator"
import { CHAT_TRANSFER_VERSION } from "../src/shared/chat-window-transfer"

function fixture(options?: { ttlMs?: number }) {
  let now = 1_000
  let nonce = 0
  const owners = new Map([["chat-a", "main"]])
  const canceled: string[] = []
  const authority: ChatTransferAuthority = {
    getOwner: (chatId) => owners.get(chatId) ?? null,
    compareAndTransfer: (chatId, expectedOwner, nextOwner) => {
      if (owners.get(chatId) !== expectedOwner) return false
      owners.set(chatId, nextOwner)
      return true
    },
    cancelReservation: (reservationId) => canceled.push(reservationId),
  }
  const coordinator = new ChatTransferCoordinator(authority, {
    now: () => now,
    nonce: () => `opaque-nonce-${++nonce}`,
    ttlMs: options?.ttlMs ?? 100,
  })
  return {
    coordinator,
    owners,
    canceled,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

function startMove(coordinator: ChatTransferCoordinator) {
  return coordinator.start({
    version: CHAT_TRANSFER_VERSION,
    chatId: "chat-a",
    sourceWindowId: "main",
    sourceGroupId: "group-a",
    operation: "move",
  })
}

describe("atomic cross-window Chat transfer", () => {
  it("moves ownership only after destination readiness and removes source after commit", () => {
    const { coordinator, owners } = fixture()
    const started = startMove(coordinator)
    expect(started.status).toBe("started")
    if (started.status !== "started") throw new Error("expected transfer")

    expect(
      coordinator.reserve({
        nonce: started.transfer.nonce,
        destinationWindowId: "window-2",
        destinationGroupId: "group-b",
        zone: "right",
        reservationId: "reservation-1",
      }),
    ).toMatchObject({ status: "reserved" })
    expect(owners.get("chat-a")).toBe("main")
    expect(coordinator.destinationReady(started.transfer.nonce, "window-2")).toMatchObject({
      status: "ready",
    })
    expect(coordinator.transferOwnership(started.transfer.nonce)).toMatchObject({
      status: "ownership-transferred",
    })
    expect(owners.get("chat-a")).toBe("window-2")
    expect(coordinator.commitDestination(started.transfer.nonce, "window-2")).toMatchObject({
      status: "destination-committed",
      removeSource: {
        sourceWindowId: "main",
        sourceGroupId: "group-a",
        chatId: "chat-a",
      },
    })
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toMatchObject({
      status: "completed",
    })
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toMatchObject({
      status: "completed",
    })
  })

  it("rolls back destination and source close races before destination commit", () => {
    for (const closedWindowId of ["main", "window-2"]) {
      const { coordinator, owners } = fixture()
      const started = startMove(coordinator)
      if (started.status !== "started") throw new Error("expected transfer")
      coordinator.reserve({
        nonce: started.transfer.nonce,
        destinationWindowId: "window-2",
        destinationGroupId: "group-b",
        zone: "tab",
      })
      coordinator.destinationReady(started.transfer.nonce, "window-2")
      coordinator.transferOwnership(started.transfer.nonce)

      expect(coordinator.windowUnavailable(closedWindowId)).toEqual([
        expect.objectContaining({ status: "rolled-back" }),
      ])
      expect(owners.get("chat-a")).toBe("main")
    }
  })

  it("creates a read-only copy without transferring editable ownership", () => {
    const { coordinator, owners } = fixture()
    const started = coordinator.start({
      version: CHAT_TRANSFER_VERSION,
      chatId: "chat-a",
      sourceWindowId: "main",
      sourceGroupId: "group-a",
      operation: "read-only-copy",
    })
    if (started.status !== "started") throw new Error("expected transfer")
    coordinator.reserve({
      nonce: started.transfer.nonce,
      destinationWindowId: "window-2",
      destinationGroupId: "group-b",
      zone: "tab",
    })
    coordinator.destinationReady(started.transfer.nonce, "window-2")

    expect(coordinator.transferOwnership(started.transfer.nonce)).toMatchObject({
      status: "read-only",
    })
    expect(owners.get("chat-a")).toBe("main")
    expect(coordinator.commitDestination(started.transfer.nonce, "window-2")).toMatchObject({
      status: "destination-committed",
      readOnly: true,
      removeSource: null,
    })
  })

  it("restores the source if the destination closes after its layout commit but before source removal", () => {
    const { coordinator, owners } = fixture()
    const started = startMove(coordinator)
    if (started.status !== "started") throw new Error("expected transfer")
    coordinator.reserve({
      nonce: started.transfer.nonce,
      destinationWindowId: "window-2",
      destinationGroupId: "group-b",
      zone: "tab",
    })
    coordinator.destinationReady(started.transfer.nonce, "window-2")
    coordinator.transferOwnership(started.transfer.nonce)
    coordinator.commitDestination(started.transfer.nonce, "window-2")

    expect(coordinator.windowUnavailable("window-2")).toEqual([
      { status: "rolled-back", reason: "destination-unavailable-after-commit" },
    ])
    expect(owners.get("chat-a")).toBe("main")
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toEqual({
      status: "rolled-back",
      reason: "destination-unavailable-after-commit",
    })
  })
})
