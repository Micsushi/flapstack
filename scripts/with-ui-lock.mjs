#!/usr/bin/env node

import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

const args = process.argv.slice(2)
const statusOnly = args.length === 1 && args[0] === "--status"
const separatorIndex = args.indexOf("--")
const label = statusOnly ? null : args[0]
const command = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1)

if (
  !statusOnly &&
  (!label || (separatorIndex !== -1 && (separatorIndex !== 1 || command.length === 0)))
) {
  console.error("Usage: node scripts/with-ui-lock.mjs <label> [-- <command> [args...]]")
  console.error("       node scripts/with-ui-lock.mjs --status")
  process.exit(2)
}

const lockPath = process.env.FLAPSTACK_UI_LOCK_PATH ?? join(tmpdir(), "flapstack-ui.lock")
const ownerPath = join(lockPath, "owner.json")
const ownerToken = process.env.FLAPSTACK_UI_LOCK_TOKEN
const pollMs = positiveInteger(process.env.FLAPSTACK_UI_LOCK_POLL_MS, 1_000)
const incompleteLockGraceMs = positiveInteger(
  process.env.FLAPSTACK_UI_LOCK_INCOMPLETE_GRACE_MS,
  5_000,
)

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function readLock() {
  try {
    return JSON.parse(readFileSync(ownerPath, "utf8"))
  } catch {
    return null
  }
}

function lockAgeMs() {
  try {
    return Date.now() - statSync(lockPath).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
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

function describeLock(lock) {
  if (!lock) return "an owner that is still starting"

  const cwd = lock.cwd ? ` in ${basename(lock.cwd)}` : ""
  return `${lock.label ?? "UI work"}${cwd} (pid ${lock.pid ?? "unknown"})`
}

function liveLock() {
  const lock = readLock()
  if (lock && pidIsAlive(lock.pid)) return lock

  if (!lock && lockAgeMs() < incompleteLockGraceMs) return undefined

  rmSync(lockPath, { recursive: true, force: true })
  return null
}

if (statusOnly) {
  const lock = liveLock()
  if (lock === null) {
    console.log("Flapstack UI lock is free.")
  } else {
    console.log(`Flapstack UI lock is held by ${describeLock(lock)}.`)
  }
  process.exit(0)
}

const existingLock = readLock()

if (ownerToken && existingLock?.token === ownerToken) {
  runCommandOrLease()
} else {
  await acquireAndRun()
}

async function acquireAndRun() {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let lastDescription = null

  while (true) {
    try {
      mkdirSync(lockPath)
      break
    } catch (error) {
      if (error?.code !== "EEXIST") throw error

      const lock = liveLock()
      if (lock === null) continue

      const description = describeLock(lock)
      if (description !== lastDescription) {
        console.log(`Waiting for Flapstack UI lock held by ${description}...`)
        lastDescription = description
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  const lock = {
    pid: process.pid,
    label,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
    token,
  }
  writeFileSync(ownerPath, `${JSON.stringify(lock, null, 2)}\n`)

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true

    const currentLock = readLock()
    if (currentLock?.token === token) {
      rmSync(lockPath, { recursive: true, force: true })
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

  console.log(`Flapstack UI lock acquired by ${label} (pid ${process.pid}).`)
  runCommandOrLease({ cleanup, token })
}

function runCommandOrLease(options = {}) {
  const cleanup = options.cleanup ?? (() => {})

  if (command.length === 0) {
    console.log("Holding UI lease. Press Ctrl-C to release it.")
    setInterval(() => {}, 60_000)
    return
  }

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...(options.token ? { FLAPSTACK_UI_LOCK_TOKEN: options.token } : {}),
    },
  })

  child.on("error", (error) => {
    console.error(`Failed to start UI command: ${error.message}`)
    cleanup()
    process.exit(1)
  })

  child.on("exit", (code, signal) => {
    cleanup()
    if (signal) {
      process.exit(signal === "SIGINT" ? 130 : 143)
      return
    }

    process.exit(code ?? 1)
  })
}
