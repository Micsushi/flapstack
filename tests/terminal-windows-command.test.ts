import { describe, expect, it, vi } from "vitest"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { TerminalManager } from "../src/main/lib/terminal/manager"
import {
  captureTerminalPtyOwnedProcesses,
  isTerminalProcessAlive,
  formatInitialCommands,
  releaseWindowsPtyConoutWorker,
  terminalPtyOwnedProcessIds,
  terminalPtyPlatformOptions,
  terminalShellArgs,
  terminateUnreadyWindowsPty,
  waitForWindowsPtyReady,
  waitForTerminalProcessesToExit,
} from "../src/main/lib/terminal/session"
import type {
  InternalCreateSessionParams,
  SessionResult,
  TerminalSession,
} from "../src/main/lib/terminal/types"
import { terminateMatchingWindowsProcesses } from "../src/main/lib/terminal/windows-process-identity"

describe("terminal initial command formatting", () => {
  it("uses PowerShell 5.1-compatible conditional sequencing", () => {
    expect(
      formatInitialCommands("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", [
        "first",
        "second",
        "third",
      ]),
    ).toBe("first; if ($?) { second; if ($?) { third } }\n")
  })

  it("retains command-shell conditional sequencing", () => {
    expect(formatInitialCommands("C:\\Windows\\System32\\cmd.exe", ["first", "second"])).toBe(
      "first && second\n",
    )
  })

  it("uses the bundled winpty cancellation path under Windows Electron", () => {
    expect(terminalPtyPlatformOptions("win32")).toEqual({ useConpty: false })
    expect(terminalPtyPlatformOptions("darwin")).toEqual({})
    expect(terminalPtyPlatformOptions("linux")).toEqual({})
  })

  it("places a unique performance owner token in the Windows shell command line", () => {
    expect(terminalShellArgs("cmd.exe", "owner-token")).toEqual([
      "/d",
      "/q",
      "/k",
      'set "FLAPSTACK_PTY_OWNER=owner-token"',
    ])
    expect(terminalShellArgs("cmd.exe")).toEqual([])
  })

  it("terminates only the live Windows process whose command line carries the owner token", async () => {
    if (process.platform !== "win32") return
    const ownershipToken = `flapstack-test-${randomUUID()}`
    const child = spawn(
      process.env.COMSPEC ?? "cmd.exe",
      terminalShellArgs("cmd.exe", ownershipToken),
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    )
    if (!child.pid) throw new Error("Windows token identity test did not receive a child PID.")
    const childExit = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(
        terminateMatchingWindowsProcesses([
          {
            processId: child.pid,
            ownershipToken: `${ownershipToken}-wrong`,
            executableName: "cmd.exe",
          },
        ]),
      ).resolves.toEqual([])
      await expect(
        terminateMatchingWindowsProcesses([
          {
            processId: child.pid,
            ownershipToken,
            executableName: "powershell.exe",
          },
        ]),
      ).resolves.toEqual([])
      await expect(
        terminateMatchingWindowsProcesses([
          { processId: child.pid, ownershipToken, executableName: "cmd.exe" },
        ]),
      ).resolves.toEqual([child.pid])
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Token-owned cmd.exe did not exit.")),
          2_000,
        )
        void childExit.then(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    } finally {
      if (child.exitCode === null) child.kill()
    }
  })

  it("releases the guarded node-pty 1.1.0 Windows conout worker", async () => {
    let disposeReceiver: unknown
    let terminationCount = 0
    const destroyed: string[] = []
    const worker = {
      threadId: 1,
      async terminate(this: unknown) {
        terminationCount += 1
        return 0
      },
    }
    const connection = {
      _worker: worker,
      dispose(this: unknown) {
        disposeReceiver = this
        worker.threadId = -1
      },
    }
    const ptyProcess = {
      kill() {},
      onExit() {},
      _agent: {
        _useConpty: false,
        _inSocket: { destroy: () => destroyed.push("input") },
        _outSocket: { destroy: () => destroyed.push("output") },
        _conoutSocketWorker: connection,
      },
    }

    await expect(releaseWindowsPtyConoutWorker(ptyProcess, "win32")).resolves.toBe(true)
    await expect(releaseWindowsPtyConoutWorker(ptyProcess, "win32")).resolves.toBe(true)
    expect(disposeReceiver).toBe(connection)
    expect(terminationCount).toBe(0)
    expect(destroyed).toEqual(["input", "output"])
  })

  it("waits for Windows PTY readiness before allowing performance teardown", async () => {
    const ptyProcess = { _isReady: false }
    const wait = vi.fn(async () => {
      ptyProcess._isReady = true
    })

    await expect(
      waitForWindowsPtyReady(ptyProcess, "win32", { maximumAttempts: 3, wait }),
    ).resolves.toBe(true)
    expect(wait).toHaveBeenCalledOnce()
    await expect(
      waitForWindowsPtyReady({ _isReady: false }, "win32", {
        maximumAttempts: 1,
        wait: vi.fn(),
      }),
    ).resolves.toBe(false)
    await expect(waitForWindowsPtyReady(ptyProcess, "linux")).resolves.toBe(true)
  })

  it("stops the conout worker before terminating a winpty session that never became ready", async () => {
    const events: string[] = []
    const worker = {
      threadId: 1,
      async terminate() {
        events.push("terminate-worker")
        worker.threadId = -1
        return 0
      },
    }
    const ptyProcess = {
      _isReady: false,
      kill: vi.fn(),
      onExit: vi.fn(),
      _agent: {
        _useConpty: false,
        _pid: 301,
        _innerPid: 302,
        _inSocket: { destroy: () => events.push("destroy-input") },
        _outSocket: { destroy: () => events.push("destroy-output") },
        _conoutSocketWorker: {
          dispose: () => events.push("dispose-worker"),
          _worker: worker,
        },
        _ptyNative: {
          getProcessList: vi.fn(() => [301, 302]),
          kill: vi.fn(),
        },
        kill: () => events.push("kill-agent"),
      },
    }

    await expect(terminateUnreadyWindowsPty(ptyProcess, "win32")).resolves.toBe(true)
    expect(events).toEqual([
      "dispose-worker",
      "destroy-input",
      "destroy-output",
      "terminate-worker",
      "kill-agent",
    ])
    expect(ptyProcess.kill).not.toHaveBeenCalled()
  })

  it("never touches a ConPTY worker", async () => {
    const dispose = vi.fn()
    const terminate = vi.fn()
    const destroy = vi.fn()

    await expect(
      releaseWindowsPtyConoutWorker(
        {
          kill() {},
          onExit() {},
          _agent: {
            _useConpty: true,
            _inSocket: { destroy },
            _outSocket: { destroy },
            _conoutSocketWorker: {
              dispose,
              _worker: { threadId: 1, terminate },
            },
          },
        },
        "win32",
      ),
    ).resolves.toBe(false)
    expect(dispose).not.toHaveBeenCalled()
    expect(terminate).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
  })

  it("uses a delayed fallback when winpty disposal does not settle and never throws", async () => {
    const calls: string[] = []
    const ptyProcess = {
      kill() {},
      onExit() {},
      _agent: {
        _useConpty: false,
        _inSocket: { destroy: () => calls.push("destroy-input") },
        _outSocket: { destroy: () => calls.push("destroy-output") },
        _conoutSocketWorker: {
          dispose: () => calls.push("dispose"),
          _worker: {
            threadId: 1,
            terminate: async () => {
              calls.push("terminate")
              throw new Error("synthetic termination failure")
            },
          },
        },
      },
    }

    await expect(
      releaseWindowsPtyConoutWorker(ptyProcess, "win32", {
        maximumAttempts: 2,
        wait: async () => {
          calls.push("wait")
        },
      }),
    ).resolves.toBe(false)
    expect(calls).toEqual(["dispose", "wait", "destroy-input", "destroy-output", "terminate"])
  })

  it("does not touch live resources when the node-pty private shape or platform differs", async () => {
    const terminate = () => Promise.resolve(0)

    await expect(
      releaseWindowsPtyConoutWorker(
        {
          kill() {},
          onExit() {},
          _agent: {
            _useConpty: false,
            _conoutSocketWorker: {
              dispose() {},
              _worker: { threadId: 1, terminate },
            },
          },
        },
        "linux",
      ),
    ).resolves.toBe(false)
    await expect(
      releaseWindowsPtyConoutWorker(
        {
          kill() {},
          onExit() {},
          _agent: {
            _useConpty: false,
            _conoutSocketWorker: { dispose() {}, terminate },
          },
        },
        "win32",
      ),
    ).resolves.toBe(false)
  })

  it("captures the public shell and guarded winpty-owned process ids before teardown", () => {
    const getProcessList = vi.fn(() => [103, 104, 104])
    expect(
      terminalPtyOwnedProcessIds(
        {
          pid: 101,
          _agent: {
            _useConpty: false,
            _pid: 102,
            _innerPid: 103,
            _ptyNative: { getProcessList },
          },
        },
        "win32",
      ),
    ).toEqual([101, 102, 103, 104])
    expect(getProcessList).toHaveBeenCalledWith(102)
    expect(
      captureTerminalPtyOwnedProcesses(
        {
          pid: 101,
          _agent: {
            _useConpty: false,
            _pid: 102,
            _innerPid: 103,
            _ptyNative: { getProcessList },
          },
        },
        "win32",
      ),
    ).toMatchObject({ complete: true, reason: null })

    expect(
      terminalPtyOwnedProcessIds(
        {
          pid: 201,
          _agent: {
            _useConpty: true,
            _pid: 202,
            _innerPid: 203,
            _ptyNative: { getProcessList },
          },
        },
        "win32",
      ),
    ).toEqual([201])
  })

  it("marks partial or failed winpty ownership evidence incomplete", () => {
    expect(captureTerminalPtyOwnedProcesses({ pid: 211 }, "win32")).toMatchObject({
      processIds: [211],
      complete: false,
      reason: expect.stringMatching(/agent ownership/i),
    })
    expect(
      captureTerminalPtyOwnedProcesses(
        {
          pid: 221,
          _agent: {
            _useConpty: false,
            _pid: 222,
            _innerPid: 221,
            _ptyNative: {
              getProcessList() {
                throw new Error("synthetic enumeration failure")
              },
            },
          },
        },
        "win32",
      ),
    ).toMatchObject({
      complete: false,
      reason: expect.stringMatching(/could not be captured/i),
    })
    expect(
      captureTerminalPtyOwnedProcesses(
        {
          pid: 231,
          _agent: {
            _useConpty: false,
            _pid: 232,
            _innerPid: 231,
            _ptyNative: { getProcessList: () => "not-an-array" },
          },
        },
        "win32",
      ),
    ).toMatchObject({
      complete: false,
      reason: expect.stringMatching(/not an array/i),
    })
  })

  it("waits for exact owned pids and ignores unrelated process resources", async () => {
    const observations = new Map([
      [301, [true, false]],
      [302, [false]],
    ])
    let waits = 0

    await expect(
      waitForTerminalProcessesToExit([301, 302], {
        maximumAttempts: 3,
        isAlive: (pid) => observations.get(pid)?.shift() ?? false,
        wait: async () => {
          waits += 1
        },
      }),
    ).resolves.toEqual([])
    expect(waits).toBe(1)
  })

  it("reports a permanently surviving owned pid after the bounded wait", async () => {
    let waits = 0
    await expect(
      waitForTerminalProcessesToExit([401], {
        maximumAttempts: 3,
        isAlive: () => true,
        wait: async () => {
          waits += 1
        },
      }),
    ).resolves.toEqual([401])
    expect(waits).toBe(2)
  })

  it("uses the default liveness probe without leaking Array.filter callback arguments", async () => {
    await expect(
      waitForTerminalProcessesToExit([2_000_000_001], { maximumAttempts: 1 }),
    ).resolves.toEqual([])
  })

  it("treats ESRCH as exited and EPERM as still alive", () => {
    expect(
      isTerminalProcessAlive(501, () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" })
      }),
    ).toBe(false)
    expect(
      isTerminalProcessAlive(502, () => {
        throw Object.assign(new Error("denied"), { code: "EPERM" })
      }),
    ).toBe(true)
    expect(isTerminalProcessAlive(2_000_000_001)).toBe(false)
  })

  it("keeps shutdown sticky and drains a crash fallback that already started", async () => {
    const manager = new TerminalManager()
    const internals = manager as unknown as {
      createSessionImplementation(params: InternalCreateSessionParams): Promise<SessionResult>
      sessions: Map<string, TerminalSession>
      setupExitHandler(session: TerminalSession, params: InternalCreateSessionParams): void
    }
    let releaseFallback: ((result: SessionResult) => void) | undefined
    const createSessionImplementation = vi
      .spyOn(internals, "createSessionImplementation")
      .mockReturnValue(
        new Promise((resolve) => {
          releaseFallback = resolve
        }),
      )
    let exitListener: ((event: { exitCode: number; signal: number }) => void) | undefined
    const worker = { threadId: 1, terminate: async () => 0 }
    const session = {
      pty: {
        kill() {},
        onExit(listener: (event: { exitCode: number; signal: number }) => void) {
          exitListener = listener
          return { dispose() {} }
        },
        _agent: {
          _useConpty: false,
          _conoutSocketWorker: {
            dispose() {
              worker.threadId = -1
            },
            _worker: worker,
          },
        },
      },
      paneId: "crash-race",
      workspaceId: "test",
      scopeKey: "test",
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      lastActive: Date.now(),
      isAlive: true,
      shell: "broken-shell",
      startTime: Date.now(),
      usedFallback: false,
    } as unknown as TerminalSession
    internals.sessions.set(session.paneId, session)
    internals.setupExitHandler(session, {
      paneId: session.paneId,
      workspaceId: session.workspaceId,
    })

    exitListener?.({ exitCode: 1, signal: 0 })
    expect(createSessionImplementation).toHaveBeenCalledOnce()
    let cleanupSettled = false
    const cleanup = manager.cleanup().then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()
    expect(cleanupSettled).toBe(false)
    releaseFallback?.({ isNew: true, serializedState: "" })
    await cleanup

    expect(internals.sessions.size).toBe(0)
    await expect(
      manager.createPerformanceTestControl({
        paneId: "after-cleanup",
        rootPath: process.cwd(),
      }),
    ).rejects.toThrow("shutting down")
  })

  it("keeps cleanup pending until an in-flight session creation settles", async () => {
    const manager = new TerminalManager()
    const internals = manager as unknown as {
      createSessionImplementation(params: InternalCreateSessionParams): Promise<SessionResult>
    }
    let releaseCreation: ((result: SessionResult) => void) | undefined
    vi.spyOn(internals, "createSessionImplementation").mockReturnValue(
      new Promise((resolve) => {
        releaseCreation = resolve
      }),
    )

    const creation = manager.createPerformanceTestControl({
      paneId: "deferred-create",
      rootPath: process.cwd(),
    })
    let cleanupSettled = false
    const cleanup = manager.cleanup().then(() => {
      cleanupSettled = true
    })
    await Promise.resolve()

    expect(cleanupSettled).toBe(false)
    releaseCreation?.({ isNew: true, serializedState: "" })
    await expect(creation).resolves.toEqual({ isNew: true, serializedState: "" })
    await cleanup
    expect(cleanupSettled).toBe(true)
  })

  it("includes a late unstored session in final owned-process evidence", async () => {
    const waitForOwnedProcesses = vi
      .fn<(processIds: readonly number[]) => Promise<number[]>>()
      .mockResolvedValueOnce([701])
      .mockResolvedValueOnce([])
    const identity = {
      processId: 701,
      ownershipToken: "late-owner-token",
      executableName: "test-shell",
    }
    const terminateMatchingOwnedProcesses = vi.fn(async () => [701])
    const manager = new TerminalManager({
      platform: "win32",
      waitForOwnedProcesses,
      terminateMatchingOwnedProcesses,
    })
    const internals = manager as unknown as {
      createSessionImplementation(params: InternalCreateSessionParams): Promise<SessionResult>
      releaseUnstoredSession(session: TerminalSession): Promise<void>
    }
    let finishCreation: (() => void) | undefined
    const creationGate = new Promise<void>((resolve) => {
      finishCreation = resolve
    })
    const { session } = fakeWindowsSession({
      paneId: "late-untracked-session",
      workspaceId: "late-workspace",
      onDispose: () => undefined,
    })
    Object.assign(session.pty as unknown as Record<string, unknown>, { pid: 701 })
    session.performanceOwnershipToken = identity.ownershipToken
    vi.spyOn(internals, "createSessionImplementation").mockImplementation(async () => {
      await creationGate
      await internals.releaseUnstoredSession(session)
      throw new Error("Terminal manager is shutting down.")
    })

    const creation = manager.createPerformanceTestControl({
      paneId: session.paneId,
      workspaceId: session.workspaceId,
      rootPath: process.cwd(),
    })
    const cleanup = manager.cleanupWithResult()
    finishCreation?.()

    await expect(creation).rejects.toThrow("shutting down")
    await expect(cleanup).resolves.toEqual({
      ownedProcessIds: [701],
      survivingProcessIds: [],
      ownershipComplete: false,
      ownershipIssues: expect.arrayContaining([expect.stringMatching(/late-untracked-session/)]),
    })
    expect(terminateMatchingOwnedProcesses).toHaveBeenCalledWith([identity])
    expect(waitForOwnedProcesses).toHaveBeenCalledTimes(2)
  })

  it("finalizes normal exit without waiting while cleanup awaits the shared release", async () => {
    vi.useFakeTimers()
    try {
      const manager = new TerminalManager({ platform: "win32" })
      const internals = manager as unknown as {
        setupExitHandler(session: TerminalSession, params: InternalCreateSessionParams): void
      }
      const events: string[] = []
      let exitListener: ((event: { exitCode: number; signal: number }) => void) | undefined
      const worker = {
        threadId: 1,
        async terminate() {
          events.push("terminate")
          worker.threadId = -1
          return 0
        },
      }
      const session = fakeWindowsSession({
        paneId: "nonblocking-exit",
        workspaceId: "exit-workspace",
        onDispose: () => events.push("dispose"),
      }).session
      Object.assign(session.pty as unknown as Record<string, unknown>, {
        onExit(listener: (event: { exitCode: number; signal: number }) => void) {
          exitListener = listener
          return { dispose() {} }
        },
        _agent: {
          _useConpty: false,
          _inSocket: { destroy: () => events.push("destroy-input") },
          _outSocket: { destroy: () => events.push("destroy-output") },
          _conoutSocketWorker: {
            dispose: () => events.push("dispose"),
            _worker: worker,
          },
        },
      })
      managerSessions(manager).set(session.paneId, session)
      manager.on(`exit:${session.paneId}`, () => events.push("exit"))
      internals.setupExitHandler(session, {
        paneId: session.paneId,
        workspaceId: session.workspaceId,
      })

      exitListener?.({ exitCode: 0, signal: 0 })
      expect(events).toEqual(["dispose", "exit"])

      let cleanupSettled = false
      const cleanup = manager.cleanup().then(() => {
        cleanupSettled = true
        events.push("cleanup")
      })
      await Promise.resolve()
      expect(cleanupSettled).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      await cleanup

      expect(events).toEqual([
        "dispose",
        "exit",
        "destroy-input",
        "destroy-output",
        "terminate",
        "cleanup",
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("releases a no-exit winpty session before forced workspace cleanup returns", async () => {
    vi.useFakeTimers()
    try {
      const manager = new TerminalManager({ platform: "win32" })
      const events: string[] = []
      const { session } = fakeWindowsSession({
        paneId: "no-exit",
        workspaceId: "forced-workspace",
        onDispose: () => events.push("dispose"),
        onKill: (signal) => events.push(signal ?? "SIGTERM"),
      })
      managerSessions(manager).set(session.paneId, session)

      const result = manager.killByWorkspaceId(session.workspaceId).then((value) => {
        events.push("returned")
        return value
      })
      await vi.advanceTimersByTimeAsync(2_500)

      await expect(result).resolves.toEqual({ killed: 0, failed: 1 })
      expect(events).toEqual(["SIGTERM", "SIGKILL", "dispose", "returned"])
      expect(managerSessions(manager).has(session.paneId)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("releases already-dead and kill-throw winpty sessions before forgetting them", async () => {
    const manager = new TerminalManager({ platform: "win32" })
    const released: string[] = []
    const alreadyDead = fakeWindowsSession({
      paneId: "already-dead",
      workspaceId: "edge-workspace",
      isAlive: false,
      onDispose: () => released.push("already-dead"),
    }).session
    const killThrows = fakeWindowsSession({
      paneId: "kill-throws",
      workspaceId: "edge-workspace",
      onDispose: () => released.push("kill-throws"),
      onKill: () => {
        throw new Error("synthetic kill failure")
      },
    }).session
    managerSessions(manager).set(alreadyDead.paneId, alreadyDead)
    managerSessions(manager).set(killThrows.paneId, killThrows)

    await expect(manager.killByWorkspaceId("edge-workspace")).resolves.toEqual({
      killed: 1,
      failed: 1,
    })
    expect(released).toEqual(["already-dead", "kill-throws"])
    expect(managerSessions(manager).size).toBe(0)
  })

  it("returns exact owned-process evidence from performance cleanup", async () => {
    const manager = new TerminalManager({
      platform: "win32",
      waitForOwnedProcesses: async () => [],
    })
    const { session } = fakeWindowsSession({
      paneId: "owned-process-evidence",
      workspaceId: "performance",
      isAlive: false,
      onDispose: () => undefined,
    })
    Object.assign(session.pty as unknown as Record<string, unknown>, {
      pid: 2_000_000_001,
      _agent: {
        _useConpty: false,
        _pid: 2_000_000_002,
        _innerPid: 2_000_000_001,
        _conoutSocketWorker: {
          dispose() {},
          _worker: { threadId: -1, terminate: async () => 0 },
        },
      },
    })
    managerSessions(manager).set(session.paneId, session)

    await expect(manager.cleanupWithResult()).resolves.toEqual({
      ownedProcessIds: [2_000_000_001, 2_000_000_002],
      survivingProcessIds: [],
      ownershipComplete: false,
      ownershipIssues: expect.arrayContaining([expect.stringMatching(/owned-process-evidence/)]),
    })
    expect(managerSessions(manager).size).toBe(0)
  })

  it("does not report normal cleanup complete while an owned process survives", async () => {
    const identity = {
      processId: 601,
      ownershipToken: "dead-owner-token",
      executableName: "test-shell",
    }
    const terminateMatchingOwnedProcesses = vi.fn(async () => [601])
    const manager = new TerminalManager({
      platform: "win32",
      waitForOwnedProcesses: async (processIds) => [...processIds],
      terminateMatchingOwnedProcesses,
    })
    const { session } = fakeWindowsSession({
      paneId: "stubborn-owned-process",
      workspaceId: "shutdown",
      isAlive: false,
      onDispose: () => undefined,
    })
    Object.assign(session.pty as unknown as Record<string, unknown>, { pid: 601 })
    session.performanceOwnershipToken = identity.ownershipToken
    managerSessions(manager).set(session.paneId, session)

    await expect(manager.cleanup()).rejects.toThrow("left owned processes running: 601")
    await expect(manager.cleanupWithResult()).resolves.toEqual({
      ownedProcessIds: [601],
      survivingProcessIds: [601],
      ownershipComplete: false,
      ownershipIssues: expect.arrayContaining([expect.stringMatching(/stubborn-owned-process/)]),
    })
    expect(terminateMatchingOwnedProcesses).toHaveBeenCalledWith([identity])
  })

  it("terminates exact owned winpty processes when performance readiness times out", async () => {
    vi.useFakeTimers()
    try {
      const waitForOwnedProcesses = vi.fn(async () => [])
      const manager = new TerminalManager({ platform: "win32", waitForOwnedProcesses })
      const events: string[] = []
      const worker = { threadId: 1, terminate: vi.fn(async () => 0) }
      const session = {
        pty: {
          pid: 302,
          _isReady: false,
          kill: vi.fn(),
          onExit: vi.fn(),
          _agent: {
            _useConpty: false,
            _pid: 301,
            _innerPid: 302,
            _inSocket: { destroy: vi.fn() },
            _outSocket: { destroy: vi.fn() },
            _conoutSocketWorker: {
              dispose: () => {
                events.push("dispose-worker")
                worker.threadId = -1
              },
              _worker: worker,
            },
            _ptyNative: {
              getProcessList: vi.fn(() => [301, 302]),
              kill: vi.fn(),
            },
            kill: () => events.push("kill-agent"),
          },
        },
        paneId: "never-ready",
        workspaceId: "performance",
        scopeKey: "path:test",
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        lastActive: Date.now(),
        isAlive: true,
        shell: "cmd.exe",
        startTime: Date.now(),
        usedFallback: true,
      } as unknown as TerminalSession
      managerSessions(manager).set(session.paneId, session)

      const creation = manager.createPerformanceTestControl({
        paneId: session.paneId,
        workspaceId: session.workspaceId,
        cwd: session.cwd,
      })
      const rejectedCreation = expect(creation).rejects.toThrow(
        "did not become ready for owned teardown",
      )
      await vi.advanceTimersByTimeAsync(2_000)

      await rejectedCreation
      expect(events).toEqual(["dispose-worker", "kill-agent"])
      expect(session.pty.kill).not.toHaveBeenCalled()
      expect(waitForOwnedProcesses).toHaveBeenCalledWith([302, 301])
      expect(session.isAlive).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

function managerSessions(manager: TerminalManager): Map<string, TerminalSession> {
  return (manager as unknown as { sessions: Map<string, TerminalSession> }).sessions
}

function fakeWindowsSession(options: {
  paneId: string
  workspaceId: string
  isAlive?: boolean
  onDispose: () => void
  onKill?: (signal?: string) => void
}): { session: TerminalSession } {
  const worker = { threadId: 1, terminate: async () => 0 }
  return {
    session: {
      pty: {
        kill: options.onKill ?? (() => undefined),
        onExit: () => ({ dispose() {} }),
        _agent: {
          _useConpty: false,
          _conoutSocketWorker: {
            dispose() {
              options.onDispose()
              worker.threadId = -1
            },
            _worker: worker,
          },
        },
      },
      paneId: options.paneId,
      workspaceId: options.workspaceId,
      scopeKey: options.workspaceId,
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      lastActive: Date.now(),
      isAlive: options.isAlive ?? true,
      shell: "test-shell",
      startTime: Date.now(),
      usedFallback: true,
    } as unknown as TerminalSession,
  }
}
