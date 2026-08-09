import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const windowSource = readFileSync("src/main/windows/main.ts", "utf8")
const titleBarSource = readFileSync("src/renderer/components/windows-title-bar.tsx", "utf8")
const sidebarSource = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")

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

  it("keeps one sidebar close control without a Windows traffic-light spacer", () => {
    expect(sidebarSource.match(/aria-label="Close sidebar"/g)).toHaveLength(1)
    expect(sidebarSource).toContain('{getPlatform() === "darwin" && (')
  })

  it("keeps the sidebar search accessible without visible placeholder text", () => {
    expect(sidebarSource).not.toContain('placeholder="Search projects and chats..."')
    expect(sidebarSource).toContain('aria-label="Search projects and chats"')
    expect(sidebarSource).toContain("items-center gap-1 px-2 pb-2 pt-3")
  })

  it("uses a slightly larger uniform gap between sidebar navigation groups", () => {
    expect(sidebarSource.match(/mt-3\.5/g)).toHaveLength(3)
    expect(sidebarSource).not.toContain("mt-[10px]")
  })
})
