import { existsSync, realpathSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { CLI_OPEN_DIRECTORY_CHANNEL, type SingleInstanceLaunchData } from "../../shared/cli-launch"

type LaunchDirectoryOptions = {
  defaultApp: boolean
  cwd?: string
  exists?: typeof existsSync
  stat?: typeof statSync
  canonicalize?: typeof realpathSync.native
}

type LaunchWindow = {
  isMinimized(): boolean
  restore(): void
  focus(): void
  webContents: { send(channel: string): void }
}

const pendingLaunchDirectories: string[] = []

export function resolveLaunchDirectoryFromArgv(
  argv: readonly string[],
  options: LaunchDirectoryOptions,
): string | null {
  const exists = options.exists ?? existsSync
  const stat = options.stat ?? statSync
  const canonicalize = options.canonicalize ?? realpathSync.native
  const cwd = options.cwd ?? process.cwd()
  const args = argv.slice(options.defaultApp ? 2 : 1)

  for (const arg of args) {
    if (!arg || arg.startsWith("-") || arg.includes("://")) continue
    const candidate = resolve(cwd, arg)
    if (!exists(candidate)) continue
    try {
      if (stat(candidate).isDirectory()) return canonicalize(candidate)
    } catch {
      // Ignore a path that disappeared or became unreadable while parsing.
    }
  }
  return null
}

export function queueLaunchDirectoryFromArgv(
  argv: readonly string[],
  options: LaunchDirectoryOptions,
): string | null {
  const directory = resolveLaunchDirectoryFromArgv(argv, options)
  if (directory) pendingLaunchDirectories.push(directory)
  return directory
}

export function takePendingLaunchDirectory(): string | null {
  return pendingLaunchDirectories.shift() ?? null
}

export function buildSingleInstanceLaunchData(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): SingleInstanceLaunchData {
  const noFocus =
    env.FLAPSTACK_NO_FOCUS === "1" ||
    env.FLAPSTACK_START_MINIMIZED === "1" ||
    argv.includes("--no-focus") ||
    argv.includes("--start-minimized")
  return noFocus ? { flapstackNoFocus: true } : {}
}

export function dispatchSecondInstanceLaunch(input: {
  commandLine: readonly string[]
  defaultApp: boolean
  workingDirectory?: string
  additionalData?: SingleInstanceLaunchData | null
  windows: readonly LaunchWindow[]
  createWindow(): void
}): { directory: string | null; activated: boolean } {
  const directory = queueLaunchDirectoryFromArgv(input.commandLine, {
    defaultApp: input.defaultApp,
    cwd: input.workingDirectory,
  })
  const target = input.windows[0]
  const shouldActivate =
    input.additionalData?.flapstackNoFocus !== true &&
    !input.commandLine.includes("--no-focus") &&
    !input.commandLine.includes("--start-minimized")

  if (target && directory) target.webContents.send(CLI_OPEN_DIRECTORY_CHANNEL)
  if (target && shouldActivate) {
    if (target.isMinimized()) target.restore()
    target.focus()
    return { directory, activated: true }
  }
  if (!target && shouldActivate) {
    input.createWindow()
    return { directory, activated: true }
  }
  return { directory, activated: false }
}

export function clearPendingLaunchDirectoriesForTests(): void {
  pendingLaunchDirectories.length = 0
}
