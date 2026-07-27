#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path"

const WINDOWS_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g
const [, , label, separator, ...command] = process.argv

if (!label || separator !== "--" || command.length === 0) {
  console.error("Usage: node scripts/with-heavy-job-lock.mjs <label> -- <command> [args...]")
  process.exit(2)
}

const defaultLockPath = join(tmpdir(), "flapstack-heavy-job.lock")
const requestedLockPath = process.env.FLAPSTACK_HEAVY_JOB_LOCK_PATH
const lockPath = requestedLockPath ? resolve(requestedLockPath) : defaultLockPath
if (
  requestedLockPath &&
  (dirname(lockPath) !== resolve(tmpdir()) ||
    !basename(lockPath).startsWith("flapstack-heavy-job-test-") ||
    !basename(lockPath).endsWith(".lock"))
) {
  console.error(
    "FLAPSTACK_HEAVY_JOB_LOCK_PATH must be a test lock inside the system temp directory.",
  )
  process.exit(2)
}
const ownerToken = process.env.FLAPSTACK_HEAVY_JOB_LOCK_TOKEN
const incompleteLockGraceMs = 5_000

function readLock() {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"))
  } catch {
    return null
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

function lockAgeMs() {
  try {
    return Date.now() - statSync(lockPath).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function describeLock(lock) {
  if (!lock) return "an owner that is still starting"

  const cwd = lock.cwd ? ` in ${basename(lock.cwd)}` : ""
  return `${lock.label ?? "heavy job"}${cwd} (pid ${lock.pid ?? "unknown"})`
}

const existingLock = readLock()

if (ownerToken && existingLock?.token === ownerToken) {
  runCommand()
} else {
  acquireAndRun()
}

function acquireAndRun() {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let fd

  while (true) {
    try {
      fd = openSync(lockPath, "wx")
      break
    } catch (error) {
      if (error?.code !== "EEXIST") throw error

      const lock = readLock()
      if ((lock && pidIsAlive(lock.pid)) || (!lock && lockAgeMs() < incompleteLockGraceMs)) {
        console.error(`Another Flapstack heavy job is already running: ${describeLock(lock)}.`)
        console.error(
          "Wait for it to finish, or stop that job before starting another build/check.",
        )
        process.exit(75)
      }

      rmSync(lockPath, { force: true })
    }
  }

  const lock = {
    pid: process.pid,
    label,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
    token,
  }

  writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`)

  const cleanup = () => {
    const currentLock = readLock()
    if (currentLock?.token === token) {
      rmSync(lockPath, { force: true })
    }
  }

  process.on("exit", cleanup)

  runCommand({ cleanup, token })
}

function escapeWindowsCommand(value) {
  return value.replace(WINDOWS_META_CHARACTERS, "^$1")
}

function escapeWindowsArgument(value, doubleEscapeMetaCharacters) {
  let escaped = String(value)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1")
  escaped = `"${escaped}"`.replace(WINDOWS_META_CHARACTERS, "^$1")
  return doubleEscapeMetaCharacters ? escaped.replace(WINDOWS_META_CHARACTERS, "^$1") : escaped
}

function windowsPathValue(env) {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path")
  return key ? (env[key] ?? "") : ""
}

function resolveWindowsCommand(commandName, env, cwd) {
  const hasPath = commandName.includes("/") || commandName.includes("\\")
  const roots = hasPath
    ? [""]
    : [
        cwd,
        ...windowsPathValue(env)
          .split(delimiter)
          .filter((entry) => entry.length > 0),
      ]
  const pathExtensions =
    extname(commandName).length > 0
      ? [""]
      : (env.PATHEXT ?? ".COM;.EXE;.CMD;.BAT").split(";").filter((entry) => entry.length > 0)

  for (const root of roots) {
    const base = hasPath
      ? isAbsolute(commandName)
        ? commandName
        : resolve(cwd, commandName)
      : join(root.replace(/^"(.*)"$/, "$1"), commandName)
    for (const extension of pathExtensions) {
      const candidate = `${base}${extension}`
      if (existsSync(candidate)) return resolve(candidate)
    }
  }
  return commandName
}

function commandSpawn(commandName, args, env) {
  if (process.platform !== "win32") {
    return { command: commandName, args, options: {} }
  }

  const resolved = resolveWindowsCommand(commandName, env, process.cwd())
  if (!existsSync(resolved) || !/\.(?:cmd|bat)$/i.test(resolved)) {
    return { command: resolved, args, options: {} }
  }

  const doubleEscapeMetaCharacters = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved)
  const commandLine = [
    escapeWindowsCommand(resolved),
    ...args.map((argument) => escapeWindowsArgument(argument, doubleEscapeMetaCharacters)),
  ].join(" ")
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
  const commandShell = systemRoot
    ? join(systemRoot, "System32", "cmd.exe")
    : (env.ComSpec ?? env.COMSPEC ?? "cmd.exe")
  return {
    command: commandShell,
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    options: { windowsVerbatimArguments: true },
  }
}

function runCommand(options = {}) {
  const cleanup = options.cleanup ?? (() => {})
  const env = {
    ...process.env,
    ...(options.token ? { FLAPSTACK_HEAVY_JOB_LOCK_TOKEN: options.token } : {}),
  }
  const launch = commandSpawn(command[0], command.slice(1), env)

  let child
  try {
    child = spawn(launch.command, launch.args, {
      stdio: "inherit",
      shell: false,
      env,
      detached: process.platform !== "win32",
      ...launch.options,
    })
  } catch (error) {
    console.error(`Failed to start heavy-job command: ${error.message}`)
    cleanup()
    process.exit(1)
  }

  child.on("error", (error) => {
    console.error(`Failed to start heavy-job command: ${error.message}`)
    cleanup()
    process.exit(1)
  })

  let requestedSignal = null
  let forceTimer = null
  const terminateChild = (signal, force = false) => {
    if (process.platform === "win32" && child.pid) {
      const result = spawnSync(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
        { stdio: "ignore", windowsHide: true },
      )
      return !result.error && result.status === 0
    }
    if (!child.pid) return false
    try {
      process.kill(-child.pid, force ? "SIGKILL" : signal)
      return true
    } catch {
      return false
    }
  }
  const forwardSignal = (signal) => {
    if (requestedSignal) return
    requestedSignal = signal
    if (child.exitCode === null && child.signalCode === null) {
      if (!terminateChild(signal) && process.platform === "win32") {
        terminateChild(signal, true)
      }
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) terminateChild(signal, true)
      }, 5_000)
      forceTimer.unref()
    }
  }
  process.once("SIGINT", () => forwardSignal("SIGINT"))
  process.once("SIGTERM", () => forwardSignal("SIGTERM"))
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => forwardSignal("SIGBREAK"))
  }

  child.on("exit", (code, signal) => {
    if (forceTimer) clearTimeout(forceTimer)
    cleanup()
    if (requestedSignal) {
      process.exit(requestedSignal === "SIGINT" ? 130 : requestedSignal === "SIGBREAK" ? 131 : 143)
      return
    }
    if (signal) {
      process.exit(signal === "SIGINT" ? 130 : 143)
      return
    }

    process.exit(code ?? 1)
  })
}
