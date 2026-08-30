"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import {
  getAppActionHistorySnapshot,
  redoAppAction,
  subscribeAppActionHistory,
  undoAppAction,
} from "../lib/app-action-history"

const APPLICATION_MENUS = ["File", "Edit", "View", "Help"] as const

/**
 * Windows title bar component for frameless windows
 * Provides native editing and application-menu controls in the custom frame
 *
 * Only shown on Windows when using frameless window (useNativeFrame = false)
 */
export function WindowsTitleBar({
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
}: {
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
}) {
  const [hasNativeFrame, setHasNativeFrame] = useState(false)
  const actionHistory = useSyncExternalStore(
    subscribeAppActionHistory,
    getAppActionHistorySnapshot,
    getAppActionHistorySnapshot,
  )

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

  const showsAppControls = isWindows && !hasNativeFrame

  // Don't render on non-Windows or when using native frame
  if (!showsAppControls) return null

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
          aria-label="Back"
          title="Back"
          disabled={!canGoBack}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onBack}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Forward"
          title="Forward"
          disabled={!canGoForward}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onForward}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          aria-label={actionHistory.undoLabel ? `Undo ${actionHistory.undoLabel}` : "Undo"}
          title={actionHistory.undoLabel ? `Undo ${actionHistory.undoLabel} (Ctrl+Z)` : "Undo"}
          disabled={!actionHistory.canUndo}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            void undoAppAction().catch((error) =>
              toast.error("Undo failed", {
                description: error instanceof Error ? error.message : String(error),
              }),
            )
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={actionHistory.redoLabel ? `Redo ${actionHistory.redoLabel}` : "Redo"}
          title={
            actionHistory.redoLabel ? `Redo ${actionHistory.redoLabel} (Ctrl+Shift+Z)` : "Redo"
          }
          disabled={!actionHistory.canRedo}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            void redoAppAction().catch((error) =>
              toast.error("Redo failed", {
                description: error instanceof Error ? error.message : String(error),
              }),
            )
          }
        >
          <Redo2 className="h-3.5 w-3.5" />
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
