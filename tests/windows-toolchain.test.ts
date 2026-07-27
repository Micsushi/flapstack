import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  evaluateWindowsToolchain,
  redactDiagnosticPath,
} from "../scripts/windows-prerequisites.mjs"

const completeTools = {
  npm: "10.9.2",
  python: "3.11.9",
  cmake: "3.31.0",
  cargo: "1.84.0",
  rustc: "1.84.0",
  msbuild: "17.12.0",
  spectreLibraries: true,
  windowsSdk: "10.0.26100.0",
  git: "2.47.0",
  powershell: "7.5.0",
}

describe("Windows prerequisite contract", () => {
  it("accepts the supported Windows x64 toolchain", () => {
    expect(
      evaluateWindowsToolchain({
        platform: "win32",
        arch: "x64",
        osRelease: "10.0.22631",
        node: "22.14.0",
        tools: completeTools,
      }),
    ).toMatchObject({ ok: true, errors: [] })
  })

  it("rejects the unsupported Node 25 and Python 3.13 machine baseline", () => {
    const result = evaluateWindowsToolchain({
      platform: "win32",
      arch: "x64",
      osRelease: "10.0.22631",
      node: "25.6.1",
      tools: { ...completeTools, python: "3.13.1" },
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("Node 22 is required; found 25.6.1")
    expect(result.errors.join("\n")).toContain("Python 3.11 is required; found 3.13.1")
  })

  it("lists every missing native prerequisite in one pass", () => {
    const result = evaluateWindowsToolchain({
      platform: "win32",
      arch: "x64",
      osRelease: "10.0.22631",
      node: "22.14.0",
      tools: { npm: "10.9.2", python: "3.11.9" },
    })

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("CMake"),
        expect.stringContaining("Cargo"),
        expect.stringContaining("Rust"),
        expect.stringContaining("Visual Studio 2022 Build Tools"),
        expect.stringContaining("Spectre-mitigated"),
        expect.stringContaining("Windows SDK"),
        expect.stringContaining("Git"),
        expect.stringContaining("PowerShell"),
      ]),
    )
  })

  it("rejects unsupported host platform and architecture", () => {
    expect(
      evaluateWindowsToolchain({
        platform: "darwin",
        arch: "arm64",
        osRelease: "24.6.0",
        node: "22.14.0",
        tools: completeTools,
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("native Windows"),
        expect.stringContaining("Windows x64"),
      ]),
    )
  })

  it("rejects Windows 10, npm 11, and PowerShell 5.0", () => {
    const result = evaluateWindowsToolchain({
      platform: "win32",
      arch: "x64",
      osRelease: "10.0.19045",
      node: "22.14.0",
      tools: {
        ...completeTools,
        npm: "11.5.1",
        powershell: "5.0.10586.0",
      },
    })

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Windows 11"),
        expect.stringContaining("npm 10 is required"),
        expect.stringContaining("PowerShell 5.1"),
      ]),
    )
  })

  it("allows Windows Server 2022 only as an explicit CI build host", () => {
    const input = {
      platform: "win32",
      arch: "x64",
      osRelease: "10.0.20348",
      node: "22.14.0",
      tools: completeTools,
    }

    expect(evaluateWindowsToolchain(input).errors).toContainEqual(
      expect.stringContaining("Windows 11"),
    )
    expect(
      evaluateWindowsToolchain({
        ...input,
        allowWindowsServer2022BuildHost: true,
      }),
    ).toMatchObject({ ok: true, errors: [] })
  })

  it("redacts user-profile paths in diagnostics", () => {
    expect(
      redactDiagnosticPath(
        "C:\\Users\\sushi\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
        { home: "C:\\Users\\sushi" },
      ),
    ).toBe("<HOME>\\AppData\\Local\\Programs\\Python\\Python311\\python.exe")
  })
})
