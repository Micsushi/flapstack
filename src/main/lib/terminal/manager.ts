import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { win32 as windowsPath } from "node:path"
import { FALLBACK_SHELL, SHELL_CRASH_THRESHOLD_MS } from "./env"
import { portManager } from "./port-manager"
import {
  captureTerminalPtyOwnedProcesses,
  createSession,
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
  private pendingSessions = new Map<string, Promise<SessionResult>>()
  private inFlightCreations = new Set<Promise<SessionResult>>()
  private cleanupOwnedProcessIds = new Set<number>()
  private cleanupWindowsProcessIdentities = new Map<number, WindowsProcessIdentity>()
  private cleanupOwnershipIssues: string[] = []
  private shuttingDown = false
  private cleanupPromise: Promise<TerminalCleanupResult> | undefined

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
  }

  async createOrAttach(params: CreateSessionParams): Promise<SessionResult> {
    return this.createOrAttachInternal(params)
  }

  /** Use the product PTY path with the stable fallback shell for bounded test controls. */
  async createPerformanceTestControl(params: CreateSessionParams): Promise<SessionResult> {
    const result = await this.createOrAttachInternal({
      ...params,
      useFallbackShell: true,
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
      return pending
    }

    // Return existing session if alive
    const existing = this.sessions.get(paneId)
    if (existing?.isAlive) {
      existing.lastActive = Date.now()
      if (cols !== undefined && rows !== undefined) {
        this.resize({ paneId, cols, rows })
      }
      return {
        isNew: false,
        serializedState: existing.serializedState || "",
      }
    }

    // Create new session
    const creationPromise = this.doCreateSession(params)
    this.pendingSessions.set(paneId, creationPromise)

    try {
      return await creationPromise
    } finally {
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
    if (this.shuttingDown) {
      await this.releaseUnstoredSession(session)
      throw new Error("Terminal manager is shutting down.")
    }

    // Set up initial commands (only for new sessions)
    setupInitialCommands(session, initialCommands)

    // Set up exit handler with fallback logic
    this.setupExitHandler(session, params)

    this.sessions.set(paneId, session)

    portManager.registerSession(session, workspaceId || "")

    return {
      isNew: true,
      serializedState: "",
    }
  }

  private setupExitHandler(session: TerminalSession, params: InternalCreateSessionParams): void {
    const { paneId } = params

    session.pty.onExit(({ exitCode, signal }) => {
      void this.handleSessionExit(session, params, exitCode, signal).catch((error) => {
        console.error("[TerminalManager] Terminal exit handling failed:", error)
        this.finishSessionExit(paneId, exitCode, signal)
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
    void releaseTerminalPtyResources(session.pty, this.cleanupOptions?.platform ?? process.platform)

    // Check if shell crashed quickly - try fallback
    const sessionDuration = Date.now() - session.startTime
    const crashedQuickly = sessionDuration < SHELL_CRASH_THRESHOLD_MS && exitCode !== 0

    if (crashedQuickly && !session.usedFallback && !this.shuttingDown) {
      console.warn(
        `[TerminalManager] Shell "${session.shell}" exited with code ${exitCode} after ${sessionDuration}ms, retrying with fallback shell "${FALLBACK_SHELL}"`,
      )

      this.sessions.delete(paneId)

      try {
        await this.doCreateSession({
          ...params,
          useFallbackShell: true,
        })
        if (!this.shuttingDown) return // Recovered - don't emit exit
      } catch (fallbackError) {
        if (!this.shuttingDown) {
          console.error("[TerminalManager] Fallback shell also failed:", fallbackError)
        }
      }
    }

    this.finishSessionExit(paneId, exitCode, signal)
  }

  private finishSessionExit(paneId: string, exitCode: number, signal?: number): void {
    try {
      // Unregister from port manager (also removes detected ports)
      portManager.unregisterSession(paneId)

      this.emit(`exit:${paneId}`, exitCode, signal)

      // Clean up session after delay
      const timeout = setTimeout(() => {
        this.sessions.delete(paneId)
      }, 5000)
      timeout.unref()
    } catch (error) {
      console.error("[TerminalManager] Failed to finalize terminal exit:", error)
      this.sessions.delete(paneId)
    }
  }

  private async releaseUnstoredSession(session: TerminalSession): Promise<void> {
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
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
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
      session.pty.resize(cols, rows)
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
    const { paneId } = params
    const session = this.sessions.get(paneId)

    if (!session) {
      console.warn(`Cannot kill terminal ${paneId}: session not found`)
      return
    }

    if (session.isAlive) {
      session.pty.kill()
    } else {
      this.sessions.delete(paneId)
    }
  }

  detach(params: { paneId: string; serializedState?: string }): void {
    const { paneId, serializedState } = params
    const session = this.sessions.get(paneId)

    if (!session) {
      console.warn(`Cannot detach terminal ${paneId}: session not found`)
      return
    }

    if (serializedState) {
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
    const sessionsToKill = Array.from(this.sessions.entries()).filter(
      ([, session]) => session.workspaceId === workspaceId,
    )

    if (sessionsToKill.length === 0) {
      return { killed: 0, failed: 0 }
    }

    const results = await Promise.all(
      sessionsToKill.map(([paneId, session]) => this.killSessionWithTimeout(paneId, session)),
    )

    const killed = results.filter(Boolean).length
    return { killed, failed: results.length - killed }
  }

  private async killSessionWithTimeout(paneId: string, session: TerminalSession): Promise<boolean> {
    if (!session.isAlive) {
      await releaseTerminalPtyResources(
        session.pty,
        this.cleanupOptions?.platform ?? process.platform,
      )
      if (this.sessions.get(paneId) === session) {
        this.sessions.delete(paneId)
      }
      return true
    }

    return new Promise<boolean>((resolve) => {
      let resolved = false
      let sigtermTimeout: ReturnType<typeof setTimeout> | undefined
      let sigkillTimeout: ReturnType<typeof setTimeout> | undefined

      const cleanup = (success: boolean): void => {
        if (resolved) return
        resolved = true
        this.off(`exit:${paneId}`, exitHandler)
        if (sigtermTimeout) clearTimeout(sigtermTimeout)
        if (sigkillTimeout) clearTimeout(sigkillTimeout)
        void (async () => {
          try {
            await releaseTerminalPtyResources(
              session.pty,
              this.cleanupOptions?.platform ?? process.platform,
            )
          } catch (error) {
            console.error(`Failed to release terminal ${paneId} resources:`, error)
          }
          if (this.sessions.get(paneId) === session) {
            this.sessions.delete(paneId)
          }
          resolve(success)
        })()
      }

      const exitHandler = () => cleanup(true)
      this.once(`exit:${paneId}`, exitHandler)

      // Escalate to SIGKILL after 2s
      sigtermTimeout = setTimeout(() => {
        if (resolved || !session.isAlive) return

        try {
          session.pty.kill("SIGKILL")
        } catch (error) {
          console.error(`Failed to send SIGKILL to terminal ${paneId}:`, error)
        }

        // Force cleanup after another 500ms
        sigkillTimeout = setTimeout(() => {
          if (resolved) return
          if (session.isAlive) {
            console.error(`Terminal ${paneId} did not exit after SIGKILL, forcing cleanup`)
            session.isAlive = false
          }
          cleanup(false)
        }, 500)
        sigkillTimeout.unref()
      }, 2000)
      sigtermTimeout.unref()

      // Send SIGTERM
      try {
        session.pty.kill()
      } catch (error) {
        console.error(`Failed to send SIGTERM to terminal ${paneId}:`, error)
        session.isAlive = false
        cleanup(false)
      }
    })
  }

  getSessionCountByWorkspaceId(workspaceId: string): number {
    return Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId && session.isAlive,
    ).length
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
    })
  }

  cleanupWithResult(): Promise<TerminalCleanupResult> {
    this.shuttingDown = true
    this.cleanupPromise ??= this.performCleanup()
    return this.cleanupPromise
  }

  private async performCleanup(): Promise<TerminalCleanupResult> {
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
