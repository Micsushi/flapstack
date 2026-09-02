import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const script = resolve("scripts/with-heavy-job-lock.mjs")

function testLock(name: string) {
  const path = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}-${name}.lock`)
  rmSync(path, { force: true })
  return path
}

function testEnvironment(lockPath: string, additions: NodeJS.ProcessEnv = {}) {
  const env = {
    ...process.env,
    ...additions,
    FLAPSTACK_HEAVY_JOB_LOCK_PATH: lockPath,
  }
  delete env.FLAPSTACK_HEAVY_JOB_LOCK_TOKEN
  return env
}

async function waitForFile(path: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
}

function waitForExit(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child.once("exit", (code, signal) => resolvePromise({ code, signal }))
  })
}

function pidIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("shared heavy-job lock", () => {
  it("never unlinks the shared lock path from a stale-owner observation", () => {
    const source = readFileSync(script, "utf8")
    const staleBranch = source.slice(
      source.indexOf("const lock = readLock()"),
      source.indexOf("const lock = {"),
    )

    expect(staleBranch).toContain("quarantineStaleLock")
    expect(staleBranch).not.toContain("rmSync(lockPath")
  })

  it("reports a spawn failure and removes the exact acquired lock", () => {
    const missingCommand = resolve("tests", "fixtures", "missing-command.cmd")
    const lockPath = testLock("spawn-failure")
    const env = testEnvironment(lockPath)
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

  it("refuses a live or incompletely initialized lock and reclaims a stale owner", () => {
    const lockPath = testLock("contention-stale")
    const env = testEnvironment(lockPath)

    writeFileSync(lockPath, "", "utf8")
    const incomplete = spawnSync(
      process.execPath,
      [script, "contender", "--", process.execPath, "-e", "process.exit(0)"],
      { encoding: "utf8", env },
    )
    expect(incomplete.status).toBe(75)
    expect(existsSync(lockPath)).toBe(true)

    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2_147_483_647, label: "stale-owner", token: "stale-token" }),
      "utf8",
    )
    const recovered = spawnSync(
      process.execPath,
      [script, "recovery", "--", process.execPath, "-e", "process.exit(0)"],
      { encoding: "utf8", env },
    )
    expect(recovered.status, recovered.stderr).toBe(0)
    expect(existsSync(lockPath)).toBe(false)
  })

  it("fails closed instead of spinning on an expired malformed lock", () => {
    const lockPath = testLock("malformed-stale")
    writeFileSync(lockPath, "not-json", "utf8")
    const old = new Date(Date.now() - 10_000)
    utimesSync(lockPath, old, old)

    const contender = spawnSync(
      process.execPath,
      [script, "contender", "--", process.execPath, "-e", "process.exit(0)"],
      { encoding: "utf8", env: testEnvironment(lockPath), timeout: 2_000 },
    )

    expect(contender.status).toBe(75)
    expect(contender.stderr).toContain("cannot be reclaimed safely")
    expect(existsSync(lockPath)).toBe(true)
    rmSync(lockPath, { force: true })
  })

  it.runIf(process.platform === "win32")(
    "resolves a Windows cmd shim through PATH without interpreting shell-sensitive arguments",
    () => {
      const lockPath = testLock("cmd-shim")
      const marker = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}-shim.json`)
      const shimDirectory = join(
        tmpdir(),
        `flapstack-heavy-job-test-${process.pid}-shim space 雪 & (safe) 100%`,
        "node_modules",
        ".bin",
      )
      const shim = join(shimDirectory, "fixture-heavy-command.cmd")
      const capture = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}-capture.cjs`)
      const expected = ["space value", "ampersand &", "parentheses (safe)", "100%", 'say "hi"']
      rmSync(marker, { force: true })
      rmSync(capture, { force: true })
      rmSync(shimDirectory, { recursive: true, force: true })
      mkdirSync(shimDirectory, { recursive: true })
      writeFileSync(
        capture,
        'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))\n',
        "utf8",
      )
      writeFileSync(
        shim,
        `@echo off\r\n"${process.execPath}" "${capture}" %*\r\nexit /b 23\r\n`,
        "utf8",
      )
      const env = testEnvironment(lockPath, {
        PATH: `${shimDirectory};${process.env.PATH ?? process.env.Path ?? ""}`,
      })

      const result = spawnSync(
        process.execPath,
        [script, "cmd-shim", "--", "fixture-heavy-command", marker, ...expected],
        { encoding: "utf8", env },
      )

      expect(result.status, result.stderr).toBe(23)
      expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual(expected)
      expect(existsSync(lockPath)).toBe(false)
      rmSync(marker, { force: true })
      rmSync(capture, { force: true })
      rmSync(join(shimDirectory, "..", ".."), { recursive: true, force: true })
    },
  )

  it.runIf(process.platform === "win32")(
    "resolves an exe through PATH and preserves the complete argument corpus",
    () => {
      const lockPath = testLock("exe-shim")
      const output = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}-exe.json`)
      const expected = [
        "space value",
        "Unicode 雪",
        "ampersand &",
        "parentheses (safe)",
        "100%",
        'say "hi"',
      ]
      const source =
        'require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))'
      rmSync(output, { force: true })
      const env = testEnvironment(lockPath, {
        PATH: `${dirname(process.execPath)};${process.env.PATH ?? process.env.Path ?? ""}`,
      })

      const result = spawnSync(
        process.execPath,
        [script, "exe-shim", "--", basename(process.execPath), "-e", source, output, ...expected],
        { encoding: "utf8", env },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(expected)
      expect(existsSync(lockPath)).toBe(false)
      rmSync(output, { force: true })
    },
  )

  it("propagates interruption to the child before releasing the lock", async () => {
    const lockPath = testLock("cancellation")
    const readyPath = join(tmpdir(), `flapstack-heavy-job-test-${process.pid}-ready.json`)
    const signalPreload = join(
      tmpdir(),
      `flapstack-heavy-job-test-${process.pid}-signal-preload.cjs`,
    )
    const childSignalPath = join(
      tmpdir(),
      `flapstack-heavy-job-test-${process.pid}-child-signal.txt`,
    )
    const signalTriggerPath = join(
      tmpdir(),
      `flapstack-heavy-job-test-${process.pid}-signal-trigger.txt`,
    )
    rmSync(readyPath, { force: true })
    rmSync(childSignalPath, { force: true })
    rmSync(signalTriggerPath, { force: true })
    writeFileSync(
      signalPreload,
      [
        'const { existsSync } = require("node:fs")',
        'if (process.argv[1]?.endsWith("with-heavy-job-lock.mjs")) {',
        `  const trigger = ${JSON.stringify(signalTriggerPath)}`,
        '  const timer = setInterval(() => { if (existsSync(trigger)) { clearInterval(timer); process.emit("SIGTERM") } }, 25)',
        "}",
      ].join("\n"),
      "utf8",
    )
    const env = testEnvironment(lockPath, {
      NODE_OPTIONS: `--require=${signalPreload}`,
    })
    const childSource = [
      'const { writeFileSync } = require("node:fs")',
      'const { spawn } = require("node:child_process")',
      'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: process.platform === "win32", stdio: "ignore", windowsHide: true })',
      "writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, grandchildPid: grandchild.pid }))",
      'process.on("SIGTERM", () => { writeFileSync(process.argv[2], "SIGTERM"); process.exit(0) })',
      "setInterval(() => {}, 1_000)",
    ].join(";")
    const wrapper = spawn(
      process.execPath,
      [
        script,
        "cancellation",
        "--",
        process.execPath,
        "-e",
        childSource,
        readyPath,
        childSignalPath,
      ],
      { env, stdio: "ignore" },
    )
    let ownedPid = 0
    let grandchildPid = 0

    try {
      await waitForFile(readyPath)
      const ready = JSON.parse(readFileSync(readyPath, "utf8"))
      ownedPid = ready.pid
      grandchildPid = ready.grandchildPid
      expect(pidIsAlive(ownedPid)).toBe(true)
      expect(pidIsAlive(grandchildPid)).toBe(true)
      const contender = spawnSync(
        process.execPath,
        [script, "contender", "--", process.execPath, "-e", "process.exit(0)"],
        { encoding: "utf8", env: testEnvironment(lockPath) },
      )
      expect(contender.status).toBe(75)
      expect(contender.stderr).toContain("cancellation")
      expect(pidIsAlive(ownedPid)).toBe(true)
      const exited = waitForExit(wrapper)
      writeFileSync(signalTriggerPath, "terminate", "utf8")
      expect(await exited).toMatchObject({ code: 143 })
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      if (process.platform !== "win32") {
        expect(readFileSync(childSignalPath, "utf8")).toBe("SIGTERM")
      }
      expect(pidIsAlive(ownedPid)).toBe(false)
      expect(pidIsAlive(grandchildPid)).toBe(false)
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      if (pidIsAlive(wrapper.pid ?? 0)) wrapper.kill("SIGKILL")
      if (ownedPid && pidIsAlive(ownedPid)) process.kill(ownedPid, "SIGKILL")
      if (grandchildPid && pidIsAlive(grandchildPid)) process.kill(grandchildPid, "SIGKILL")
      rmSync(readyPath, { force: true })
      rmSync(childSignalPath, { force: true })
      rmSync(signalTriggerPath, { force: true })
      rmSync(signalPreload, { force: true })
      rmSync(lockPath, { force: true })
    }
  })
})
