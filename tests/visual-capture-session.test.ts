import { describe, expect, it, vi } from "vitest"
import {
  VisualCaptureSessionService,
  type VisualCaptureProvider,
} from "../src/main/lib/visual-capture/session"

const frame = Buffer.from("exact-selected-frame")

function provider(): VisualCaptureProvider {
  return {
    enumerate: vi.fn(async () => [
      { id: "screen:1", kind: "screen", label: "Display 1", displayId: "1" },
      { id: "window:7", kind: "window", label: "Editor", displayId: null },
    ]),
    capture: vi.fn(async (sourceId) => {
      if (sourceId !== "screen:1") throw new Error("protected content")
      return { bytes: frame, sourceId, scaleFactor: 2 }
    }),
    discard: vi.fn(),
  }
}

describe("visual capture session safety boundary", () => {
  it("requires visible user initiation and exact user source selection", async () => {
    const backend = provider()
    const service = new VisualCaptureSessionService(backend, () => 1_000)

    expect(() =>
      service.begin({
        actor: { kind: "user", id: "owner" },
        visibleUserInitiation: false,
        scope: { projectId: "project-a", chatId: "chat-a" },
      }),
    ).toThrow(/visible/i)

    const request = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a", chatId: "chat-a" },
    })
    await expect(service.capture(request.id)).rejects.toThrow(/select/i)
    await expect(service.listSources(request.id)).resolves.toHaveLength(2)
    expect(() =>
      service.selectSource(request.id, "screen:1", { kind: "user", id: "another-user" }),
    ).toThrow(/initiating user/i)
    service.selectSource(request.id, "screen:1", { kind: "user", id: "owner" })
    await expect(service.capture(request.id)).resolves.toMatchObject({
      bytes: frame,
      sourceId: "screen:1",
      scaleFactor: 2,
    })
    expect(backend.capture).toHaveBeenCalledWith("screen:1")
  })

  it("requires a live exact-scope approval for an agent and never lets the agent select", async () => {
    const service = new VisualCaptureSessionService(provider(), () => 5_000)
    expect(() =>
      service.begin({
        actor: { kind: "agent", id: "run-a" },
        visibleUserInitiation: false,
        scope: { projectId: "project-a", chatId: "chat-a" },
      }),
    ).toThrow(/approval/i)

    const request = service.begin({
      actor: { kind: "agent", id: "run-a" },
      visibleUserInitiation: false,
      scope: { projectId: "project-a", chatId: "chat-a" },
      approval: {
        id: "approval-a",
        actorId: "run-a",
        projectId: "project-a",
        chatId: "chat-a",
        expiresAt: 5_001,
      },
    })
    await service.listSources(request.id)
    expect(() =>
      service.selectSource(request.id, "screen:1", { kind: "agent", id: "run-a" }),
    ).toThrow(/user.*select/i)
    service.selectSource(request.id, "screen:1", { kind: "user", id: "owner" })
    await expect(service.capture(request.id)).resolves.toMatchObject({ sourceId: "screen:1" })
  })

  it("invalidates on cancel, timeout, failure, and success so no stale frame can be reused", async () => {
    let now = 10
    const backend = provider()
    const service = new VisualCaptureSessionService(backend, () => now, { timeoutMs: 100 })

    const cancelled = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a" },
    })
    await service.listSources(cancelled.id)
    service.cancel(cancelled.id)
    expect(backend.discard).toHaveBeenCalledWith(["screen:1", "window:7"])
    await expect(service.capture(cancelled.id)).rejects.toThrow(/not active/i)

    const expired = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a" },
    })
    await service.listSources(expired.id)
    service.selectSource(expired.id, "screen:1", { kind: "user", id: "owner" })
    now = 111
    await expect(service.capture(expired.id)).rejects.toThrow(/expired/i)
    expect(backend.discard).toHaveBeenCalledWith(["screen:1", "window:7"])

    now = 200
    const failed = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a" },
    })
    await service.listSources(failed.id)
    service.selectSource(failed.id, "window:7", { kind: "user", id: "owner" })
    await expect(service.capture(failed.id)).rejects.toThrow(/protected content/i)
    expect(backend.discard).toHaveBeenCalledWith(["screen:1"])
    await expect(service.capture(failed.id)).rejects.toThrow(/not active/i)

    const completed = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a" },
    })
    await service.listSources(completed.id)
    service.selectSource(completed.id, "screen:1", { kind: "user", id: "owner" })
    await service.capture(completed.id)
    await expect(service.capture(completed.id)).rejects.toThrow(/not active/i)
  })

  it("does not retain preview bytes or titles in its durable result contract", async () => {
    const service = new VisualCaptureSessionService(provider(), () => 1)
    const request = service.begin({
      actor: { kind: "user", id: "owner" },
      visibleUserInitiation: true,
      scope: { projectId: "project-a" },
    })
    const sources = await service.listSources(request.id)
    expect(sources[0]).toEqual({
      id: "screen:1",
      kind: "screen",
      label: "Display 1",
      displayId: "1",
    })
    service.selectSource(request.id, "screen:1", { kind: "user", id: "owner" })
    const result = await service.capture(request.id)
    expect(result).not.toHaveProperty("label")
    expect(result).not.toHaveProperty("preview")
  })
})
