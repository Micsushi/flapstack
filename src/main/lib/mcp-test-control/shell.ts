import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import type { ShellResult } from "./types"

const execFileAsync = promisify(execFile)

export const BUNDLED_NODE_DIR = process.env.FLAPSTACK_BUNDLED_NODE_DIR ?? null

export function getBundledNodePathPrefix(): string | null {
  if (!BUNDLED_NODE_DIR) return null
  return existsSync(join(BUNDLED_NODE_DIR, process.platform === "win32" ? "node.exe" : "node"))
    ? BUNDLED_NODE_DIR
    : null
}

export function withRecommendedNodePath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nodePrefix = getBundledNodePathPrefix()
  if (!nodePrefix) return env

  return {
    ...env,
    PATH: `${nodePrefix}:${env.PATH || ""}`,
  }
}

export async function runShellCommand(
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
  },
): Promise<ShellResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30_000,
      env: options.env ?? process.env,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    })

    return {
      command,
      args,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string
      stdout?: string
      stderr?: string
      killed?: boolean
      signal?: string
    }

    return {
      command,
      args,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      timedOut: Boolean(err.killed || err.signal === "SIGTERM"),
    }
  }
}

export async function resolveCommandPath(command: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9._-]+$/.test(command)) {
    return null
  }

  const lookupCommand = process.platform === "win32" ? "where" : "which"
  const result = await runShellCommand(lookupCommand, [command], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  })
  const resolved = result.stdout.trim().split("\n")[0]?.trim()
  return resolved || null
}

export function redactShellResult(result: ShellResult): ShellResult {
  return {
    ...result,
    stdout: redactSecretLikeText(result.stdout),
    stderr: redactSecretLikeText(result.stderr),
  }
}

export function redactSecretLikeText(value: string): string {
  return value
    .replace(/(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/oauth[_-]?token["':=\s]+[A-Za-z0-9._-]+/gi, "oauth_token=[redacted]")
}
