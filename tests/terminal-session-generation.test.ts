import { afterEach, expect, it, vi } from "vitest"
import { TerminalManager } from "../src/main/lib/terminal/manager"
import { portManager } from "../src/main/lib/terminal/port-manager"
import type {
  TerminalSession,
  InternalCreateSessionParams,
  SessionResult,
} from "../src/main/lib/terminal/types"

function fixture() {
  const manager = new TerminalManager({ platform: "linux" })
  const internals = manager as unknown as {
    sessions: Map<string, TerminalSession>
    finishSessionExit(session: TerminalSession, code: number): void
    handleSessionExit(
      session: TerminalSession,
      params: InternalCreateSessionParams,
      code: number,
    ): Promise<void>
    createSessionImplementation(params: InternalCreateSessionParams): Promise<SessionResult>
  }
  const session = {
    paneId: "generation-pane",
    isAlive: true,
    startTime: 0,
    usedFallback: true,
    pty: { destroy: vi.fn() },
    serializedState: "old screen",
    lastActive: 0,
  } as unknown as TerminalSession
  internals.sessions.set(session.paneId, session)
  return { manager, internals, session }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("does not remove a replacement PTY when the old exit grace timer fires", () => {
  vi.useFakeTimers()
  const { manager, internals, session } = fixture()
  const exit = vi.fn()
  manager.on(`exit:${session.paneId}`, exit)
  internals.finishSessionExit(session, 0)
  expect(exit).toHaveBeenCalledOnce()
  const replacement = { ...session, isAlive: true }
  internals.sessions.set(session.paneId, replacement)
  vi.advanceTimersByTime(5000)
  expect(internals.sessions.get(session.paneId)).toBe(replacement)
})

it("ignores a late old PTY exit without unregistering or announcing the new session", async () => {
  const { manager, internals, session } = fixture()
  const replacement = { ...session, isAlive: true }
  internals.sessions.set(session.paneId, replacement)
  const exit = vi.fn()
  const unregister = vi.spyOn(portManager, "unregisterSession")
  manager.on(`exit:${session.paneId}`, exit)
  await internals.handleSessionExit(session, { paneId: session.paneId }, 1)
  expect(exit).not.toHaveBeenCalled()
  expect(unregister).not.toHaveBeenCalled()
  expect(replacement.isAlive).toBe(true)
  expect(internals.sessions.get(session.paneId)).toBe(replacement)
})

it("still announces and expires a failed fallback session", async () => {
  vi.useFakeTimers()
  const { manager, internals, session } = fixture()
  session.startTime = Date.now()
  session.usedFallback = false
  vi.spyOn(internals, "createSessionImplementation").mockRejectedValue(
    new Error("fixture fallback failed"),
  )
  const exit = vi.fn()
  manager.on(`exit:${session.paneId}`, exit)
  await internals.handleSessionExit(session, { paneId: session.paneId }, 1)
  expect(exit).toHaveBeenCalledWith(1, undefined)
  vi.advanceTimersByTime(5000)
  expect(internals.sessions.has(session.paneId)).toBe(false)
})

it("accepts an intentionally empty detach snapshot and preserves it when omitted", () => {
  const { manager, session } = fixture()
  manager.detach({ paneId: session.paneId, serializedState: "" })
  expect(session.serializedState).toBe("")
  manager.detach({ paneId: session.paneId })
  expect(session.serializedState).toBe("")
})

it("shares an in-flight fallback with a concurrent renderer restart", async () => {
  const { manager, internals, session } = fixture()
  session.startTime = Date.now()
  session.usedFallback = false
  let resolveFallback!: (result: SessionResult) => void
  const create = vi.spyOn(internals, "createSessionImplementation").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFallback = resolve
      }),
  )
  const exited = internals.handleSessionExit(session, { paneId: session.paneId }, 1)
  const attached = manager.createOrAttach({ paneId: session.paneId })
  expect(create).toHaveBeenCalledOnce()
  resolveFallback({ isNew: true, serializedState: "fallback" })
  await expect(attached).resolves.toEqual({ isNew: true, serializedState: "fallback" })
  await exited
})
