import { randomUUID } from "node:crypto"
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

const STOP_REQUEST_FILE = "usage-daemon.stop"

export function usageDaemonStopRequestPath(configDir: string): string {
  return join(configDir, STOP_REQUEST_FILE)
}

export function requestUsageDaemonStop(configDir: string): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const target = usageDaemonStopRequestPath(configDir)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  const fd = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify({ version: 1, requestedAt: Date.now() })}\n`)
  } finally {
    closeSync(fd)
  }
  rmSync(target, { force: true })
  renameSync(temporary, target)
}

export function clearUsageDaemonStopRequest(configDir: string): void {
  rmSync(usageDaemonStopRequestPath(configDir), { force: true })
}

export function consumeUsageDaemonStopRequest(configDir: string): boolean {
  const target = usageDaemonStopRequestPath(configDir)
  try {
    const value = JSON.parse(readFileSync(target, "utf8")) as { version?: unknown }
    if (value.version !== 1) return false
    clearUsageDaemonStopRequest(configDir)
    return true
  } catch {
    return false
  }
}

export function watchUsageDaemonStopRequests(
  configDir: string | undefined,
  stop: () => void,
  intervalMs = 100,
): () => void {
  if (!configDir) return () => {}
  let closed = false
  const poll = () => {
    if (closed || !consumeUsageDaemonStopRequest(configDir)) return
    stop()
  }
  const timer = setInterval(poll, Math.max(25, intervalMs))
  timer.unref?.()
  poll()
  return () => {
    if (closed) return
    closed = true
    clearInterval(timer)
  }
}
