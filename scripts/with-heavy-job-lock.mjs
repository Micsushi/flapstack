#!/usr/bin/env node

import { spawn } from "node:child_process"
import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

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
  } catch {
    return false
  }
}

function describeLock(lock) {
  if (!lock) return "unknown process"

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
      if (lock && pidIsAlive(lock.pid)) {
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
  process.on("SIGINT", () => {
    cleanup()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(143)
  })

  runCommand({ cleanup, token })
}

function runCommand(options = {}) {
  const cleanup = options.cleanup ?? (() => {})

  let child
  try {
    child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        ...(options.token ? { FLAPSTACK_HEAVY_JOB_LOCK_TOKEN: options.token } : {}),
      },
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

  child.on("exit", (code, signal) => {
    if (signal) {
      cleanup()
      process.exit(signal === "SIGINT" ? 130 : 143)
      return
    }

    process.exit(code ?? 1)
  })
}
