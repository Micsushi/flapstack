import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

const LOCK_FILE_NAME = "usage-daemon.lock"
const INCOMPLETE_LOCK_STALE_MS = 5 * 60_000

type LockRecord = { version: 1; pid: number; startedAt: number }

export type DaemonInstanceLock = {
  path: string
  release(): void
}

function parseLock(path: string): LockRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockRecord>
    if (
      value.version === 1 &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.startedAt === "number"
    ) {
      return value as LockRecord
    }
  } catch {}
  return null
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Acquire one daemon owner per isolated config directory. A crash can leave
 * the file behind; a new process removes it only after proving the recorded
 * process is gone. */
export function acquireDaemonInstanceLock(
  configDir = process.env.FLAPSTACK_CONFIG_DIR,
  now = Date.now,
): DaemonInstanceLock {
  if (!configDir) {
    throw new Error("FLAPSTACK_CONFIG_DIR is not set; daemon ownership cannot be isolated")
  }
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const path = join(configDir, LOCK_FILE_NAME)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o600)
      const record: LockRecord = { version: 1, pid: process.pid, startedAt: now() }
      let writeError: unknown
      try {
        writeFileSync(fd, `${JSON.stringify(record)}\n`)
      } catch (error) {
        writeError = error
      } finally {
        closeSync(fd)
      }
      if (writeError) {
        try {
          unlinkSync(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        throw writeError
      }
      let released = false
      return {
        path,
        release() {
          if (released) return
          released = true
          const current = parseLock(path)
          if (current?.pid === process.pid && current.startedAt === record.startedAt) {
            try {
              unlinkSync(path)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            }
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const existing = parseLock(path)
      if (existing && processIsAlive(existing.pid)) {
        throw new Error(`Usage daemon is already running (pid ${existing.pid})`)
      }
      if (!existing) {
        let age: number
        try {
          age = now() - statSync(path).mtimeMs
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue
          throw statError
        }
        if (age < INCOMPLETE_LOCK_STALE_MS) {
          throw new Error("Usage daemon ownership lock is busy")
        }
      }
      try {
        unlinkSync(path)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError
      }
    }
  }
  throw new Error("Unable to acquire usage daemon ownership lock")
}
