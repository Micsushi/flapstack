import { spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const script = resolve("scripts/with-heavy-job-lock.mjs")

describe("shared heavy-job lock", () => {
  it("reports a spawn failure and removes the exact acquired lock", () => {
    const missingCommand = resolve("tests", "fixtures", "missing-command.cmd")
    const lockPath = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}.lock`)
    rmSync(lockPath, { force: true })
    const env = { ...process.env, FLAPSTACK_HEAVY_JOB_LOCK_PATH: lockPath }
    delete env.FLAPSTACK_HEAVY_JOB_LOCK_TOKEN
    const first = spawnSync(
      process.execPath,
      [script, "missing-command-test", "--", missingCommand],
      { encoding: "utf8", env },
    )

    expect(first.status).toBe(1)
    expect(first.stderr).toContain("Failed to start heavy-job command")
    expect(existsSync(lockPath)).toBe(false)

    const second = spawnSync(
      process.execPath,
      [script, "follow-up-test", "--", process.execPath, "-e", "process.exit(0)"],
      { encoding: "utf8", env },
    )
    expect(second.status).toBe(0)
    expect(existsSync(lockPath)).toBe(false)
  })
})
