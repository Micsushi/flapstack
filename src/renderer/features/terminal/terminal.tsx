import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { Terminal as XTerm } from "xterm"
import type { FitAddon } from "@xterm/addon-fit"
import type { SearchAddon } from "@xterm/addon-search"
import { useTheme } from "next-themes"
import { useSetAtom, useAtomValue } from "jotai"
import { toast } from "sonner"
import { trpc } from "@/lib/trpc"
import { terminalCwdAtom, terminalsAtom, activeTerminalIdAtom } from "./atoms"
import { fullThemeDataAtom } from "@/lib/atoms"
import {
  createTerminalInstance,
  getDefaultTerminalBg,
  setupClickToMoveCursor,
  setupContextMenuHandler,
  setupFocusListener,
  setupKeyboardHandler,
  setupPasteHandler,
  setupResizeHandlers,
} from "./helpers"
import { getTerminalTheme, getTerminalThemeFromVSCode } from "./config"
import { parseCwd } from "./parseCwd"
import { sanitizeForTitle } from "./commandBuffer"
import { shellEscapePaths } from "./utils"
import { TerminalSearch } from "./TerminalSearch"
import type { TerminalProps, TerminalStreamEvent } from "./types"
import type { TerminalReplayEvent } from "../../../shared/terminal-replay"
import { createTerminalReplayConsumer } from "./replay-consumer"
import { hotPathConsole as console } from "../../lib/hot-path-console"
import {
  incrementPerformanceCounter,
  measurePerformanceNextFrame,
} from "../../lib/performance-counters"
import "xterm/css/xterm.css"

export function Terminal({
  paneId,
  cwd,
  workspaceId,
  scopeKey,
  tabId,
  initialCommands,
  initialCwd,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const isExitedRef = useRef(false)
  const commandBufferRef = useRef("")

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [replayView, setReplayView] = useState(0)
  const [replayEnabled, setReplayEnabled] = useState(false)
  const [replayPane, setReplayPane] = useState<string | null>(null)
  const replayConsumerRef = useRef<ReturnType<typeof createTerminalReplayConsumer> | null>(null)
  const [terminalCwd, setTerminalCwd] = useState<string | null>(initialCwd || cwd)
  const setGlobalCwds = useSetAtom(terminalCwdAtom)

  // Theme detection
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // VS Code theme data (if a full theme is selected)
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  // Ref for terminalCwd to avoid effect re-runs when cwd changes
  const terminalCwdRef = useRef(terminalCwd)
  terminalCwdRef.current = terminalCwd

  // Ref for paneId to use in callbacks
  const paneIdRef = useRef(paneId)
  paneIdRef.current = paneId

  // Mutations
  const createOrAttachMutation = trpc.terminal.createOrAttach.useMutation()
  const writeMutation = trpc.terminal.write.useMutation()
  const resizeMutation = trpc.terminal.resize.useMutation()
  const detachMutation = trpc.terminal.detach.useMutation()
  const clearScrollbackMutation = trpc.terminal.clearScrollback.useMutation()
  const acknowledgeReplayMutation = trpc.terminal.acknowledgeReplay.useMutation()
  const acknowledgeReplayRef = useRef(acknowledgeReplayMutation.mutate)
  acknowledgeReplayRef.current = acknowledgeReplayMutation.mutate

  // Refs for mutations to avoid effect re-runs
  const createOrAttachRef = useRef(createOrAttachMutation.mutate)
  const writeRef = useRef(writeMutation.mutate)
  const resizeRef = useRef(resizeMutation.mutate)
  const detachRef = useRef(detachMutation.mutate)
  const clearScrollbackRef = useRef(clearScrollbackMutation.mutate)
  createOrAttachRef.current = createOrAttachMutation.mutate
  writeRef.current = writeMutation.mutate
  resizeRef.current = resizeMutation.mutate
  detachRef.current = detachMutation.mutate
  clearScrollbackRef.current = clearScrollbackMutation.mutate

  // Open clicked terminal file links in the configured editor.
  const openFileInEditorMutation = trpc.external.openFileInEditor.useMutation()
  const openFileRef = useRef(openFileInEditorMutation.mutate)
  openFileRef.current = openFileInEditorMutation.mutate

  // Shared terminal tab state (keyed by scopeKey), used to update this pane's
  // tab title from the entered command and to mark it the focused pane. Done
  // centrally here so every surface (sidebar/bottom/details) stays consistent.
  const setAllTerminals = useSetAtom(terminalsAtom)
  const setAllActiveIds = useSetAtom(activeTerminalIdAtom)
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  // paneId is `${chatId}:term:${instanceId}`; the atoms key instances by id.
  const instanceId = useMemo(() => paneId.split(":term:").pop() ?? paneId, [paneId])
  const instanceIdRef = useRef(instanceId)
  instanceIdRef.current = instanceId

  const setTerminalTitleRef = useRef<(title: string) => void>(() => {})
  setTerminalTitleRef.current = (title: string) => {
    const key = scopeKeyRef.current
    if (!key) return
    setAllTerminals((prev) => {
      const list = prev[key]
      if (!list) return prev
      return {
        ...prev,
        [key]: list.map((t) => (t.id === instanceIdRef.current ? { ...t, name: title } : t)),
      }
    })
  }

  const focusPaneRef = useRef<() => void>(() => {})
  focusPaneRef.current = () => {
    const key = scopeKeyRef.current
    if (!key) return
    setAllActiveIds((prev) =>
      prev[key] === instanceIdRef.current ? prev : { ...prev, [key]: instanceIdRef.current },
    )
  }

  // Parse terminal data for cwd (OSC 7 sequences)
  const updateCwdFromData = useCallback(
    (data: string) => {
      const parsedCwd = parseCwd(data)
      if (parsedCwd !== null) {
        console.log("[Terminal] Parsed cwd from OSC-7:", parsedCwd)
        setTerminalCwd(parsedCwd)
        // Also update global atom for the tabs to show
        setGlobalCwds((prev) => ({
          ...prev,
          [paneIdRef.current]: parsedCwd,
        }))
      }
    },
    [setGlobalCwds],
  )

  const updateCwdRef = useRef(updateCwdFromData)
  updateCwdRef.current = updateCwdFromData

  // Handle stream data
  const handleStreamData = useCallback((event: TerminalReplayEvent) => {
    replayConsumerRef.current?.accept(event)
  }, [])

  // Subscribe to terminal output
  trpc.terminal.stream.useSubscription(paneId, {
    onData: (event: TerminalStreamEvent) => {
      const terminal = xtermRef.current
      if (!terminal) return
      if (event.type === "data" && event.data) {
        terminal.write(event.data)
        updateCwdRef.current(event.data)
      } else if (event.type === "exit") {
        isExitedRef.current = true
        terminal.writeln(`\r\n\r\n[Process exited with code ${event.exitCode}]`)
        terminal.writeln("[Press any key to restart]")
      }
    },
    onError: (error) =>
      xtermRef.current?.write(`\r\n\x1b[31m[Connection error: ${error.message}]\x1b[0m\r\n`),
    enabled: !(replayEnabled && replayPane === paneId),
  })
  trpc.terminal.replay.useSubscription(
    { paneId, view: replayView },
    {
      onData: handleStreamData,
      onError: (err) => {
        console.error("[Terminal] Stream error:", err)
        xtermRef.current?.write(`\r\n\x1b[31m[Connection error: ${err.message}]\x1b[0m\r\n`)
      },
      onComplete: () => {
        if (!xtermRef.current || isExitedRef.current) return
        isExitedRef.current = true
        xtermRef.current.writeln(
          "\r\n[Terminal stream closed before final status. Press any key to reattach.]",
        )
      },
      enabled: replayEnabled && replayView > 0 && replayPane === paneId,
    },
  )

  // Initialize terminal
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    incrementPerformanceCounter("terminal-open")
    measurePerformanceNextFrame("terminal-open")

    console.log("[Terminal:useEffect] MOUNT - paneId:", paneId)
    console.log("[Terminal:useEffect] Container rect:", container.getBoundingClientRect())

    let isUnmounted = false

    // Create xterm instance
    console.log("[Terminal:useEffect] Creating terminal instance...", {
      isDark,
    })
    const { xterm, fitAddon, serializeAddon, cleanup } = createTerminalInstance(container, {
      cwd: terminalCwdRef.current || cwd,
      isDark,
      onFileLinkClick: (path, line, column) => {
        console.log("[Terminal] File link clicked:", path, line, column)
        openFileRef.current({
          path,
          cwd: terminalCwdRef.current || cwd,
          ...(line ? { line } : {}),
          ...(column ? { column } : {}),
        })
      },
      onUrlClick: (url) => {
        console.log("[Terminal] URL clicked:", url)
        window.desktopApi.openExternal(url)
      },
    })

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    const replayConsumer = createTerminalReplayConsumer(xterm, {
      acknowledge: (event) =>
        acknowledgeReplayRef.current({
          paneId,
          subscriptionId: event.subscriptionId,
          deliveryId: event.deliveryId,
        }),
      data: (data) => updateCwdRef.current(data),
      exit: (exitCode) => {
        isExitedRef.current = true
        xterm.writeln(`\r\n\r\n[Process exited with code ${exitCode}]`)
        xterm.writeln("[Press any key to restart]")
      },
    })
    replayConsumerRef.current = replayConsumer
    isExitedRef.current = false

    // Lazy load search addon
    import("@xterm/addon-search").then(({ SearchAddon }) => {
      if (isUnmounted || !xtermRef.current) return
      const searchAddon = new SearchAddon()
      xtermRef.current.loadAddon(searchAddon)
      searchAddonRef.current = searchAddon
    })

    // Subscribe after PTY creation; the main-owned snapshot includes detached output.
    let usesReplay = false
    const attachReplay = (result: { replayEnabled?: boolean; serializedState: string }) => {
      if (!isUnmounted) {
        usesReplay = result.replayEnabled ?? false
        setReplayEnabled(usesReplay)
        setReplayPane(paneId)
        setReplayView((view) => view + 1)
        if (!usesReplay && result.serializedState) xterm.write(result.serializedState)
      }
    }

    // Restart terminal after exit
    const restartTerminal = () => {
      isExitedRef.current = false
      xterm.clear()
      createOrAttachRef.current(
        {
          paneId,
          tabId,
          workspaceId,
          scopeKey,
          cols: xterm.cols,
          rows: xterm.rows,
          cwd: terminalCwdRef.current || cwd,
        },
        {
          onSuccess: attachReplay,
        },
      )
    }

    // Input handler
    const handleTerminalInput = (data: string) => {
      if (isExitedRef.current) {
        restartTerminal()
        return
      }
      writeRef.current({ paneId, data })
    }

    // Key handler for command buffer (tab title)
    const handleKeyPress = (event: { key: string; domEvent: KeyboardEvent }) => {
      const { domEvent } = event
      if (domEvent.key === "Enter") {
        const title = sanitizeForTitle(commandBufferRef.current)
        if (title) {
          setTerminalTitleRef.current(title)
        }
        commandBufferRef.current = ""
      } else if (domEvent.key === "Backspace") {
        commandBufferRef.current = commandBufferRef.current.slice(0, -1)
      } else if (domEvent.key === "c" && domEvent.ctrlKey) {
        commandBufferRef.current = ""
      } else if (domEvent.key.length === 1 && !domEvent.ctrlKey && !domEvent.metaKey) {
        commandBufferRef.current += domEvent.key
      }
    }

    // Create or attach to session
    createOrAttachRef.current(
      {
        paneId,
        tabId,
        workspaceId,
        scopeKey,
        cols: xterm.cols,
        rows: xterm.rows,
        cwd: initialCwd || cwd,
        initialCommands,
      },
      {
        onSuccess: (result) => {
          attachReplay(result)
          xterm.focus()
        },
        onError: (err) => {
          xterm.write(`\x1b[31m[Failed to start terminal: ${err.message}]\x1b[0m\r\n`)
        },
      },
    )

    // Set up handlers
    const inputDisposable = xterm.onData(handleTerminalInput)
    const keyDisposable = xterm.onKey(handleKeyPress)

    const handleClear = () => {
      xterm.clear()
      clearScrollbackRef.current({ paneId })
    }

    const handleWrite = (data: string) => {
      if (!isExitedRef.current) {
        writeRef.current({ paneId, data })
      }
    }

    const cleanupKeyboard = setupKeyboardHandler(xterm, {
      onShiftEnter: () => handleWrite("\x1b\r"), // ESC + CR for line continuation
      onClear: handleClear,
    })

    const cleanupClickToMove = setupClickToMoveCursor(xterm, {
      onWrite: handleWrite,
    })

    const cleanupFocus = setupFocusListener(xterm, () => {
      focusPaneRef.current()
    })

    const cleanupResize = setupResizeHandlers(
      container,
      xterm,
      fitAddon,
      (cols, rows) => {
        resizeRef.current({ paneId, cols, rows })
      },
      () => usesReplay,
    )

    const cleanupPaste = setupPasteHandler(xterm, {
      onPaste: (text) => {
        commandBufferRef.current += text
      },
    })

    const cleanupContextMenu = setupContextMenuHandler(xterm, {
      onCopy: () => {
        toast.success("Copied to clipboard")
      },
      onPaste: (text) => {
        commandBufferRef.current += text
      },
      onCopyError: () => {
        toast.error("Failed to copy to clipboard")
      },
      onPasteError: () => {
        toast.error("Failed to paste from clipboard")
      },
    })

    // Cleanup on unmount
    return () => {
      console.log("[Terminal:useEffect] UNMOUNT - paneId:", paneId)
      isUnmounted = true
      inputDisposable.dispose()
      keyDisposable.dispose()
      cleanupKeyboard()
      cleanupClickToMove()
      cleanupFocus?.()
      cleanupResize()
      cleanupPaste()
      cleanupContextMenu()
      cleanup()

      replayConsumer.dispose()
      if (replayConsumerRef.current === replayConsumer) replayConsumerRef.current = null

      // Detach instead of kill - keeps session alive for reattach
      detachRef.current({
        paneId,
        serializedState: usesReplay ? undefined : serializeAddon.serialize(),
      })

      console.log("[Terminal:useEffect] Disposing xterm...")
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      console.log("[Terminal:useEffect] UNMOUNT complete")
    }
    // Note: terminalCwd is accessed via ref to avoid remounting on cwd changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, cwd, workspaceId, tabId, initialCwd, initialCommands, isDark])

  // Update theme when isDark changes or VS Code theme changes (without recreating terminal)
  useEffect(() => {
    if (xtermRef.current) {
      const newTheme = getTerminalThemeFromVSCode(fullThemeData?.colors, isDark)
      xtermRef.current.options.theme = newTheme
    }
  }, [isDark, fullThemeData])

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setIsSearchOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Drag and drop files
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) return

      // Get file paths (Electron exposes webUtils)
      const paths = files.map((file) => {
        return window.webUtils?.getPathForFile?.(file) || file.name
      })
      const text = shellEscapePaths(paths)

      if (!isExitedRef.current) {
        writeRef.current({ paneId, data: text })
      }
    },
    [paneId],
  )

  const terminalBg = useMemo(() => {
    // Use VS Code theme terminal background if available
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  return (
    <div
      role="application"
      className={`relative h-full w-full ${replayEnabled ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"}`}
      style={{ backgroundColor: terminalBg }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TerminalSearch
        searchAddon={searchAddonRef.current}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <div ref={containerRef} className="h-full w-full" style={{ padding: "8px" }} />
    </div>
  )
}
