import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { nativeAbiMarker } from "../scripts/native-abi-key.mjs"
import {
  nativeAbiAction,
  nativeElectronRecoverySteps,
  nativeRebuildSteps,
  probeNativeModules,
  windowsPython311Environment,
} from "../scripts/ensure-native-abi.mjs"
import { runBuilder } from "../scripts/package-app.mjs"

describe("native ABI marker", () => {
  it("pins Windows native rebuilds to the supported Python 3.11 launcher", () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const environment = windowsPython311Environment({
      platform: "win32",
      spawn: (command: string, args: string[]) => {
        calls.push({ command, args })
        return {
          status: 0,
          stdout: "C:\\Python311\\python.exe\r\n",
          stderr: "",
        }
      },
    })

    expect(calls).toEqual([
      {
        command: "py.exe",
        args: ["-3.11", "-c", "import sys; print(sys.executable)"],
      },
    ])
    expect(environment).toEqual({
      NODE_GYP_FORCE_PYTHON: "C:\\Python311\\python.exe",
      PYTHON: "C:\\Python311\\python.exe",
      npm_config_python: "C:\\Python311\\python.exe",
    })
  })

  it("uses JavaScript tool entrypoints for native rebuilds on Windows", () => {
    const electronSteps = nativeRebuildSteps("electron", { root: process.cwd() })
    expect(electronSteps).toHaveLength(1)
    expect(electronSteps[0]).toMatchObject({
      command: process.execPath,
      args: expect.arrayContaining(["-f", "-w", "better-sqlite3,node-pty"]),
    })
    expect(electronSteps[0].args[0]).toMatch(/[\\/]@electron[\\/]rebuild[\\/]lib[\\/]cli\.js$/)

    const nodeSteps = nativeRebuildSteps("node", { root: process.cwd() })
    expect(nodeSteps).toHaveLength(2)
    expect(nodeSteps.every((step) => step.command === process.execPath)).toBe(true)
    expect(
      nodeSteps.every((step) => /[\\/]node-gyp[\\/]bin[\\/]node-gyp\.js$/.test(step.args[0])),
    ).toBe(true)
    expect(nodeSteps.map((step) => step.cwd)).toEqual([
      join(process.cwd(), "node_modules", "better-sqlite3"),
      join(process.cwd(), "node_modules", "node-pty"),
    ])

    const recoverySteps = nativeElectronRecoverySteps({ root: process.cwd() })
    expect(recoverySteps).toHaveLength(1)
    expect(recoverySteps[0]).toMatchObject({
      command: process.execPath,
      args: expect.arrayContaining(["build", "--release"]),
      cwd: join(process.cwd(), "node_modules", "node-pty"),
    })
    expect(recoverySteps[0].args[0]).toMatch(/[\\/]node-gyp[\\/]bin[\\/]node-gyp\.js$/)
  })

  it("probes real PTY launches instead of treating a lazy node-pty import as healthy", () => {
    const calls: Array<{ runtime: string; args: string[] }> = []
    const result = probeNativeModules("electron", {
      runtime: "electron-runtime",
      spawn: (runtime: string, args: string[]) => {
        calls.push({ runtime, args })
        return { status: 0, stdout: "140", stderr: "", signal: null }
      },
    })

    expect(result).toMatchObject({ ok: true, abi: "140" })
    expect(calls).toHaveLength(1)
    expect(calls[0].runtime).toBe("electron-runtime")
    expect(calls[0].args[1]).toContain("pty.spawn")
    expect(calls[0].args[1]).toContain("runPtyProbe(true)")
    expect(calls[0].args[1]).toContain("runPtyProbe(false)")
    expect(calls[0].args[1]).toContain("process.exit(0)")
  })

  it("changes when Electron or a native dependency changes", () => {
    const base = {
      target: "electron",
      nodeAbi: "127",
      electronVersion: "39.4.0",
      nativeModuleVersions: { "better-sqlite3": "12.6.0", "node-pty": "1.1.0" },
    }
    expect(nativeAbiMarker(base)).not.toBe(nativeAbiMarker({ ...base, electronVersion: "39.4.1" }))
    expect(nativeAbiMarker(base)).not.toBe(
      nativeAbiMarker({
        ...base,
        nativeModuleVersions: { ...base.nativeModuleVersions, "node-pty": "1.2.0" },
      }),
    )
  })

  it("requires a rebuild when a matching marker hides a wrong native binary", () => {
    expect(nativeAbiAction({ current: "node-127", desired: "node-127", probeOk: false })).toBe(
      "rebuild",
    )
    expect(nativeAbiAction({ current: "electron-140", desired: "node-127", probeOk: true })).toBe(
      "repair-marker",
    )
  })

  it.skipIf(Number(process.versions.node.split(".")[0]) !== 22)(
    "proves the supported Node runtime can really load SQLite and PTY native modules",
    () => {
      expect(probeNativeModules("node")).toMatchObject({
        ok: true,
        abi: process.versions.modules,
      })
    },
  )

  it("forces check -> package -> check to revalidate native binaries", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-abi-sequence-"))
    const markerPath = join(directory, ".native-abi")
    const desired = "node-127-better-sqlite3@12.11.1,node-pty@1.1.0"
    writeFileSync(markerPath, desired)

    expect(nativeAbiAction({ current: desired, desired, probeOk: true })).toBe("verified")
    const spawn = () => {
      expect(existsSync(markerPath)).toBe(false)
      writeFileSync(markerPath, "electron-builder-mutated-native-modules")
      return { status: 0, signal: null }
    }
    runBuilder([], {
      markerPath,
      spawn,
      runtime: "node",
      cli: "builder",
      cwd: directory,
      stdio: "pipe",
    })

    expect(existsSync(markerPath)).toBe(false)
    expect(nativeAbiAction({ current: "", desired, probeOk: false })).toBe("rebuild")
  })

  it("keeps ABI state invalid after builder failure, signal, and repeat runs", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-abi-failure-"))
    const markerPath = join(directory, ".native-abi")
    const run = (result: { status: number | null; signal: string | null }) => {
      writeFileSync(markerPath, "node-marker")
      const spawn = () => {
        expect(existsSync(markerPath)).toBe(false)
        writeFileSync(markerPath, "poisoned-during-builder")
        return result
      }
      return () =>
        runBuilder([], {
          markerPath,
          spawn,
          runtime: "node",
          cli: "builder",
          cwd: directory,
          stdio: "pipe",
        })
    }

    expect(run({ status: 1, signal: null })).toThrow("exit code 1")
    expect(existsSync(markerPath)).toBe(false)
    expect(run({ status: null, signal: "SIGTERM" })).toThrow("SIGTERM")
    expect(existsSync(markerPath)).toBe(false)
    run({ status: 0, signal: null })()
    run({ status: 0, signal: null })()
    expect(existsSync(markerPath)).toBe(false)
    expect(() => readFileSync(markerPath)).toThrow()
  })
})
