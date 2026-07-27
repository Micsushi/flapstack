import { describe, expect, it } from "vitest"
import { formatInitialCommands, terminalPtyPlatformOptions } from "../src/main/lib/terminal/session"

describe("terminal initial command formatting", () => {
  it("uses PowerShell 5.1-compatible conditional sequencing", () => {
    expect(
      formatInitialCommands("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", [
        "first",
        "second",
        "third",
      ]),
    ).toBe("first; if ($?) { second; if ($?) { third } }\n")
  })

  it("retains command-shell conditional sequencing", () => {
    expect(formatInitialCommands("C:\\Windows\\System32\\cmd.exe", ["first", "second"])).toBe(
      "first && second\n",
    )
  })

  it("uses the bundled winpty cancellation path under Windows Electron", () => {
    expect(terminalPtyPlatformOptions("win32")).toEqual({ useConpty: false })
    expect(terminalPtyPlatformOptions("darwin")).toEqual({})
    expect(terminalPtyPlatformOptions("linux")).toEqual({})
  })
})
