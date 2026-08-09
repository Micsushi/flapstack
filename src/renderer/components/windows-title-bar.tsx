"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"

const APPLICATION_MENUS = ["File", "Edit", "View", "Help"] as const

/**
 * Windows title bar component for frameless windows
 * Provides native editing and application-menu controls in the custom frame
 *
 * Only shown on Windows when using frameless window (useNativeFrame = false)
 */
export function WindowsTitleBar() {
  const [hasNativeFrame, setHasNativeFrame] = useState(false)

  const isWindows = typeof window !== "undefined" && window.desktopApi?.platform === "win32"

  // Check actual window frame state
  useEffect(() => {
    if (!isWindows || !window.desktopApi?.getWindowFrameState) return

    const checkFrameState = async () => {
      try {
        const hasFrame = await window.desktopApi.getWindowFrameState()
        setHasNativeFrame(hasFrame)
      } catch {
        setHasNativeFrame(false)
      }
    }

    checkFrameState()
  }, [isWindows])

  // Don't render on non-Windows or when using native frame
  if (!isWindows || hasNativeFrame) return null

  return (
    <div
      className="h-8 flex-shrink-0 flex items-center bg-background border-b border-border/50"
      style={{
        // @ts-expect-error - WebKit-specific property for Electron window dragging
        WebkitAppRegion: "drag",
      }}
    >
      <div
        className="flex h-full items-center gap-0.5 px-1.5"
        style={{
          // @ts-expect-error - WebKit-specific property for Electron window dragging
          WebkitAppRegion: "no-drag",
        }}
      >
        <button
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void window.desktopApi.undo()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void window.desktopApi.redo()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        {APPLICATION_MENUS.map((menu) => (
          <button
            key={menu}
            type="button"
            className="flex h-7 items-center rounded-md px-2 text-xs text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
            onClick={() => void window.desktopApi.showApplicationMenu(menu)}
          >
            {menu}
          </button>
        ))}
      </div>
    </div>
  )
}
