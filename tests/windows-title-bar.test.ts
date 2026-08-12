import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const titleBarSource = readFileSync("src/renderer/components/windows-title-bar.tsx", "utf8")
const sidebarSource = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")
const preloadSource = readFileSync("src/preload/index.ts", "utf8")
const windowSource = readFileSync("src/main/windows/main.ts", "utf8")

describe("Windows title bar", () => {
  it("uses native Windows controls over the custom title bar", () => {
    expect(windowSource).toMatch(
      /titleBarStyle:[\s\S]{0,160}process\.platform === "win32" && !useNativeFrame[\s\S]{0,80}\? "hidden"/,
    )
    expect(windowSource).toContain("titleBarOverlay:")
    expect(windowSource).toContain(
      'symbolColor: nativeTheme.shouldUseDarkColors ? "#f4f4f5" : "#18181b"',
    )
    expect(windowSource).toContain("height: 32")
    expect(titleBarSource).not.toContain("<Button")
    expect(titleBarSource).not.toContain("windowMaximize")
  })

  it("shows native app menus with working undo and redo controls", () => {
    expect(titleBarSource).toContain("actionHistory.undoLabel")
    expect(titleBarSource).toContain("actionHistory.redoLabel")
    expect(titleBarSource).toContain("undoAppAction")
    expect(titleBarSource).toContain("redoAppAction")
    expect(titleBarSource).toContain('["File", "Edit", "View", "Help"]')
    expect(titleBarSource).toContain("showApplicationMenu")
    expect(preloadSource).toContain('ipcRenderer.invoke("window:undo")')
    expect(preloadSource).toContain('ipcRenderer.invoke("window:redo")')
    expect(windowSource).toContain('ipcMain.handle("window:show-application-menu"')
  })

  it("moves the Flapstack identity beside the sidebar control above search", () => {
    const brandIndex = sidebarSource.indexOf(">Flapstack</span>")
    const searchIndex = sidebarSource.indexOf('aria-label="Search projects and chats"')

    expect(brandIndex).toBeGreaterThan(-1)
    expect(brandIndex).toBeLessThan(searchIndex)
    expect(sidebarSource.slice(brandIndex, searchIndex)).toContain('aria-label="Close sidebar"')
    expect(titleBarSource).not.toContain("flapstackLogo")
    expect(titleBarSource).not.toContain(">Flapstack</span>")
  })

  it("keeps one sidebar close control without a Windows traffic-light spacer", () => {
    expect(sidebarSource.match(/aria-label="Close sidebar"/g)).toHaveLength(1)
    expect(sidebarSource).toContain('{getPlatform() === "darwin" && (')
  })

  it("keeps the full-width sidebar search accessible without visible placeholder text", () => {
    expect(sidebarSource).not.toContain('placeholder="Search projects and chats..."')
    expect(sidebarSource).toContain('aria-label="Search projects and chats"')
    expect(sidebarSource).toContain('isMobileFullscreen ? "pt-3" : "pt-1"')
  })

  it("uses a slightly larger uniform gap between sidebar navigation groups", () => {
    expect(sidebarSource.match(/mt-3\.5/g)?.length).toBeGreaterThanOrEqual(3)
    expect(sidebarSource).not.toContain("mt-[10px]")
  })
})
