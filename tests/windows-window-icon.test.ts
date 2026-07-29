import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveWindowIconPath } from "../src/main/windows/window-icon"

describe("Windows window icon", () => {
  it("uses the repository icon in development", () => {
    expect(
      resolveWindowIconPath({
        platform: "win32",
        isPackaged: false,
        appPath: "C:\\repo",
        resourcesPath: "C:\\resources",
      }),
    ).toBe(join("C:\\repo", "build", "icon.ico"))
  })

  it("uses the copied resource in packaged builds", () => {
    expect(
      resolveWindowIconPath({
        platform: "win32",
        isPackaged: true,
        appPath: "C:\\app",
        resourcesPath: "C:\\resources",
      }),
    ).toBe(join("C:\\resources", "icon.ico"))
  })

  it("does not override native icons on other platforms", () => {
    expect(
      resolveWindowIconPath({
        platform: "darwin",
        isPackaged: false,
        appPath: "/repo",
        resourcesPath: "/resources",
      }),
    ).toBeUndefined()
  })
})
