import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as pty from "node-pty"
import { buildTerminalEnv, FALLBACK_SHELL, getDefaultShell } from "./env"
import type { InternalCreateSessionParams, TerminalSession } from "./types"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const windowsPtyReleases = new WeakMap<object, Promise<boolean>>()
const unixPtyReleases = new WeakSet<object>()

export function terminalShellArgs(shell: string, performanceOwnershipToken?: string): string[] {
  const shellName = path.win32.basename(shell).toLowerCase()
  if (performanceOwnershipToken && shellName === "cmd.exe") {
    return ["/d", "/q", "/k", `set "FLAPSTACK_PTY_OWNER=${performanceOwnershipToken}"`]
  }
  if (shell.includes("zsh")) {
    return ["-l"]
  }
  if (shell.includes("bash")) {
    return []
  }
  return []
}

export function formatInitialCommands(shell: string, commands: string[]): string {
  // Shell paths describe the child shell, not necessarily the current host.
  // win32.basename accepts both slash styles, so Windows shell paths are
  // recognized when this code is tested or orchestrated from Linux/macOS.
  const shellName = path.win32.basename(shell).toLowerCase()
  if (shellName === "powershell.exe" || shellName === "pwsh.exe") {
    let chain = commands.at(-1) ?? ""
    for (let index = commands.length - 2; index >= 0; index -= 1) {
      chain = `${commands[index]}; if ($?) { ${chain} }`
    }
    return `${chain}\n`
  }
  return `${commands.join(" && ")}\n`
}

export function terminalPtyPlatformOptions(
  platform: NodeJS.Platform = os.platform(),
): Pick<pty.IWindowsPtyForkOptions, "useConpty"> {
  return platform === "win32" ? { useConpty: false } : {}
}

/**
 * node-pty 1.1.0 does not expose a public disposal seam for the conout worker
 * created by its Windows winpty path. Its kill() branch closes the PTY but
 * leaves that worker alive. Keep the version-sensitive access isolated and
 * guarded so an upstream shape change degrades to a no-op.
 */
export function initiateWindowsPtyConoutWorkerRelease(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
  },
): boolean {
  return getOrStartWindowsPtyConoutWorkerRelease(ptyProcess, platform, options) !== undefined
}

export async function releaseWindowsPtyConoutWorker(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
  },
): Promise<boolean> {
  const release = getOrStartWindowsPtyConoutWorkerRelease(ptyProcess, platform, options)
  return release ? release : false
}

/**
 * node-pty's public Unix kill() seam signals the child but does not dispose its
 * master stream or queued writer. Use the guarded runtime destroy() seam once.
 */
export function releaseUnixPtyResources(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
): boolean {
  if (platform === "win32" || !isRecord(ptyProcess) || typeof ptyProcess.destroy !== "function") {
    return false
  }
  if (unixPtyReleases.has(ptyProcess)) return true

  unixPtyReleases.add(ptyProcess)
  try {
    Reflect.apply(ptyProcess.destroy, ptyProcess, [])
    return true
  } catch {
    unixPtyReleases.delete(ptyProcess)
    return false
  }
}

export async function releaseTerminalPtyResources(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
): Promise<boolean> {
  return platform === "win32"
    ? releaseWindowsPtyConoutWorker(ptyProcess, platform)
    : releaseUnixPtyResources(ptyProcess, platform)
}

/** Ensure bounded performance controls cannot request teardown while kill() is still deferred. */
export async function waitForWindowsPtyReady(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
  },
): Promise<boolean> {
  if (platform !== "win32" || !isRecord(ptyProcess) || typeof ptyProcess._isReady !== "boolean") {
    return true
  }
  const maximumAttempts = options?.maximumAttempts ?? 200
  const wait = options?.wait ?? delay
  for (let attempt = 1; attempt < maximumAttempts && ptyProcess._isReady !== true; attempt += 1) {
    await wait(10)
  }
  return ptyProcess._isReady === true
}

/**
 * Finalize a winpty session that never reached WindowsTerminal readiness.
 * Stop its conout worker before invoking the still-current native agent.
 */
export async function terminateUnreadyWindowsPty(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
): Promise<boolean> {
  if (platform !== "win32" || !isRecord(ptyProcess) || ptyProcess._isReady !== false) return false
  const agent = ptyProcess._agent
  if (
    !isRecord(agent) ||
    agent._useConpty !== false ||
    typeof agent.kill !== "function" ||
    typeof agent._pid !== "number" ||
    !Number.isSafeInteger(agent._pid) ||
    agent._pid <= 0 ||
    typeof agent._innerPid !== "number" ||
    !Number.isSafeInteger(agent._innerPid) ||
    agent._innerPid <= 0
  ) {
    return false
  }
  const native = agent._ptyNative
  if (
    !isRecord(native) ||
    typeof native.getProcessList !== "function" ||
    typeof native.kill !== "function" ||
    !(await releaseWindowsPtyConoutWorker(ptyProcess, platform))
  ) {
    return false
  }
  try {
    Reflect.apply(agent.kill as (...args: unknown[]) => unknown, agent, [])
    return true
  } catch {
    return false
  }
}

function getOrStartWindowsPtyConoutWorkerRelease(
  ptyProcess: unknown,
  platform: NodeJS.Platform,
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
  },
): Promise<boolean> | undefined {
  if (platform !== "win32" || !isRecord(ptyProcess)) return undefined
  if (typeof ptyProcess.kill !== "function" || typeof ptyProcess.onExit !== "function") {
    return undefined
  }
  const agent = ptyProcess._agent
  if (!isRecord(agent) || agent._useConpty !== false) return undefined
  const connection = agent._conoutSocketWorker
  if (!isRecord(connection) || typeof connection.dispose !== "function") return undefined
  const worker = connection._worker
  if (
    !isRecord(worker) ||
    typeof worker.threadId !== "number" ||
    typeof worker.terminate !== "function"
  ) {
    return undefined
  }

  const existingRelease = windowsPtyReleases.get(ptyProcess)
  if (existingRelease) return existingRelease
  const release = releaseWindowsPtyConoutWorkerInternal(agent, connection, worker, options)
  windowsPtyReleases.set(ptyProcess, release)
  return release
}

async function releaseWindowsPtyConoutWorkerInternal(
  agent: Record<PropertyKey, unknown>,
  connection: Record<PropertyKey, unknown>,
  worker: Record<PropertyKey, unknown>,
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
  },
): Promise<boolean> {
  const maximumAttempts = options?.maximumAttempts ?? 2
  const wait = options?.wait ?? delay

  try {
    try {
      Reflect.apply(connection.dispose as (...args: unknown[]) => unknown, connection, [])
    } catch {
      // The bounded fallback below is still safer than rejecting terminal teardown.
    }

    for (let attempt = 1; attempt < maximumAttempts && worker.threadId !== -1; attempt += 1) {
      await wait(25)
    }
    if (worker.threadId === -1) {
      // node-pty's normal drain terminates the worker but leaves the exited
      // winpty agent's main-thread pipe open. Release it only after the worker
      // has confirmed the drain is complete.
      destroyNodePtySocket(agent._inSocket)
      destroyNodePtySocket(agent._outSocket)
      return true
    }

    destroyNodePtySocket(agent._inSocket)
    destroyNodePtySocket(agent._outSocket)
    try {
      await Reflect.apply(worker.terminate as (...args: unknown[]) => unknown, worker, [])
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

/**
 * Capture the exact OS processes owned by a PTY before teardown. The public
 * shell PID is always retained. The extra winpty identifiers are guarded
 * because node-pty 1.1.0 does not expose them through its public interface.
 */
export interface TerminalPtyOwnedProcessCapture {
  processIds: number[]
  complete: boolean
  reason: string | null
}

export function captureTerminalPtyOwnedProcesses(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
): TerminalPtyOwnedProcessCapture {
  if (!isRecord(ptyProcess)) {
    return { processIds: [], complete: false, reason: "PTY process shape is unavailable." }
  }
  const processIds = new Set<number>()
  const addProcessId = (value: unknown) => {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      processIds.add(value)
    }
  }

  addProcessId(ptyProcess.pid)
  if (platform !== "win32") {
    return {
      processIds: [...processIds],
      complete: processIds.size > 0,
      reason: processIds.size > 0 ? null : "PTY public process ID is unavailable.",
    }
  }

  const agent = ptyProcess._agent
  if (!isRecord(agent) || agent._useConpty !== false) {
    return {
      processIds: [...processIds],
      complete: false,
      reason: "Guarded winpty agent ownership is unavailable.",
    }
  }
  addProcessId(agent._pid)
  addProcessId(agent._innerPid)

  const native = agent._ptyNative
  if (
    !isRecord(native) ||
    typeof native.getProcessList !== "function" ||
    typeof agent._pid !== "number" ||
    !Number.isSafeInteger(agent._pid) ||
    agent._pid <= 0 ||
    typeof agent._innerPid !== "number" ||
    !Number.isSafeInteger(agent._innerPid) ||
    agent._innerPid <= 0 ||
    !processIds.has(ptyProcess.pid as number)
  ) {
    return {
      processIds: [...processIds],
      complete: false,
      reason: "Guarded winpty PID or process-list ownership is incomplete.",
    }
  }

  try {
    const consoleProcessIds = Reflect.apply(native.getProcessList, native, [agent._pid])
    if (!Array.isArray(consoleProcessIds)) {
      return {
        processIds: [...processIds],
        complete: false,
        reason: "Guarded winpty process list is not an array.",
      }
    }
    for (const processId of consoleProcessIds) addProcessId(processId)
  } catch {
    return {
      processIds: [...processIds],
      complete: false,
      reason: "Guarded winpty process list could not be captured.",
    }
  }

  return { processIds: [...processIds], complete: true, reason: null }
}

export function terminalPtyOwnedProcessIds(
  ptyProcess: unknown,
  platform: NodeJS.Platform = os.platform(),
): number[] {
  return captureTerminalPtyOwnedProcesses(ptyProcess, platform).processIds
}

export function isTerminalProcessAlive(
  processId: number,
  signalProcess: (processId: number, signal: 0) => boolean = process.kill,
): boolean {
  try {
    signalProcess(processId, 0)
    return true
  } catch (error) {
    return !(
      isRecord(error) &&
      typeof error.code === "string" &&
      error.code.toUpperCase() === "ESRCH"
    )
  }
}

export async function waitForTerminalProcessesToExit(
  processIds: readonly number[],
  options?: {
    maximumAttempts?: number
    wait?: (milliseconds: number) => Promise<void>
    isAlive?: (processId: number) => boolean
  },
): Promise<number[]> {
  const maximumAttempts = options?.maximumAttempts ?? 100
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Terminal process settlement requires at least one bounded observation.")
  }
  const wait = options?.wait ?? delay
  const isAlive = options?.isAlive ?? isTerminalProcessAlive
  const uniqueProcessIds = [...new Set(processIds)].filter(
    (processId) => Number.isSafeInteger(processId) && processId > 0,
  )
  let surviving = uniqueProcessIds.filter((processId) => isAlive(processId))
  for (let attempt = 1; attempt < maximumAttempts && surviving.length > 0; attempt += 1) {
    await wait(25)
    surviving = surviving.filter((processId) => isAlive(processId))
  }
  return surviving
}

function destroyNodePtySocket(value: unknown): void {
  if (isRecord(value) && typeof value.destroy === "function") {
    try {
      Reflect.apply(value.destroy, value, [])
    } catch {
      // Best-effort fallback after the normal node-pty drain window.
    }
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Validate and resolve cwd path (Windows compatibility)
 * Falls back to home directory if path doesn't exist
 */
function validateAndResolveCwd(cwd: string): string {
  if (!fs.existsSync(cwd)) {
    const homeDir = os.homedir()
    console.warn(`[Terminal] CWD does not exist: ${cwd}, using home directory: ${homeDir}`)
    return homeDir
  }

  try {
    const stat = fs.statSync(cwd)
    if (!stat.isDirectory()) {
      const homeDir = os.homedir()
      console.warn(`[Terminal] CWD is not a directory: ${cwd}, using home directory: ${homeDir}`)
      return homeDir
    }
  } catch {
    const homeDir = os.homedir()
    console.warn(`[Terminal] Error checking CWD: ${cwd}, using home directory: ${homeDir}`)
    return homeDir
  }

  try {
    return path.resolve(cwd)
  } catch {
    const homeDir = os.homedir()
    console.warn(`[Terminal] Error resolving CWD: ${cwd}, using home directory: ${homeDir}`)
    return homeDir
  }
}

/**
 * Resolve shell path for Windows
 * Tries to find shell in common Windows locations
 */
function resolveShellPath(shell: string): string {
  if (os.platform() !== "win32") return shell

  // If shell already has a path, use it as-is
  if (shell.includes("\\") || shell.includes("/")) return shell

  // Try common Windows shell locations
  const commonPaths = [
    process.env.COMSPEC || "",
    process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : "",
    process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\cmd.exe` : "",
  ].filter(Boolean)

  for (const shellPath of commonPaths) {
    if (fs.existsSync(shellPath)) {
      return shellPath
    }
  }

  // Return as-is, let node-pty handle PATH resolution
  return shell
}

function spawnPty(params: {
  shell: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
  performanceOwnershipToken?: string
}): pty.IPty {
  const { shell, cols, rows, cwd, env, performanceOwnershipToken } = params
  const shellArgs = terminalShellArgs(shell, performanceOwnershipToken)
  const resolvedCwd = validateAndResolveCwd(cwd)
  const resolvedShell = resolveShellPath(shell)

  try {
    return pty.spawn(resolvedShell, shellArgs, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: resolvedCwd,
      env,
      // node-pty's default ConPTY cancellation helper can fail AttachConsole
      // under a GUI-subsystem Electron parent and emit noisy child errors even
      // though the terminal closes. The bundled winpty path terminates the
      // complete console process list without that helper.
      ...terminalPtyPlatformOptions(),
    })
  } catch (error) {
    console.error(`[Terminal] Failed to spawn PTY with ${resolvedShell}:`, error)
    // Try with fallback shell
    console.log(`[Terminal] Retrying with fallback shell: ${FALLBACK_SHELL}`)
    return pty.spawn(FALLBACK_SHELL, terminalShellArgs(FALLBACK_SHELL, performanceOwnershipToken), {
      name: "xterm-256color",
      cols,
      rows,
      cwd: resolvedCwd,
      env,
      ...terminalPtyPlatformOptions(),
    })
  }
}

export async function createSession(
  params: InternalCreateSessionParams,
  onData: (paneId: string, data: string) => void,
): Promise<TerminalSession> {
  const {
    paneId,
    tabId,
    workspaceId,
    workspaceName,
    workspacePath,
    rootPath,
    cwd,
    cols,
    rows,
    useFallbackShell = false,
    performanceOwnershipToken,
  } = params

  const shell = useFallbackShell ? FALLBACK_SHELL : getDefaultShell()
  const workingDir = validateAndResolveCwd(cwd || os.homedir())
  const terminalCols = cols || DEFAULT_COLS
  const terminalRows = rows || DEFAULT_ROWS

  const env = buildTerminalEnv({
    shell,
    paneId,
    tabId,
    workspaceId,
    workspaceName,
    workspacePath,
    rootPath,
  })

  const ptyProcess = spawnPty({
    shell,
    cols: terminalCols,
    rows: terminalRows,
    cwd: workingDir,
    env,
    performanceOwnershipToken,
  })

  const session: TerminalSession = {
    pty: ptyProcess,
    paneId,
    workspaceId: workspaceId || "",
    scopeKey: params.scopeKey || workspaceId || "",
    cwd: workingDir,
    cols: terminalCols,
    rows: terminalRows,
    lastActive: Date.now(),
    isAlive: true,
    shell,
    startTime: Date.now(),
    usedFallback: useFallbackShell,
    performanceOwnershipToken,
  }

  ptyProcess.onData((data) => {
    onData(paneId, data)
  })

  return session
}

/**
 * Set up initial commands to run after shell prompt is ready.
 * Commands are only sent for new sessions (not reattachments).
 */
export function setupInitialCommands(
  session: TerminalSession,
  initialCommands: string[] | undefined,
): void {
  if (!initialCommands || initialCommands.length === 0) {
    return
  }

  const initialCommandString = formatInitialCommands(session.shell, initialCommands)

  const dataHandler = session.pty.onData(() => {
    dataHandler.dispose()

    setTimeout(() => {
      if (session.isAlive) {
        session.pty.write(initialCommandString)
      }
    }, 100)
  })
}
