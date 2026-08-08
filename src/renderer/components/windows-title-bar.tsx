"use client"

import { useEffect, useState } from "react"
import flapstackLogo from "../../../build/icons/32x32.png"

/**
 * Windows title bar component for frameless windows
 * Provides the branded drag region beneath Electron's native window controls
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
      <div className="flex h-full items-center gap-2 px-2">
        <img src={flapstackLogo} className="h-4 w-4 shrink-0" alt="" />
        <span className="text-xs font-medium text-foreground/70">Flapstack</span>
      </div>
    </div>
  )
}
