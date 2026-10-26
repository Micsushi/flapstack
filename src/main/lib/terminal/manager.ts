import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { win32 as windowsPath } from "node:path"
import { FALLBACK_SHELL, SHELL_CRASH_THRESHOLD_MS } from "./env"
import { portManager } from "./port-manager"
import { LinuxProcessOwnership } from "./linux-process-ownership"
import {
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  type TerminalReplayEvent,
} from "../../../shared/terminal-replay"
import {
  captureTerminalPtyOwnedProcesses,
  createSession,
  isTerminalProcessAlive,
  releaseTerminalPtyResources,
  setupInitialCommands,
  terminateUnreadyWindowsPty,
  waitForWindowsPtyReady,
  waitForTerminalProcessesToExit,
} from "./session"
import type {
  CreateSessionParams,
  InternalCreateSessionParams,
  SessionResult,
  TerminalSession,
} from "./types"
import {
  terminateMatchingWindowsProcesses,
  type WindowsProcessIdentity,
} from "./windows-process-identity"

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()
  private pendingSessions = new Map<
    string,
    { workspaceId: string; promise: Promise<SessionResult> }
  >()
  private pendingStops = new WeakMap<TerminalSession, Promise<boolean>>()
  private stoppingSessions = new WeakSet<TerminalSession>()
  private stopProcessIds = new WeakMap<TerminalSession, number[]>()
  private inFlightCreations = new Set<Promise<SessionResult>>()
  private cleanupOwnedProcessIds = new Set<number>()
  private cleanupWindowsProcessIdentities = new Map<number, WindowsProcessIdentity>()
  private cleanupOwnershipIssues: string[] = []
  private shuttingDown = false
  private cleanupPromise: Promise<TerminalCleanupResult> | undefined
  private linuxProcesses = new WeakMap<TerminalSession, LinuxProcessOwnership>()
  private unstoredLinuxSessions = new Set<TerminalSession>()
  private readonly usesLinuxOwnership: boolean

  constructor(
    private readonly cleanupOptions?: {
      platform?: NodeJS.Platform
      waitForOwnedProcesses?: (processIds: readonly number[]) => Promise<number[]>
      terminateMatchingOwnedProcesses?: (
        identities: readonly WindowsProcessIdentity[],
      ) => Promise<number[]>
    },
  ) {
    super()
    this.usesLinuxOwnership =
      process.platform === "linux" && (cleanupOptions?.platform ?? process.platform) === "linux"
  }

  async createOrAttach(params: CreateSessionParams, enableReplay = false): Promise<SessionResult> {
    return this.createOrAttachInternal({ ...params, enableReplay })
  }

  /** Use the product PTY path with the stable fallback shell for bounded test controls. */
  async createPerformanceTestControl(params: CreateSessionParams): Promise<SessionResult> {
    const result = await this.createOrAttachInternal({
      ...params,
      useFallbackShell: true,
      enableReplay: true,
      performanceOwnershipToken: randomUUID(),
    })
    const session = this.sessions.get(params.paneId)
    if (
      session &&
      !(await waitForWindowsPtyReady(
        session.pty,
        this.cleanupOptions?.platform ?? process.platform,
      ))
    ) {
      this.captureCleanupProcessOwnership(session)
      const ownedProcessIds = [...this.cleanupOwnedProcessIds]
      const terminated = await terminateUnreadyWindowsPty(
        session.pty,
        this.cleanupOptions?.platform ?? process.platform,
      )
      session.isAlive = false
      const waitForOwnedProcesses =
        this.cleanupOptions?.waitForOwnedProcesses ?? waitForTerminalProcessesToExit
      const survivingProcessIds = await waitForOwnedProcesses(ownedProcessIds)
      if (!terminated || survivingProcessIds.length > 0) {
        throw new Error(
          `Performance terminal ${params.paneId} readiness teardown failed for owned processes: ${
            survivingProcessIds.join(", ") || "guard unavailable"
          }.`,
        )
      }
      throw new Error(
        `Performance terminal ${params.paneId} did not become ready for owned teardown.`,
      )
    }
    return result
  }

  private async createOrAttachInternal(
    params: InternalCreateSessionParams,
  ): Promise<SessionResult> {
    if (this.shuttingDown) {
      throw new Error("Terminal manager is shutting down.")
    }
    const { paneId, cols, rows } = params

    // Deduplicate concurrent calls (prevents race in React Strict Mode)
    const pending = this.pendingSessions.get(paneId)
    if (pending) {
      return pending.promise
    }

    // Return existing session if alive
    const existing = this.sessions.get(paneId)
    if (existing && this.pendingStops.has(existing)) {
      throw new Error("Terminal is stopping. Retry after the stop completes.")
    }
    if (existing && !existing.isAlive && this.stoppingSessions.has(existing)) {
      throw new Error("Terminal cleanup is incomplete. Retry closing this tab before reconnecting.")
    }
    if (existing?.isAlive) {
      existing.lastActive = Date.now()
      if (cols !== undefined && rows !== undefined) {
        this.resize({ paneId, cols, rows })
      }
      return {
        isNew: false,
        serializedState: existing.serializedState || "",
        replayEnabled: !!existing.replay,
      }
    }

    // Create new session
    const creationPromise = this.doCreateSession(params)
    this.pendingSessions.set(paneId, {
      workspaceId: params.workspaceId || "",
      promise: creationPromise,
    })

    try {
      return await creationPromise
    } finally {
      if (this.pendingSessions.get(paneId)?.promise === creationPromise)
        this.pendingSessions.delete(paneId)
    }
  }

  private doCreateSession(params: InternalCreateSessionParams): Promise<SessionResult> {
    const creation = this.createSessionImplementation(params)
    this.inFlightCreations.add(creation)
    void creation.then(
      () => this.inFlightCreations.delete(creation),
      () => this.inFlightCreations.delete(creation),
    )
    return creation
  }

  private async createSessionImplementation(
    params: InternalCreateSessionParams,
  ): Promise<SessionResult> {
    if (this.shuttingDown) {
      throw new Error("Terminal manager is shutting down.")
    }
    const { paneId, workspaceId, initialCommands } = params

    // Create the session
    const session = await createSession(params, (id, data) => {
      this.emit(`data:${id}`, data)
    })
    if (this.usesLinuxOwnership) {
      this.linuxProcesses.set(session, new LinuxProcessOwnership(session.pty.pid))
    }
    if (this.shuttingDown) {
      await this.releaseUnstoredSession(session)
      throw new Error("Terminal manager is shutting down.")
    }

    // Set up initial commands (only for new sessions)
    setupInitialCommands(session, initialCommands)

    // Set up exit handler with fallback logic
    this.setupExitHandler(session, params)

    const previous = this.sessions.get(paneId)
    this.sessions.set(paneId, session)
    this.emit(`replay:${paneId}`, session)
    previous?.replay?.dispose()

    portManager.registerSession(session, workspaceId || "")

    return {
      isNew: true,
      serializedState: "",
      replayEnabled: !!session.replay,
    }
  }

  private setupExitHandler(session: TerminalSession, params: InternalCreateSessionParams): void {
    session.pty.onExit(({ exitCode, signal }) => {
      void this.handleSessionExit(session, params, exitCode, signal).catch((error) => {
        console.error("[TerminalManager] Terminal exit handling failed:", error)
        this.finishSessionExit(session, exitCode, signal)
      })
    })
  }

  private async handleSessionExit(
    session: TerminalSession,
    params: InternalCreateSessionParams,
    exitCode: number,
    signal?: number,
  ): Promise<void> {
    const { paneId } = params
    session.isAlive = false
    const platform = this.cleanupOptions?.platform ?? process.platform
    if (this.usesLinuxOwnership && !this.stoppingSessions.has(session) && !this.shuttingDown) {
      try {
        const ownership = this.linuxProcesses.get(session)!
        ownership.capture()
        if (ownership.survivors().length > 0) this.stoppingSessions.add(session)
      } catch (error) {
        console.error("[TerminalManager] Linux exit ownership is unresolved:", error)
        this.stoppingSessions.add(session)
      }
    }
    const exitedPtyStopped =
      platform !== "win32" ||
      this.stoppingSessions.has(session) ||
      this.shuttingDown ||
      this.stopExitedWindowsPty(session, this.captureCleanupProcessOwnership(session))
    void releaseTerminalPtyResources(session.pty, this.cleanupOptions?.platform ?? process.platform)
    // A late exit belongs to this PTY instance, never its replacement in the same pane.
    if (this.sessions.get(paneId) !== session) return
    if (!exitedPtyStopped) {
      this.stoppingSessions.add(session)
      this.finishSessionExit(session, exitCode, signal)
      return
    }

    // Check if shell crashed quickly - try fallback
    const sessionDuration = Date.now() - session.startTime
    const crashedQuickly = sessionDuration < SHELL_CRASH_THRESHOLD_MS && exitCode !== 0

    if (
      crashedQuickly &&
      !session.usedFallback &&
      !this.shuttingDown &&
      !this.stoppingSessions.has(session)
    ) {
      console.warn(
        `[TerminalManager] Shell "${session.shell}" exited with code ${exitCode} after ${sessionDuration}ms, retrying with fallback shell "${FALLBACK_SHELL}"`,
      )

      const fallback = this.doCreateSession({ ...params, useFallbackShell: true })
      this.pendingSessions.set(paneId, { workspaceId: session.workspaceId, promise: fallback })
      try {
        await fallback
        if (!this.shuttingDown) return // Recovered - don't emit exit
      } catch (fallbackError) {
        if (!this.shuttingDown) {
          console.error("[TerminalManager] Fallback shell also failed:", fallbackError)
        }
      } finally {
        if (this.pendingSessions.get(paneId)?.promise === fallback)
          this.pendingSessions.delete(paneId)
      }
    }

    this.finishSessionExit(session, exitCode, signal)
  }

  private finishSessionExit(session: TerminalSession, exitCode: number, signal?: number): void {
    const { paneId } = session
    if (this.sessions.get(paneId) !== session) return
    session.replay?.finish(exitCode, signal)
    try {
      // Unregister from port manager (also removes detected ports)
      portManager.unregisterSession(paneId)

      this.emit(`exit:${paneId}`, exitCode, signal)

      // Clean up session after delay
      const timeout = setTimeout(() => {
        if (!this.stoppingSessions.has(session)) this.removeSession(session)
      }, 5000)
      timeout.unref()
    } catch (error) {
      console.error("[TerminalManager] Failed to finalize terminal exit:", error)
      if (!this.stoppingSessions.has(session)) this.removeSession(session)
    }
  }

  private async releaseUnstoredSession(session: TerminalSession): Promise<void> {
    if (this.usesLinuxOwnership) {
      this.unstoredLinuxSessions.add(session)
      if (await this.killSessionWithTimeout(session.paneId, session)) {
        session.replay?.dispose()
        this.unstoredLinuxSessions.delete(session)
      }
      return
    }
    session.replay?.dispose()
    this.captureCleanupProcessOwnership(session)
    session.isAlive = false
    try {
      session.pty.kill()
    } catch {
      // Continue through the guarded resource release.
    }
    await releaseTerminalPtyResources(
      session.pty,
      this.cleanupOptions?.platform ?? process.platform,
    )
  }

  write(params: { paneId: string; data: string }): void {
    const { paneId, data } = params
    const session = this.sessions.get(paneId)

    if (!session || !session.isAlive) {
      throw new Error(`Terminal session ${paneId} not found or not alive`)
    }

    session.pty.write(data)
    session.lastActive = Date.now()
  }

  resize(params: { paneId: string; cols: number; rows: number }): void {
    const { paneId, cols, rows } = params

    // Validate geometry: cols and rows must be positive integers
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols <= 0 ||
      rows <= 0 ||
      cols > MAX_TERMINAL_COLS ||
      rows > MAX_TERMINAL_ROWS
    ) {
      console.warn(
        `[TerminalManager] Invalid resize geometry for ${paneId}: cols=${cols}, rows=${rows}. Must be positive integers.`,
      )
      return
    }

    const session = this.sessions.get(paneId)

    if (!session || !session.isAlive) {
      console.warn(`Cannot resize terminal ${paneId}: session not found or not alive`)
      return
    }

    try {
      if (session.cols === cols && session.rows === rows) return
      session.pty.resize(cols, rows)
      session.replay?.resize(cols, rows)
      session.cols = cols
      session.rows = rows
      session.lastActive = Date.now()
    } catch (error) {
      console.error(
        `[TerminalManager] Failed to resize terminal ${paneId} (cols=${cols}, rows=${rows}):`,
        error,
      )
    }
  }

  signal(params: { paneId: string; signal?: string }): void {
    const { paneId, signal = "SIGTERM" } = params
    const session = this.sessions.get(paneId)

    if (!session || !session.isAlive) {
      console.warn(`Cannot signal terminal ${paneId}: session not found or not alive`)
      return
    }

    session.pty.kill(signal)
    session.lastActive = Date.now()
  }

  async kill(params: { paneId: string }): Promise<void> {
    if (!(await this.stopPane(params.paneId))) {
      throw new Error("Terminal stop could not be confirmed. The session was retained for retry.")
    }
  }

  detach(params: { paneId: string; serializedState?: string }): void {
    const { paneId, serializedState } = params
    const session = this.sessions.get(paneId)

    if (!session) {
      console.warn(`Cannot detach terminal ${paneId}: session not found`)
      return
    }

    if (serializedState !== undefined) {
      session.serializedState = serializedState
    }
    session.lastActive = Date.now()
  }

  clearScrollback(params: { paneId: string }): void {
    const { paneId } = params
    const session = this.sessions.get(paneId)

    if (!session) {
      console.warn(`Cannot clear scrollback for terminal ${paneId}: session not found`)
      return
    }

    session.serializedState = ""
    session.replay?.clear()
    session.lastActive = Date.now()
  }

  getSession(paneId: string): { isAlive: boolean; cwd: string; lastActive: number } | null {
    const session = this.sessions.get(paneId)
    if (!session) {
      return null
    }

    return {
      isAlive: session.isAlive,
      cwd: session.cwd,
      lastActive: session.lastActive,
    }
  }

  async killByWorkspaceId(workspaceId: string): Promise<{ killed: number; failed: number }> {
    const paneIds = new Set([
      ...Array.from(this.sessions)
        .filter(([, session]) => session.workspaceId === workspaceId)
        .map(([paneId]) => paneId),
      ...Array.from(this.pendingSessions)
        .filter(([, creation]) => creation.workspaceId === workspaceId)
        .map(([paneId]) => paneId),
    ])
    const results = await Promise.all(
      Array.from(paneIds, (paneId) => this.stopPane(paneId, workspaceId)),
    )

    const killed = results.filter(Boolean).length
    return { killed, failed: results.length - killed }
  }

  private async stopPane(paneId: string, workspaceId?: string): Promise<boolean> {
    // Creation may fail after storing a PTY or be superseded by a fallback.
    for (
      let creation = this.pendingSessions.get(paneId);
      creation;
      creation = this.pendingSessions.get(paneId)
    ) {
      await Promise.allSettled([creation.promise])
    }
    const session = this.sessions.get(paneId)
    if (!session || (workspaceId !== undefined && session.workspaceId !== workspaceId)) return true
    return this.killSessionWithTimeout(paneId, session)
  }

  private killSessionWithTimeout(paneId: string, session: TerminalSession): Promise<boolean> {
    const pending = this.pendingStops.get(session)
    if (pending) return pending
    this.stoppingSessions.add(session)
    const stop = this.stopSession(paneId, session)
    this.pendingStops.set(session, stop)
    void stop.finally(() => this.pendingStops.delete(session))
    return stop
  }

  private async stopSession(paneId: string, session: TerminalSession): Promise<boolean> {
    try {
      if (this.usesLinuxOwnership) {
        const ownership = this.linuxProcesses.get(session)
        const subscription = session.pty.onExit(() => {
          session.isAlive = false
        })
        try {
          for (const pid of ownership?.capture() ?? []) this.cleanupOwnedProcessIds.add(pid)
          if (!ownership || !(await ownership.stop())) return false
          for (const pid of ownership.capture()) this.cleanupOwnedProcessIds.add(pid)
          for (let attempt = 0; session.isAlive && attempt < 20; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          if (session.isAlive) return false
        } finally {
          subscription.dispose()
        }
        if (!(await releaseTerminalPtyResources(session.pty, "linux"))) return false
        if (this.sessions.get(paneId) === session) {
          portManager.unregisterSession(paneId)
          this.removeSession(session)
        }
        return true
      }
      const previousProcessIds = this.stopProcessIds.get(session)
      const processIds = [
        ...new Set([
          ...(previousProcessIds ?? []),
          ...(!session.isAlive && previousProcessIds
            ? []
            : this.captureCleanupProcessOwnership(session)),
        ]),
      ]
      this.stopProcessIds.set(session, processIds)
      const platform = this.cleanupOptions?.platform ?? process.platform
      if (session.isAlive) {
        const exited = await new Promise<boolean>((resolve) => {
          let settled = false
          let escalation: ReturnType<typeof setTimeout> | undefined
          let timeout: ReturnType<typeof setTimeout> | undefined
          // Observe this PTY generation, not a replacement using the same pane ID.
          const subscription = session.pty.onExit(() => finish(true))
          const finish = (success: boolean) => {
            if (settled) return
            settled = true
            subscription.dispose()
            if (escalation) clearTimeout(escalation)
            if (timeout) clearTimeout(timeout)
            resolve(success)
          }
          escalation = setTimeout(() => {
            try {
              if (session.isAlive) session.pty.kill(platform === "win32" ? undefined : "SIGKILL")
            } catch (error) {
              console.error(`Failed to escalate terminal stop ${paneId}:`, error)
            }
            if (!settled) timeout = setTimeout(() => finish(!session.isAlive), 500)
          }, 2000)
          try {
            session.pty.kill()
          } catch (error) {
            console.error(`Failed to stop terminal ${paneId}:`, error)
            finish(false)
          }
        })
        if (!exited) return false
        session.isAlive = false
      } else if (platform === "win32" && !this.stopExitedWindowsPty(session, processIds)) {
        return false
      }
      const released = await releaseTerminalPtyResources(session.pty, platform)
      const waitForOwnedProcesses =
        this.cleanupOptions?.waitForOwnedProcesses ?? waitForTerminalProcessesToExit
      const survivors = await waitForOwnedProcesses(processIds)
      if (!released || survivors.length > 0) return false
      if (this.sessions.get(paneId) === session) {
        portManager.unregisterSession(paneId)
        this.removeSession(session)
      }
      return true
    } catch (error) {
      console.error(`Could not confirm terminal stop ${paneId}:`, error)
      return false
    }
  }

  private stopExitedWindowsPty(session: TerminalSession, processIds: number[]): boolean {
    this.stopProcessIds.set(session, processIds)
    if (!processIds.some((processId) => isTerminalProcessAlive(processId))) return true
    // A natural shell exit can leave the winpty agent and its native handle alive.
    try {
      session.pty.kill()
      return true
    } catch (error) {
      console.error(`Could not stop exited terminal ${session.paneId}:`, error)
      return false
    }
  }

  getSessionCountByWorkspaceId(workspaceId: string): number {
    return Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId && session.isAlive,
    ).length
  }

  getLiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter((session) => session.isAlive).length
  }

  /**
   * Get all alive sessions for a given scope key.
   * Used by new workspaces to discover shared terminals.
   */
  getSessionsByScopeKey(
    scopeKey: string,
  ): Array<{ paneId: string; cwd: string; lastActive: number }> {
    return Array.from(this.sessions.values())
      .filter((session) => session.scopeKey === scopeKey && session.isAlive)
      .map((session) => ({
        paneId: session.paneId,
        cwd: session.cwd,
        lastActive: session.lastActive,
      }))
  }

  /**
   * Send a newline to all terminals in a workspace to refresh their prompts.
   * Useful after switching branches to update the branch name in prompts.
   */
  refreshPromptsForWorkspace(workspaceId: string): void {
    for (const [paneId, session] of this.sessions.entries()) {
      if (session.workspaceId === workspaceId && session.isAlive) {
        try {
          session.pty.write("\n")
        } catch (error) {
          console.warn(`[TerminalManager] Failed to refresh prompt for pane ${paneId}:`, error)
        }
      }
    }
  }

  detachAllListeners(): void {
    for (const event of this.eventNames()) {
      const name = String(event)
      if (name.startsWith("data:") || name.startsWith("exit:")) {
        this.removeAllListeners(event)
      }
    }
  }

  cleanup(): Promise<void> {
    return this.cleanupWithResult().then((result) => {
      if (result.survivingProcessIds.length > 0) {
        throw new Error(
          `Terminal cleanup left owned processes running: ${result.survivingProcessIds.join(", ")}`,
        )
      }
      if (this.usesLinuxOwnership && !result.ownershipComplete) {
        throw new Error(
          `Terminal cleanup could not be confirmed: ${result.ownershipIssues.join("; ")}`,
        )
      }
    })
  }

  cleanupWithResult(): Promise<TerminalCleanupResult> {
    this.shuttingDown = true
    this.cleanupPromise ??= this.performCleanup().then((result) => {
      if (
        this.usesLinuxOwnership &&
        (!result.ownershipComplete || result.survivingProcessIds.length > 0)
      )
        this.cleanupPromise = undefined
      return result
    })
    return this.cleanupPromise
  }

  private async performCleanup(): Promise<TerminalCleanupResult> {
    if (this.usesLinuxOwnership) {
      return this.performLinuxCleanup()
    }
    for (const session of this.sessions.values()) {
      this.captureCleanupProcessOwnership(session)
    }
    const exitPromises: Promise<void>[] = []

    for (const [paneId, session] of this.sessions.entries()) {
      if (session.isAlive) {
        const exitPromise = new Promise<void>((resolve) => {
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          const exitHandler = () => {
            this.off(`exit:${paneId}`, exitHandler)
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId)
            }
            resolve()
          }
          this.once(`exit:${paneId}`, exitHandler)

          timeoutId = setTimeout(() => {
            this.off(`exit:${paneId}`, exitHandler)
            resolve()
          }, 2000)
          timeoutId.unref()
        })

        exitPromises.push(exitPromise)
        try {
          session.pty.kill()
        } catch (error) {
          console.error(`Failed to kill terminal ${paneId} during cleanup:`, error)
        }
      }
    }

    await Promise.all(exitPromises)
    while (this.inFlightCreations.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightCreations))
    }
    await Promise.all(
      Array.from(this.sessions.values(), (session) =>
        releaseTerminalPtyResources(session.pty, this.cleanupOptions?.platform ?? process.platform),
      ),
    )
    for (const session of this.sessions.values()) session.replay?.dispose()
    this.sessions.clear()
    this.removeAllListeners()
    const ownedProcessIds = [...this.cleanupOwnedProcessIds]
    const waitForOwnedProcesses =
      this.cleanupOptions?.waitForOwnedProcesses ?? waitForTerminalProcessesToExit
    let survivingProcessIds = await waitForOwnedProcesses(ownedProcessIds)
    const windowsProcessIdentities = [...this.cleanupWindowsProcessIdentities.values()]
    if (survivingProcessIds.length > 0 && windowsProcessIdentities.length > 0) {
      const surviving = new Set(survivingProcessIds)
      try {
        const terminateOwnedProcesses =
          this.cleanupOptions?.terminateMatchingOwnedProcesses ?? terminateMatchingWindowsProcesses
        await terminateOwnedProcesses(
          windowsProcessIdentities.filter((identity) => surviving.has(identity.processId)),
        )
      } catch (error) {
        this.cleanupOwnershipIssues.push(
          `Windows process identity termination failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      survivingProcessIds = await waitForOwnedProcesses(survivingProcessIds)
    }
    return {
      ownedProcessIds,
      survivingProcessIds,
      ownershipComplete: this.cleanupOwnershipIssues.length === 0,
      ownershipIssues: [...this.cleanupOwnershipIssues],
    }
  }

  private removeSession(session: TerminalSession): void {
    if (this.sessions.get(session.paneId) !== session) return
    session.replay?.dispose()
    this.sessions.delete(session.paneId)
  }

  private async performLinuxCleanup(): Promise<TerminalCleanupResult> {
    while (this.inFlightCreations.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightCreations))
    }
    const sessions = new Set([...this.sessions.values(), ...this.unstoredLinuxSessions])
    const ownedProcessIds = new Set(this.cleanupOwnedProcessIds)
    const survivingProcessIds = new Set<number>()
    const ownershipIssues: string[] = []
    await Promise.all(
      Array.from(sessions, async (session) => {
        const stopped = await this.killSessionWithTimeout(session.paneId, session)
        const ownership = this.linuxProcesses.get(session)
        try {
          if (!ownership) throw new Error("Linux process ownership is unavailable.")
          for (const pid of ownership.capture()) ownedProcessIds.add(pid)
          for (const pid of ownership.survivors()) survivingProcessIds.add(pid)
        } catch (error) {
          ownershipIssues.push(`${session.paneId}: ${String(error)}`)
        }
        if (stopped) {
          session.replay?.dispose()
          this.unstoredLinuxSessions.delete(session)
        } else {
          ownershipIssues.push(`${session.paneId}: terminal stop failed; retained for retry.`)
        }
      }),
    )
    if (ownershipIssues.length === 0) this.removeAllListeners()
    return {
      ownedProcessIds: [...ownedProcessIds],
      survivingProcessIds: [...survivingProcessIds],
      ownershipComplete: ownershipIssues.length === 0,
      ownershipIssues,
    }
  }

  subscribeReplay(
    paneId: string,
    observer: {
      next: (event: TerminalReplayEvent) => void
      error: (error: Error) => void
      complete: () => void
    },
  ): () => void {
    let unsubscribe: (() => void) | undefined
    const attach = (session: TerminalSession) => {
      unsubscribe?.()
      unsubscribe = session.replay?.subscribe(observer)
      if (!session.replay) observer.error(new Error("Terminal recovery is unavailable."))
    }
    const session = this.sessions.get(paneId)
    if (!session) {
      observer.error(new Error("Terminal session is unavailable."))
      return () => {}
    }
    this.on(`replay:${paneId}`, attach)
    attach(session)
    return () => {
      this.off(`replay:${paneId}`, attach)
      unsubscribe?.()
    }
  }

  acknowledgeReplay(paneId: string, subscriptionId: string, deliveryId: number): void {
    this.sessions.get(paneId)?.replay?.acknowledge(subscriptionId, deliveryId)
  }

  private captureCleanupProcessOwnership(session: TerminalSession): number[] {
    const capture = captureTerminalPtyOwnedProcesses(
      session.pty,
      this.cleanupOptions?.platform ?? process.platform,
    )
    for (const processId of capture.processIds) {
      this.cleanupOwnedProcessIds.add(processId)
      if (session.performanceOwnershipToken && processId === session.pty.pid) {
        this.cleanupWindowsProcessIdentities.set(processId, {
          processId,
          ownershipToken: session.performanceOwnershipToken,
          executableName: windowsPath.basename(session.shell).toLowerCase(),
        })
      }
    }
    if (!capture.complete) {
      this.cleanupOwnershipIssues.push(`${session.paneId}: ${capture.reason ?? "unknown reason"}`)
    }
    return capture.processIds
  }
}

export interface TerminalCleanupResult {
  ownedProcessIds: number[]
  survivingProcessIds: number[]
  ownershipComplete: boolean
  ownershipIssues: string[]
}

/** Singleton terminal manager instance */
export const terminalManager = new TerminalManager()
