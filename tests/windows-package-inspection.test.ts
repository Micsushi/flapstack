import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  inspectWindowsApp,
  readWindowsElectronVersion,
} from "../scripts/inspect-packaged-binaries.mjs"

function pe() {
  const buffer = Buffer.alloc(256)
  buffer.write("MZ", 0, "ascii")
  buffer.writeUInt32LE(128, 0x3c)
  buffer.write("PE\0\0", 128, "ascii")
  buffer.writeUInt16LE(0x8664, 132)
  return buffer
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-win-package-"))
  const app = join(directory, "Flapstack Preview.exe")
  const resources = join(directory, "resources")
  const bin = join(resources, "bin")
  const unpacked = join(resources, "app.asar.unpacked", "node_modules")
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(unpacked, "better-sqlite3", "build", "Release"), { recursive: true })
  mkdirSync(join(unpacked, "node-pty", "build", "Release"), { recursive: true })
  for (const file of [
    app,
    join(bin, "claude.exe"),
    join(bin, "codex.exe"),
    join(bin, "whisper-cli.exe"),
    join(bin, "flapstack-stt-sidecar.exe"),
    join(unpacked, "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    join(unpacked, "node-pty", "build", "Release", "pty.node"),
    join(unpacked, "node-pty", "build", "Release", "conpty.node"),
    join(unpacked, "node-pty", "build", "Release", "conpty_console_list.node"),
    join(unpacked, "node-pty", "build", "Release", "winpty-agent.exe"),
    join(unpacked, "node-pty", "build", "Release", "winpty.dll"),
  ]) {
    writeFileSync(file, pe())
  }
  for (const license of [
    "flapstack-stt-sidecar-LICENSE",
    "transcribe.cpp-LICENSE",
    "whisper.cpp-LICENSE",
  ]) {
    writeFileSync(join(bin, license), "license")
  }
  const sidecar = join(bin, "flapstack-stt-sidecar.exe")
  writeFileSync(
    join(bin, ".stt-sidecar.sha256"),
    `${createHash("sha256").update(readFileSync(sidecar)).digest("hex")}\n`,
  )
  writeFileSync(join(resources, "app.asar"), "asar")
  return app
}

describe("Windows package inspection", () => {
  it("reads Electron's runtime version without splitting an app path containing spaces", () => {
    const runner = vi.fn(() => ({ status: 0, stdout: "39.8.10\r\n", stderr: "" }))
    const app = "C:\\Preview Folder\\Flapstack Preview.exe"

    expect(readWindowsElectronVersion(app, runner)).toBe("39.8.10")
    expect(runner).toHaveBeenCalledWith(app, ["-p", "process.versions.electron"], {
      encoding: "utf8",
      windowsHide: true,
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
    })
  })

  it("verifies the app, harnesses, speech engines, native modules, and licenses", () => {
    const app = fixture()
    expect(
      inspectWindowsApp(app, "win32-x64", {
        readVersion: () => "39.8.10.0",
      }),
    ).toMatchObject({
      appPath: app,
      platformKey: "win32-x64",
      electronVersion: "39.8.10.0",
      binaries: {
        "node-pty-conpty": expect.stringContaining("conpty.node"),
        "node-pty-console-list": expect.stringContaining("conpty_console_list.node"),
        "node-pty-winpty-agent": expect.stringContaining("winpty-agent.exe"),
        "node-pty-winpty-dll": expect.stringContaining("winpty.dll"),
      },
    })
  })

  it("rejects an unexpected packaged Electron version", () => {
    expect(() =>
      inspectWindowsApp(fixture(), "win32-x64", { readVersion: () => "38.0.0.0" }),
    ).toThrow("Electron version mismatch")
  })

  it("rejects a sidecar changed after package-resource preparation", () => {
    const app = fixture()
    appendFileSync(join(dirname(app), "resources", "bin", "flapstack-stt-sidecar.exe"), "tampered")

    expect(() => inspectWindowsApp(app, "win32-x64", { readVersion: () => "39.8.10.0" })).toThrow(
      /SHA256/,
    )
  })
})
