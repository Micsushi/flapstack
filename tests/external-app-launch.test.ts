import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { resolveExternalAppLaunch, spawnExternalCommand } from "../src/main/lib/external/app-launch"

describe("external app launch", () => {
  it("uses native Windows commands without macOS open", () => {
    expect(resolveExternalAppLaunch("win32", "finder", "C:\\work\\repo")).toEqual({
      kind: "reveal",
      path: "C:\\work\\repo",
    })
    expect(resolveExternalAppLaunch("win32", "vscode", "C:\\work\\repo")).toEqual({
      kind: "spawn",
      command: "code",
      args: ["C:\\work\\repo"],
    })
    expect(resolveExternalAppLaunch("win32", "terminal", "C:\\work\\repo")).toEqual({
      kind: "spawn",
      command: "wt.exe",
      args: ["-d", "C:\\work\\repo"],
    })
  })

  it("retains macOS application launching", () => {
    expect(resolveExternalAppLaunch("darwin", "vscode", "/work/repo")).toEqual({
      kind: "spawn",
      command: "open",
      args: ["-a", "Visual Studio Code", "/work/repo"],
    })
  })

  it("falls back to the OS default for an unmapped Windows application", () => {
    expect(resolveExternalAppLaunch("win32", "xcode", "C:\\work\\repo")).toEqual({
      kind: "default",
      path: "C:\\work\\repo",
    })
  })

  it.runIf(process.platform === "win32")(
    "launches a real Windows cmd shim with spaced paths without shell interpolation",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "flapstack external launch "))
      const shimDirectory = join(root, "shim directory")
      const outputDirectory = join(root, "proof & 100% (safe)")
      const outputPath = join(outputDirectory, "launch result.txt")
      mkdirSync(shimDirectory)
      mkdirSync(outputDirectory)
      const shimPath = join(shimDirectory, "fixture-command.cmd")
      writeFileSync(shimPath, '@echo off\r\n> "%~1" echo %~2\r\n', "utf8")

      const env = { ...process.env }
      delete env.Path
      env.PATH = `${shimDirectory};${process.env.PATH ?? process.env.Path ?? ""}`
      await spawnExternalCommand(
        "win32",
        "fixture-command",
        [outputPath, "launched successfully"],
        { env },
      )

      await vi.waitFor(
        () => expect(readFileSync(outputPath, "utf8").trim()).toBe("launched successfully"),
        { timeout: 5_000, interval: 25 },
      )
    },
  )
})
