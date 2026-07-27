import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { redactUsageDiagnostic } from "../src/main/lib/usage/diagnostics"
import { createDaemonSignalGate } from "../src/main/lib/usage-daemon"
import { acquireDaemonInstanceLock } from "../src/main/lib/usage-daemon/instance-lock"
import {
  consumeUsageDaemonStopRequest,
  requestUsageDaemonStop,
  watchUsageDaemonStopRequests,
} from "../src/main/lib/usage-daemon/stop-request"

const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flapstack-usage-daemon-lifecycle-"))
  dirs.push(dir)
  return dir
}

describe("usage daemon lifecycle", () => {
  it("defers an early shutdown signal until startup is ready", () => {
    const shutdown = vi.fn()
    const signalGate = createDaemonSignalGate(shutdown)

    signalGate.onSignal()
    expect(shutdown).not.toHaveBeenCalled()

    signalGate.markReady()
    expect(shutdown).toHaveBeenCalledTimes(1)

    signalGate.markReady()
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it("allows one owner and releases only its own lock", () => {
    const dir = tempDir()
    const first = acquireDaemonInstanceLock(dir, () => 100)
    expect(JSON.parse(readFileSync(first.path, "utf8"))).toMatchObject({
      version: 1,
      pid: process.pid,
      startedAt: 100,
    })
    expect(() => acquireDaemonInstanceLock(dir, () => 101)).toThrow(/already running/)
    first.release()
    const replacement = acquireDaemonInstanceLock(dir, () => 102)
    first.release()
    expect(readFileSync(replacement.path, "utf8")).toContain('"startedAt":102')
    replacement.release()
  })

  it("recovers a dead owner but preserves a fresh incomplete lock", () => {
    const dir = tempDir()
    const path = join(dir, "usage-daemon.lock")
    writeFileSync(path, JSON.stringify({ version: 1, pid: 2_147_483_647, startedAt: 1 }))
    const recovered = acquireDaemonInstanceLock(dir, () => 200)
    recovered.release()

    writeFileSync(path, "")
    expect(() => acquireDaemonInstanceLock(dir, () => Date.now())).toThrow(/lock is busy/)
    const old = new Date(0)
    utimesSync(path, old, old)
    const recoveredIncomplete = acquireDaemonInstanceLock(dir, () => Date.now())
    recoveredIncomplete.release()
  })

  it("redacts provider, bearer, key, and webhook diagnostics", () => {
    const diagnostic = redactUsageDiagnostic(
      'Authorization: Bearer sk-supersecret123 api_key="key-supersecret456" https://discord.com/api/webhooks/123/tokenvalue',
    )
    expect(diagnostic).not.toContain("supersecret")
    expect(diagnostic).not.toContain("tokenvalue")
    expect(diagnostic).not.toContain("/123/")
    expect(diagnostic).toContain("[redacted]")
  })

  it("atomically requests, consumes, and watches graceful daemon shutdown", async () => {
    const dir = tempDir()
    requestUsageDaemonStop(dir)
    expect(consumeUsageDaemonStopRequest(dir)).toBe(true)
    expect(consumeUsageDaemonStopRequest(dir)).toBe(false)

    const stopped = vi.fn()
    const close = watchUsageDaemonStopRequests(dir, stopped, 25)
    requestUsageDaemonStop(dir)
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1))
    close()
  })
})
