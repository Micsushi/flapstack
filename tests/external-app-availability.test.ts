import { describe, expect, it } from "vitest"
import { getExternalAppProbe, getPlatformFolderLabel } from "../src/main/lib/external/app-launch"

describe("external app availability", () => {
  it("uses platform-native folder wording", () => {
    expect(getPlatformFolderLabel("darwin")).toBe("Finder")
    expect(getPlatformFolderLabel("win32")).toBe("Open in folder")
    expect(getPlatformFolderLabel("linux")).toBe("Open in folder")
  })

  it("probes only apps supported on the current platform", () => {
    expect(getExternalAppProbe("win32", "vscode")).toEqual({
      command: "where.exe",
      args: ["code"],
    })
    expect(getExternalAppProbe("win32", "xcode")).toBeNull()
    expect(getExternalAppProbe("darwin", "xcode")).toEqual({
      command: "open",
      args: ["-Ra", "Xcode"],
    })
    expect(getExternalAppProbe("linux", "vscode")).toEqual({
      command: "which",
      args: ["code"],
    })
    expect(getExternalAppProbe("linux", "terminal")).toEqual({
      command: "which",
      args: ["x-terminal-emulator"],
    })
    expect(getExternalAppProbe("linux", "intellij")).toEqual({
      command: "which",
      args: ["idea"],
    })
  })
})
