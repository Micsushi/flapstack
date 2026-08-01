import { describe, expect, it } from "vitest"
import {
  ChatTransferCoordinator,
  type ChatTransferAuthority,
} from "../src/main/windows/chat-transfer-coordinator"
import {
  CHAT_TRANSFER_VERSION,
  chatTransferDestinationReadySchema,
  chatTransferReserveSchema,
  chatTransferStartSchema,
  toChatTransferWindowDestinations,
} from "../src/shared/chat-window-transfer"

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
  it("uses strict opaque IPC schemas without transcript or credential fields", () => {
    const start = {
      version: CHAT_TRANSFER_VERSION,
      chatId: "chat-a",
      sourceWindowId: "main",
      sourceGroupId: "group-a",
      operation: "move" as const,
    }
    expect(chatTransferStartSchema.safeParse(start).success).toBe(true)
    expect(chatTransferStartSchema.safeParse({ ...start, transcript: "private" }).success).toBe(
      false,
    )
    expect(chatTransferStartSchema.safeParse({ ...start, apiKey: "secret" }).success).toBe(false)
    expect(
      chatTransferReserveSchema.safeParse({
        version: CHAT_TRANSFER_VERSION,
        nonce: "opaque-nonce-1",
        destinationWindowId: "window-2",
        destinationGroupId: "group-b",
        zone: "right",
        reservationId: "workbench-reservation-1",
      }).success,
    ).toBe(true)
    expect(
      chatTransferDestinationReadySchema.safeParse({
        version: CHAT_TRANSFER_VERSION,
        nonce: "opaque-nonce-1",
        destinationWindowId: "window-2",
      }).success,
    ).toBe(true)
  })

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

  it.each(["destination-ready", "ownership", "destination-commit"] as const)(
    "rolls ownership and reservations back when %s fails before commit",
    (phase) => {
      const { coordinator, owners, canceled } = fixture()
      const started = startMove(coordinator)
      if (started.status !== "started") throw new Error("expected transfer")
      coordinator.reserve({
        nonce: started.transfer.nonce,
        destinationWindowId: "window-2",
        destinationGroupId: "group-b",
        zone: "tab",
        reservationId: "reservation-1",
      })
      if (phase !== "destination-ready") {
        coordinator.destinationReady(started.transfer.nonce, "window-2")
      }
      if (phase === "destination-commit") {
        coordinator.transferOwnership(started.transfer.nonce)
        expect(owners.get("chat-a")).toBe("window-2")
      }

      expect(coordinator.fail(started.transfer.nonce, phase)).toMatchObject({
        status: "rolled-back",
      })
      expect(owners.get("chat-a")).toBe("main")
      expect(canceled).toEqual(["reservation-1"])
    },
  )

  it("expires, rejects stale nonces and replay, and restores a precommit ownership claim", () => {
    const { coordinator, owners, advance } = fixture({ ttlMs: 25 })
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
    advance(26)

    expect(coordinator.commitDestination(started.transfer.nonce, "window-2")).toMatchObject({
      status: "expired",
    })
    expect(owners.get("chat-a")).toBe("main")
    expect(coordinator.destinationReady("unknown-nonce", "window-2")).toMatchObject({
      status: "not-found",
    })
    expect(coordinator.transferOwnership(started.transfer.nonce)).toMatchObject({
      status: "expired",
    })
  })

  it("rejects ownership CAS conflicts without changing either owner", () => {
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
    owners.set("chat-a", "window-3")

    expect(coordinator.transferOwnership(started.transfer.nonce)).toMatchObject({
      status: "ownership-conflict",
      ownerWindowId: "window-3",
    })
    expect(owners.get("chat-a")).toBe("window-3")
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

  it("requires the source to own a Chat before either move or read-only copy starts", () => {
    const { coordinator, owners } = fixture()
    owners.set("chat-a", "window-3")

    expect(
      coordinator.start({
        version: CHAT_TRANSFER_VERSION,
        chatId: "chat-a",
        sourceWindowId: "main",
        sourceGroupId: "group-a",
        operation: "read-only-copy",
      }),
    ).toEqual({ status: "ownership-conflict", ownerWindowId: "window-3" })
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

  it("finishes without replay or leakage if the source closes after destination commit", () => {
    const { coordinator, owners, advance } = fixture({ ttlMs: 25 })
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

    expect(coordinator.windowUnavailable("main")).toEqual([{ status: "completed" }])
    expect(owners.get("chat-a")).toBe("window-2")
    advance(100)
    coordinator.sweepExpired()
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toEqual({
      status: "completed",
    })
  })

  it("finishes a committed move after a finite acknowledgement recovery window", () => {
    const { coordinator, owners, advance } = fixture({ ttlMs: 25 })
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

    advance(26)
    coordinator.sweepExpired()

    expect(owners.get("chat-a")).toBe("window-2")
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toEqual({
      status: "completed",
    })
  })

  it("finishes a read-only copy at destination commit because no source removal is required", () => {
    const { coordinator } = fixture()
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
    coordinator.transferOwnership(started.transfer.nonce)
    coordinator.commitDestination(started.transfer.nonce, "window-2")

    expect(coordinator.getOffer(started.transfer.nonce)).toBeNull()
    expect(coordinator.commitSourceRemoval(started.transfer.nonce, "main")).toEqual({
      status: "completed",
    })
  })

  it("bounds expired and replay tombstones under sustained stale transfer traffic", () => {
    const { coordinator, advance } = fixture({ ttlMs: 1 })
    let firstNonce = ""
    let latestNonce = ""

    for (let index = 0; index < 300; index += 1) {
      const started = startMove(coordinator)
      if (started.status !== "started") throw new Error("expected transfer")
      firstNonce ||= started.transfer.nonce
      latestNonce = started.transfer.nonce
      advance(2)
      coordinator.sweepExpired()
    }

    expect(coordinator.transferOwnership(firstNonce)).toEqual({ status: "not-found" })
    expect(coordinator.transferOwnership(latestNonce)).toEqual({ status: "expired" })
  })

  it("offers exact existing-window move, add-as-tab, focus, and cancel choices at the cap", () => {
    expect(
      toChatTransferWindowDestinations([
        {
          stableId: "main",
          label: "Main window",
          state: "available",
        },
        {
          stableId: "window-2",
          label: "Window 2",
          state: "recovering",
        },
      ]),
    ).toEqual([
      {
        stableId: "main",
        label: "Main window",
        state: "available",
        actions: [
          "split-left",
          "split-right",
          "split-top",
          "split-bottom",
          "add-as-tab",
          "focus",
          "cancel",
        ],
      },
      {
        stableId: "window-2",
        label: "Window 2",
        state: "recovering",
        actions: ["focus", "cancel"],
      },
    ])
  })
})
