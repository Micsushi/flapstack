import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { accessSync, constants, existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

const require = createRequire(import.meta.url)

// Lazy so that importing this module (e.g. in unit tests) does not eagerly load
// `../claude/env`, which reads Electron `app.isPackaged` at module scope.
function getShellEnvironment(): Record<string, string | undefined> {
  try {
    const mod = require("../claude/env") as {
      getClaudeShellEnvironment: () => Record<string, string | undefined>
    }
    return mod.getClaudeShellEnvironment()
  } catch {
    return {}
  }
}

/**
 * Locate the `cursor-agent` CLI (Stage 2 Track D).
 *
 * Unlike Codex/Claude, Flapstack does NOT bundle cursor-agent — it is an
 * externally-installed CLI (the D0 dev machine has it at `~/.local/bin`).
 * Resolution order: an explicit override env var, then common install dirs,
 * then a PATH scan using the shell-derived environment so it matches what the
 * user sees in their terminal. Returns null (honest absence) when not found.
 */

const BINARY_NAME = process.platform === "win32" ? "cursor-agent.exe" : "cursor-agent"

export function buildCursorEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value
  }
  const shellEnv = getShellEnvironment()
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value === "string") env[key] = value
  }
  return env
}

function commonInstallDirs(): string[] {
  const home = homedir()
  return [
    join(home, ".local", "bin"),
    join(home, ".cursor", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ]
}

export function resolveCursorAgentBinary(): string | null {
  const override = process.env.FLAPSTACK_CURSOR_AGENT_PATH?.trim()
  if (override && isExecutable(override)) return override

  for (const dir of commonInstallDirs()) {
    const candidate = join(dir, BINARY_NAME)
    if (isExecutable(candidate)) return candidate
  }

  const pathValue = buildCursorEnv().PATH ?? process.env.PATH ?? ""
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, BINARY_NAME)
    if (isExecutable(candidate)) return candidate
  }

  return null
}

function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false
  if (process.platform === "win32") return true
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export class CursorAgentNotFoundError extends Error {
  constructor() {
    super(
      "cursor-agent CLI not found. Install it (https://cursor.com/cli) or set FLAPSTACK_CURSOR_AGENT_PATH, then reconnect Cursor in Settings.",
    )
    this.name = "CursorAgentNotFoundError"
  }
}

export class CursorCliTimeoutError extends Error {
  constructor(args: string[], timeoutMs: number) {
    super(`\`cursor-agent ${args.join(" ")}\` timed out after ${timeoutMs}ms`)
    this.name = "CursorCliTimeoutError"
  }
}

export type CursorCliResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

/** Run a short-lived cursor-agent command (status/login/models). */
export async function runCursorCli(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<CursorCliResult> {
  const binary = resolveCursorAgentBinary()
  if (!binary) throw new CursorAgentNotFoundError()

  const cwd = options?.cwd?.trim()
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: buildCursorEnv(),
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    let forceKillTimeout: ReturnType<typeof setTimeout> | null = null
    const clearTimers = () => {
      if (timeout) clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
    }
    const timeout = options?.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill("SIGTERM")
          forceKillTimeout = setTimeout(() => {
            child.kill("SIGKILL")
          }, 1_000)
        }, options.timeoutMs)
      : null

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimers()
      rejectPromise(
        timedOut && options?.timeoutMs
          ? new CursorCliTimeoutError(args, options.timeoutMs)
          : new Error(`Failed to execute \`cursor-agent ${args.join(" ")}\`: ${error.message}`),
      )
    })
    child.once("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimers()
      if (timedOut && options?.timeoutMs) {
        rejectPromise(new CursorCliTimeoutError(args, options.timeoutMs))
        return
      }
      resolvePromise({ stdout, stderr, exitCode })
    })
  })
}
