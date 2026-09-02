"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import type { AppCommand } from "../../shared/app-command"
import {
  getAppActionHistorySnapshot,
  redoAppAction,
  undoAppAction,
} from "../lib/app-action-history"

const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  ".monaco-editor",
  ".xterm",
].join(",")

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(EDITABLE_TARGET_SELECTOR) !== null
}

function runAppAction(command: "history-undo" | "history-redo") {
  const isRedo = command === "history-redo"
  const operation = isRedo ? redoAppAction() : undoAppAction()
  void operation.catch((error) =>
    toast.error(isRedo ? "Redo failed" : "Undo failed", {
      description: error instanceof Error ? error.message : String(error),
    }),
  )
}

function runHistoryCommand(command: "history-undo" | "history-redo") {
  if (isEditableTarget(document.activeElement)) {
    const operation =
      command === "history-redo" ? window.desktopApi.redo() : window.desktopApi.undo()
    void operation.catch((error) =>
      toast.error(command === "history-redo" ? "Redo failed" : "Undo failed", {
        description: error instanceof Error ? error.message : String(error),
      }),
    )
    return
  }
  runAppAction(command)
}

export function AppCommandBridge({ onNavigate }: { onNavigate: (direction: -1 | 1) => void }) {
  const platform = typeof window === "undefined" ? undefined : window.desktopApi?.platform

  useEffect(() => {
    // Electron owns Command+Z through the native macOS Edit menu. Installing a
    // second renderer listener there could run the same action twice.
    if (!platform || platform === "darwin") return

    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.ctrlKey && !event.metaKey
      if (
        !hasPrimaryModifier ||
        event.altKey ||
        event.key.toLowerCase() !== "z" ||
        isEditableTarget(event.target)
      ) {
        return
      }

      const history = getAppActionHistorySnapshot()
      const command = event.shiftKey ? "history-redo" : "history-undo"
      const available = event.shiftKey ? history.canRedo : history.canUndo
      if (!available) return

      event.preventDefault()
      event.stopImmediatePropagation()
      runAppAction(command)
    }

    window.addEventListener("keydown", handleHistoryShortcut, true)
    return () => window.removeEventListener("keydown", handleHistoryShortcut, true)
  }, [platform])

  useEffect(() => {
    if (!window.desktopApi?.onAppCommand) return

    return window.desktopApi.onAppCommand((command: AppCommand) => {
      switch (command) {
        case "history-undo":
        case "history-redo":
          runHistoryCommand(command)
          break
        case "navigate-back":
          onNavigate(-1)
          break
        case "navigate-forward":
          onNavigate(1)
          break
      }
    })
  }, [onNavigate])

  return null
}
