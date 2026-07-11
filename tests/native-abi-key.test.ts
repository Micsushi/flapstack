import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { nativeAbiMarker } from "../scripts/native-abi-key.mjs"
import { nativeAbiAction, probeNativeModules } from "../scripts/ensure-native-abi.mjs"
import { runBuilder } from "../scripts/package-app.mjs"

describe("native ABI marker", () => {
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

  it("proves the current Node runtime can really load SQLite and PTY native modules", () => {
    expect(probeNativeModules("node")).toMatchObject({ ok: true, abi: process.versions.modules })
  })

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
