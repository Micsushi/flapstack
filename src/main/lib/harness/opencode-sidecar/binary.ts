/**
 * OpenCode binary resolution (Track E - E2).
 *
 * Resolution strategy (documented update policy per E2): prefer an explicit
 * `FLAPSTACK_OPENCODE_BIN` override, then a resolvable `opencode` on PATH, then
 * fall back to `npx -y opencode-ai@<pinned>`. Pinning the npx version keeps
 * harness behavior reproducible.
 *
 * Scaffolding stage: PATH/override detection is real and testable; the pinned
 * version constant is the single place to bump the engine.
 */

import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

/** Pinned OpenCode version used when falling back to npx. Bump deliberately. */
export const PINNED_OPENCODE_VERSION = "1.17.18"

export type OpencodeBinaryResolution =
  | { kind: "explicit"; command: string; args: string[] }
  | { kind: "path"; command: string; args: string[] }
  | { kind: "npx"; command: string; args: string[] }
  | { kind: "missing"; reason: string }

function isExecutableOnPath(binName: string): string | null {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]
  for (const dir of executableSearchDirs()) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, binName + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Finder-launched macOS apps inherit a minimal PATH. Search the common package
 * manager and user CLI locations used by OpenCode/Node as explicit fallbacks. */
export function executableSearchDirs(): string[] {
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  if (process.platform !== "darwin") return [...new Set(pathDirs)]
  const home = homedir()
  return [
    ...new Set([
      ...pathDirs,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(home, ".opencode", "bin"),
      join(home, ".local", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".npm-global", "bin"),
    ]),
  ]
}

/**
 * Resolve how to launch OpenCode. Returns the base command + args to which the
 * launcher appends `serve --hostname 127.0.0.1 --port 0`.
 */
export function resolveOpencodeBinary(): OpencodeBinaryResolution {
  const override = process.env.FLAPSTACK_OPENCODE_BIN?.trim()
  if (override) {
    if (existsSync(override)) {
      return { kind: "explicit", command: override, args: [] }
    }
    return {
      kind: "missing",
      reason: `FLAPSTACK_OPENCODE_BIN points to a non-existent path: ${override}`,
    }
  }

  const onPath = isExecutableOnPath("opencode")
  if (onPath) {
    return { kind: "path", command: onPath, args: [] }
  }

  const npx = isExecutableOnPath("npx")
  if (npx) {
    return {
      kind: "npx",
      command: npx,
      args: ["-y", `opencode-ai@${PINNED_OPENCODE_VERSION}`],
    }
  }

  return {
    kind: "missing",
    reason:
      "The provider runtime is unavailable and npx (Node.js) is not installed. Install Node.js and retry.",
  }
}

export function serveArgs(): string[] {
  return ["serve", "--hostname", "127.0.0.1", "--port", "0"]
}

export type OpencodeCliResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

export class OpencodeCliTimeoutError extends Error {
  constructor(args: string[], timeoutMs: number) {
    super(`Provider runtime command ${args.join(" ")} timed out after ${timeoutMs}ms`)
    this.name = "OpencodeCliTimeoutError"
  }
}

/** Run a bounded, short-lived OpenCode capability command. */
export async function runOpencodeCli(
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<OpencodeCliResult> {
  const resolution = resolveOpencodeBinary()
  if (resolution.kind === "missing") throw new Error(resolution.reason)
  const timeoutMs = options.timeoutMs ?? 15_000
  return await new Promise((resolve, reject) => {
    const child = spawn(resolution.command, [...resolution.args, ...args], {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const clearTimers = () => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
    }
    const append = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-1_000_000)
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM")
        else child.kill("SIGTERM")
      } catch {
        child.kill("SIGKILL")
      }
      forceKillTimer = setTimeout(() => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL")
          else child.kill("SIGKILL")
        } catch {
          // Already exited.
        }
      }, 1_000)
    }, timeoutMs)
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimers()
      reject(timedOut ? new OpencodeCliTimeoutError(args, timeoutMs) : error)
    })
    child.once("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimers()
      if (timedOut) reject(new OpencodeCliTimeoutError(args, timeoutMs))
      else resolve({ stdout, stderr, exitCode })
    })
  })
}
