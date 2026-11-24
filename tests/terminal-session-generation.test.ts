import { afterEach, expect, it, vi } from "vitest"
import { TerminalManager } from "../src/main/lib/terminal/manager"
import { portManager } from "../src/main/lib/terminal/port-manager"
import { TerminalReplay } from "../src/main/lib/terminal/replay"
import * as recovery from "../src/main/lib/terminal/terminal-history/recovery"
import type {
  TerminalSession,
  InternalCreateSessionParams,
  SessionResult,
} from "../src/main/lib/terminal/types"

function fixture() {
  const manager = new TerminalManager({ platform: "linux" })
  const internals = manager as unknown as {
    sessions: Map<string, TerminalSession>
    linuxProcesses: WeakMap<TerminalSession, { capture(): number[]; survivors(): number[] }>
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
  // Synthetic sessions bypass creation, including its Linux ownership registration.
  internals.linuxProcesses.set(session, { capture: () => [], survivors: () => [] })
  return { manager, internals, session }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

it("keeps an exited terminal stopped across remount and delayed cleanup until explicit restart", async () => {
  vi.useFakeTimers()
  const { manager, internals, session } = fixture()
  session.isAlive = false
  session.cols = 80
  session.rows = 24
  const flush = vi.fn(async () => undefined)
  session.replay = {
    finish: vi.fn(),
    flushRetainedOutput: flush,
    dispose: vi.fn(),
  } as unknown as TerminalReplay
  const output = { data: "final shell output", cols: 100, rows: 30 }
  vi.spyOn(recovery, "readTerminalOutput").mockReturnValue(output)
  const create = vi.spyOn(internals, "createSessionImplementation").mockResolvedValue({
    isNew: true,
    serializedState: "",
    replayEnabled: true,
  })
  internals.finishSessionExit(session, 0)
  const input = { paneId: session.paneId, initialCommands: ["must not run again"] }
  const expected = {
    isNew: false,
    replayEnabled: false,
    serializedState: output.data,
    recoveredOutput: { cols: 100, rows: 30 },
  }
  await expect(manager.createOrAttach(input, true)).resolves.toEqual(expected)
  expect(flush).toHaveBeenCalledOnce()
  expect(create).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000)
  expect(internals.sessions.has(session.paneId)).toBe(false)
  await expect(manager.createOrAttach(input, true)).resolves.toEqual(expected)
  expect(create).not.toHaveBeenCalled()
  await expect(manager.createOrAttach({ ...input, restart: true }, true)).resolves.toMatchObject({
    isNew: true,
  })
  expect(create).toHaveBeenCalledOnce()
})
