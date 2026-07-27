import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const runLive =
  process.platform === "win32" && process.env.FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE === "1"
const electron = resolve("node_modules/electron/dist/electron.exe")
const fixture = resolve("tests/fixtures/windows-node-pty-electron.cjs")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

function invoke(shellKind: "powershell" | "cmd", behavior: "completion" | "cancellation") {
  const cwd = mkdtempSync(join(tmpdir(), `flapstack-node-pty-${shellKind}-雪 & ()-`))
  roots.push(cwd)
  const processResult = spawnSync(electron, [fixture, cwd, shellKind, behavior], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    timeout: 25_000,
  })
  const response = JSON.parse(processResult.stdout.trim().split(/\r?\n/).at(-1) ?? "{}")
  expect(processResult.status, processResult.stderr).toBe(0)
  expect(processResult.stderr).toBe("")
  return response
}

describe.runIf(runLive)("native Windows terminal profiles", () => {
  it.each(["powershell", "cmd"] as const)(
    "preserves configured %s cwd, env, UTF-8, input/output, exit, resize, and cancellation",
    (shellKind) => {
      const completion = invoke(shellKind, "completion")
      expect(completion).toMatchObject({
        shellKind,
        behavior: "completion",
        platform: "win32",
        arch: "x64",
      })
      expect(completion.result.exitCode, completion.result.output).toBe(17)
      expect(completion.result.output).toContain(`__FLAPSTACK_CWD__${completion.expectedCwd}`)
      expect(completion.result.output).toContain(
        `__FLAPSTACK_ENV__${completion.expectedEnvironment}`,
      )
      expect(completion.result.output).toContain("__FLAPSTACK_UNICODE__雪")
      expect(completion.result.output).toContain(`__FLAPSTACK_INPUT__${completion.expectedInput}`)
      expect(completion.result.output).toContain(
        shellKind === "powershell"
          ? "__FLAPSTACK_PROFILE__isolated-powershell"
          : "__FLAPSTACK_PROFILE__cmd-default",
      )

      const cancellation = invoke(shellKind, "cancellation")
      expect(cancellation.result.output).toContain("__FLAPSTACK_CANCEL_READY__")
      expect(cancellation.result.exitCode).not.toBe(0)
    },
  )
})
