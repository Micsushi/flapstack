import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const script = resolve("scripts/with-ui-lock.mjs")
const cleanupPaths: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()

function tempLockPath() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-ui-lock-test-"))
  cleanupPaths.push(directory)
  return join(directory, "shared.lock")
}

function spawnLock(lockPath: string, label: string, command: string) {
  const child = spawn(process.execPath, [script, label, "--", process.execPath, "-e", command], {
    env: {
      ...process.env,
      FLAPSTACK_UI_LOCK_PATH: lockPath,
      FLAPSTACK_UI_LOCK_POLL_MS: "20",
      FLAPSTACK_UI_LOCK_INCOMPLETE_GRACE_MS: "50",
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  children.add(child)
  child.on("exit", () => children.delete(child))
  return child
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string) {
  return new Promise<void>((resolvePromise, reject) => {
    let output = ""
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 3_000)
    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
      if (output.includes(expected)) {
        clearTimeout(timeout)
        resolvePromise()
      }
    })
    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
    })
  })
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<number | null>((resolvePromise) => {
    child.on("exit", (code) => resolvePromise(code))
  })
}

afterEach(() => {
  for (const child of children) child.kill("SIGKILL")
  children.clear()
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("shared UI lock", () => {
  it("waits until the current UI holder exits", async () => {
    const lockPath = tempLockPath()
    const first = spawnLock(lockPath, "first-lane", "setTimeout(() => {}, 250)")
    await waitForOutput(first, "UI lock acquired")

    const second = spawnLock(lockPath, "second-lane", "console.log('SECOND_STARTED')")
    await waitForOutput(second, "Waiting for Flapstack UI lock")

    let secondStarted = false
    second.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("SECOND_STARTED")) secondStarted = true
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    expect(secondStarted).toBe(false)

    expect(await waitForExit(first)).toBe(0)
    await waitForOutput(second, "SECOND_STARTED")
    expect(await waitForExit(second)).toBe(0)
  })

  it("recovers a lock whose owner process is dead", () => {
    const lockPath = tempLockPath()
    mkdirSync(lockPath)
    writeFileSync(
      join(lockPath, "owner.json"),
      `${JSON.stringify({ pid: 2_147_483_647, label: "dead-lane", token: "dead" })}\n`,
    )

    const result = spawnSync(
      process.execPath,
      [script, "recovery-lane", "--", process.execPath, "-e", "console.log('RECOVERED')"],
      {
        encoding: "utf8",
        env: { ...process.env, FLAPSTACK_UI_LOCK_PATH: lockPath },
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("UI lock acquired")
    expect(result.stdout).toContain("RECOVERED")
  })
})
