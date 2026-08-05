import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  applyChatDrop,
  collectChatGroups,
  previewChatDrop,
  projectResponsiveChatWorkbench,
  reduceChatWorkbench,
  type ChatDropPreview,
  type ChatDropZone,
  type ChatGroupNode,
  type ChatWorkbenchAction,
  type ChatWorkbenchLayout,
  type ChatWorkbenchPreset,
} from "../../../../shared/chat-workbench"
import { cn } from "../../../lib/utils"
import { ChevronRight, MoreHorizontal, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"

const CHAT_DRAG_TYPE = "application/x-flapstack-chat-workbench"

export const CHAT_WORKBENCH_A11Y = {
  shell: "Chat workbench",
  resize: "Resize Chat panes",
  tabs: "Chat group tabs",
  status: "Chat workbench status",
} as const

export type ChatWorkbenchChat = { id: string; name?: string | null; accentColor?: string | null }
export type ChatWorkbenchDragSource = {
  chatId: string
  groupId: string
  sourceWindowId: string
}

export function ChatWorkbench({
  chats,
  layout,
  onLayoutChange,
  onActiveChatChange,
  renderChat,
  readOnlyChatIds = new Set(),
  windowId = "main",
  onMoveToNewWindow,
  onMoveToExistingWindow,
  onCrossWindowDrop,
  onDragOutside,
  onClaimOwnership,
  onSaveAsWorkspace,
  viewport,
}: {
  chats: ChatWorkbenchChat[]
  layout: ChatWorkbenchLayout
  onLayoutChange: (layout: ChatWorkbenchLayout, action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  renderChat: (chatId: string, active: boolean) => ReactNode
  readOnlyChatIds?: ReadonlySet<string>
  windowId?: string
  onMoveToNewWindow?: (
    chatId: string,
    sourceGroupId: string,
    operation: "move" | "read-only-copy",
  ) => Promise<string>
  onMoveToExistingWindow?: (chatId: string, sourceGroupId: string) => Promise<string>
  onCrossWindowDrop?: (
    source: ChatWorkbenchDragSource,
    target: { groupId: string; zone: ChatDropZone },
  ) => Promise<string>
  onDragOutside?: (
    source: ChatWorkbenchDragSource,
    point: { screenX: number; screenY: number },
  ) => Promise<string>
  onClaimOwnership?: (chatId: string) => Promise<string>
  onSaveAsWorkspace?: () => Promise<string>
  viewport?: { width: number; height: number }
}) {
  const shellRef = useRef<HTMLElement>(null)
  const [announcement, setAnnouncement] = useState("")
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [measuredViewport, setMeasuredViewport] = useState<{
    width: number
    height: number
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<ChatDropPreview | null>(null)
  const dragSessionRef = useRef<{
    source: ChatWorkbenchDragSource
    screenX: number
    screenY: number
    cancelled: boolean
  } | null>(null)
  const chatNames = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat.name?.trim() || "New Chat"])),
    [chats],
  )
  const chatAccents = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat.accentColor ?? null])),
    [chats],
  )
  const groups = collectChatGroups(layout.root)
  const projected = useMemo(
    () =>
      viewport || measuredViewport
        ? projectResponsiveChatWorkbench(layout, {
            ...(viewport ?? measuredViewport!),
            minPaneWidth: 360,
            minPaneHeight: 280,
          })
        : { logicalLayout: layout, visibleLayout: layout, collapsedGroupIds: [] },
    [layout, measuredViewport, viewport],
  )
  const visibleLayout = projected.visibleLayout
  const visibleGroups = collectChatGroups(visibleLayout.root)
  const activeGroup = groups.find((group) => group.id === layout.activeGroupId) ?? groups[0]

  useEffect(() => {
    if (viewport) return
    const shell = shellRef.current
    if (!shell) return
    const measure = () => {
      const rect = shell.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredViewport({ width: rect.width, height: rect.height })
      }
    }
    measure()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure())
    observer?.observe(shell)
    window.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("resize", measure)
    }
  }, [viewport])

  useEffect(() => {
    const cancelDrag = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !dragSessionRef.current) return
      dragSessionRef.current.cancelled = true
      setDragPreview(null)
    }
    window.addEventListener("keydown", cancelDrag, true)
    return () => window.removeEventListener("keydown", cancelDrag, true)
  }, [])

  const logicalGroupForChat = (chatId: string) =>
    groups.find((group) => group.chatIds.includes(chatId))

  const normalizeProjectedAction = (action: ChatWorkbenchAction): ChatWorkbenchAction => {
    if (projected.collapsedGroupIds.length === 0 || !("chatId" in action)) return action
    const owner = logicalGroupForChat(action.chatId)
    if (!owner) return action
    if ("groupId" in action) return { ...action, groupId: owner.id }
    if (action.type === "move-tab") return { ...action, fromGroupId: owner.id }
    return action
  }

  const dispatch = (action: ChatWorkbenchAction) => {
    const normalized = normalizeProjectedAction(action)
    const result = reduceChatWorkbench(layout, normalized)
    if (!result.accepted) {
      setAnnouncement(
        result.reason === "group-limit"
          ? "Four Chat panes are already visible. Add as a tab or move to another window."
          : "Chat layout action could not be applied.",
      )
      return
    }
    onLayoutChange(result.layout, normalized)
    setAnnouncement(result.announcement ?? describeAction(normalized))
  }

  const runWindowAction = async (
    operation: "move" | "move-existing" | "read-only-copy" | "claim",
    chatId: string,
    groupId: string,
  ) => {
    try {
      const message =
        operation === "claim"
          ? await onClaimOwnership?.(chatId)
          : operation === "move-existing"
            ? await onMoveToExistingWindow?.(chatId, groupId)
            : await onMoveToNewWindow?.(chatId, groupId, operation)
      setAnnouncement(message ?? "This window action is unavailable.")
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "The window action failed.")
    }
  }

  const handleDrop = (
    event: DragEvent,
    explicitTarget?: { groupId: string; zone: ChatDropZone },
  ) => {
    const source = readDrag(event)
    if (source?.sourceWindowId && source.sourceWindowId !== windowId) {
      event.preventDefault()
      event.stopPropagation()
      const target =
        explicitTarget ??
        (dragPreview
          ? { groupId: dragPreview.request.targetGroupId, zone: dragPreview.request.zone }
          : null)
      const targetAccepted =
        target?.zone === "tab" || (Boolean(target) && collectChatGroups(layout.root).length < 4)
      setDragPreview(null)
      if (!target || !targetAccepted || !onCrossWindowDrop) {
        setAnnouncement("Cross-window drop cancelled. The source was kept unchanged.")
        return
      }
      void onCrossWindowDrop(source, {
        groupId: target.groupId,
        zone: target.zone,
      })
        .then(setAnnouncement)
        .catch((error: unknown) =>
          setAnnouncement(
            error instanceof Error
              ? error.message
              : "Cross-window drop failed. The source was kept unchanged.",
          ),
        )
      return
    }
    if (!dragPreview) return
    const result = applyChatDrop(layout, dragPreview)
    if (result.accepted && dragPreview.accepted) {
      onLayoutChange(result.layout, dropAction(dragPreview))
      setAnnouncement(result.announcement ?? "Chat moved")
      onActiveChatChange(dragPreview.request.chatId)
    } else {
      setAnnouncement("Chat move cancelled. The source was kept unchanged.")
    }
    setDragPreview(null)
  }

  const handleDragEnd = (event: DragEvent<HTMLElement>) => {
    setDragPreview(null)
    const session = dragSessionRef.current
    dragSessionRef.current = null
    if (
      !session ||
      session.cancelled ||
      event.dataTransfer.dropEffect !== "none" ||
      !onDragOutside
    ) {
      return
    }
    if (event.screenX === 0 && event.screenY === 0) return
    const distance = Math.hypot(event.screenX - session.screenX, event.screenY - session.screenY)
    if (distance < 12) return
    void onDragOutside(session.source, { screenX: event.screenX, screenY: event.screenY })
      .then(setAnnouncement)
      .catch((error: unknown) =>
        setAnnouncement(
          error instanceof Error
            ? error.message
            : "Drag-out failed. The source Chat was kept unchanged.",
        ),
      )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!activeGroup) return
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n" && onMoveToNewWindow) {
      event.preventDefault()
      if (readOnlyChatIds.has(activeGroup.activeChatId)) {
        setAnnouncement("Take ownership before moving this read-only Chat.")
        return
      }
      void runWindowAction("move", activeGroup.activeChatId, activeGroup.id)
      return
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c" && onMoveToNewWindow) {
      event.preventDefault()
      if (readOnlyChatIds.has(activeGroup.activeChatId)) {
        setAnnouncement("Take ownership before copying this read-only Chat.")
        return
      }
      void runWindowAction("read-only-copy", activeGroup.activeChatId, activeGroup.id)
      return
    }
    const zone =
      event.key === "ArrowLeft"
        ? "left"
        : event.key === "ArrowRight"
          ? "right"
          : event.key === "ArrowUp"
            ? "top"
            : event.key === "ArrowDown"
              ? "bottom"
              : null
    if (event.ctrlKey && event.shiftKey && zone) {
      event.preventDefault()
      dispatch({
        type: "split",
        groupId: activeGroup.id,
        chatId: activeGroup.activeChatId,
        zone,
      })
      return
    }
    if (event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault()
      dispatch({ type: "toggle-maximize", groupId: activeGroup.id })
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === "w") {
      event.preventDefault()
      dispatch({
        type: "close-tab",
        groupId: activeGroup.id,
        chatId: activeGroup.activeChatId,
      })
      return
    }
    if (event.altKey && zone) {
      event.preventDefault()
      const current = groups.findIndex((group) => group.id === activeGroup.id)
      const offset = zone === "left" || zone === "top" ? -1 : 1
      const next = groups[(current + offset + groups.length) % groups.length]
      dispatch({ type: "activate-tab", groupId: next.id, chatId: next.activeChatId })
      onActiveChatChange(next.activeChatId)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-chat-group="${next.id}"]`)?.focus(),
      )
    }
  }

  const saveWorkspace = onSaveAsWorkspace
    ? () => {
        setSavingWorkspace(true)
        void onSaveAsWorkspace()
          .then(setAnnouncement)
          .catch((error: unknown) =>
            setAnnouncement(
              error instanceof Error ? error.message : "Workspace could not be saved.",
            ),
          )
          .finally(() => setSavingWorkspace(false))
      }
    : undefined

  return (
    <section
      ref={shellRef}
      role="application"
      aria-label={CHAT_WORKBENCH_A11Y.shell}
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      onKeyDown={handleKeyDown}
      onDragEnd={handleDragEnd}
      data-chat-workbench
      data-visible-groups={visibleGroups.length}
      data-collapsed-groups={projected.collapsedGroupIds.length}
    >
      {projected.collapsedGroupIds.length > 0 && (
        <div
          role="status"
          className="absolute left-2 top-2 z-40 max-w-[min(28rem,calc(100%-1rem))] rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm"
        >
          {projected.collapsedGroupIds.length} Chat{" "}
          {projected.collapsedGroupIds.length === 1 ? "pane is" : "panes are"} shown as tabs at this
          size. Resize the window to restore the saved pane layout.
        </div>
      )}
      <WorkbenchNode
        node={
          visibleLayout.maximizedGroupId
            ? (findGroup(visibleLayout.root, visibleLayout.maximizedGroupId) ?? visibleLayout.root)
            : visibleLayout.root
        }
        layout={layout}
        chatNames={chatNames}
        chatAccents={chatAccents}
        readOnlyChatIds={readOnlyChatIds}
        renderChat={renderChat}
        dispatch={dispatch}
        onActiveChatChange={onActiveChatChange}
        dragPreview={dragPreview}
        setDragPreview={setDragPreview}
        commitDrop={handleDrop}
        windowId={windowId}
        dragSessionRef={dragSessionRef}
        onMoveToNewWindow={onMoveToNewWindow ? runWindowAction : undefined}
        onMoveToExistingWindow={onMoveToExistingWindow ? runWindowAction : undefined}
        onClaimOwnership={onClaimOwnership ? runWindowAction : undefined}
        onSaveWorkspace={saveWorkspace}
        savingWorkspace={savingWorkspace}
        logicalGroupForChat={logicalGroupForChat}
      />
      <div
        role="status"
        aria-label={CHAT_WORKBENCH_A11Y.status}
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </div>
    </section>
  )
}

function WorkbenchNode({
  node,
  layout,
  chatNames,
  chatAccents,
  readOnlyChatIds,
  renderChat,
  dispatch,
  onActiveChatChange,
  dragPreview,
  setDragPreview,
  commitDrop,
  windowId,
  dragSessionRef,
  onMoveToNewWindow,
  onMoveToExistingWindow,
  onClaimOwnership,
  onSaveWorkspace,
  savingWorkspace,
  logicalGroupForChat,
}: {
  node: ChatGroupNode
  layout: ChatWorkbenchLayout
  chatNames: ReadonlyMap<string, string>
  chatAccents: ReadonlyMap<string, string | null>
  readOnlyChatIds: ReadonlySet<string>
  renderChat: (chatId: string, active: boolean) => ReactNode
  dispatch: (action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  dragPreview: ChatDropPreview | null
  setDragPreview: (preview: ChatDropPreview | null) => void
  commitDrop: (event: DragEvent, target?: { groupId: string; zone: ChatDropZone }) => void
  windowId: string
  dragSessionRef: MutableRefObject<{
    source: ChatWorkbenchDragSource
    screenX: number
    screenY: number
    cancelled: boolean
  } | null>
  onMoveToNewWindow?: (
    operation: "move" | "read-only-copy",
    chatId: string,
    groupId: string,
  ) => Promise<void>
  onMoveToExistingWindow?: (
    operation: "move-existing",
    chatId: string,
    groupId: string,
  ) => Promise<void>
  onClaimOwnership?: (operation: "claim", chatId: string, groupId: string) => Promise<void>
  onSaveWorkspace?: () => void
  savingWorkspace: boolean
  logicalGroupForChat: (chatId: string) => Extract<ChatGroupNode, { type: "group" }> | undefined
}) {
  if (node.type === "group") {
    return (
      <ChatGroup
        group={node}
        layout={layout}
        chatNames={chatNames}
        chatAccents={chatAccents}
        readOnlyChatIds={readOnlyChatIds}
        renderChat={renderChat}
        dispatch={dispatch}
        onActiveChatChange={onActiveChatChange}
        dragPreview={dragPreview}
        setDragPreview={setDragPreview}
        commitDrop={commitDrop}
        windowId={windowId}
        dragSessionRef={dragSessionRef}
        onMoveToNewWindow={onMoveToNewWindow}
        onMoveToExistingWindow={onMoveToExistingWindow}
        onClaimOwnership={onClaimOwnership}
        onSaveWorkspace={onSaveWorkspace}
        savingWorkspace={savingWorkspace}
        logicalGroupForChat={logicalGroupForChat}
      />
    )
  }
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1",
        node.direction === "row" ? "flex-row" : "flex-col",
      )}
      data-chat-split={node.id}
      data-direction={node.direction}
    >
      {node.children.map((child, index) => (
        <SplitChild key={child.id} split={node} index={index} dispatch={dispatch}>
          <WorkbenchNode
            node={child}
            layout={layout}
            chatNames={chatNames}
            chatAccents={chatAccents}
            readOnlyChatIds={readOnlyChatIds}
            renderChat={renderChat}
            dispatch={dispatch}
            onActiveChatChange={onActiveChatChange}
            dragPreview={dragPreview}
            setDragPreview={setDragPreview}
            commitDrop={commitDrop}
            windowId={windowId}
            dragSessionRef={dragSessionRef}
            onMoveToNewWindow={onMoveToNewWindow}
            onMoveToExistingWindow={onMoveToExistingWindow}
            onClaimOwnership={onClaimOwnership}
            onSaveWorkspace={onSaveWorkspace}
            savingWorkspace={savingWorkspace}
            logicalGroupForChat={logicalGroupForChat}
          />
        </SplitChild>
      ))}
    </div>
  )
}

function SplitChild({
  split,
  index,
  dispatch,
  children,
}: {
  split: Extract<ChatGroupNode, { type: "split" }>
  index: number
  dispatch: (action: ChatWorkbenchAction) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const percentage = split.sizes[index] * 100
  const boundaryPercentage =
    split.sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0) * 100
  const resize = (delta: number) => {
    if (index >= split.children.length - 1) return
    const sizes = [...split.sizes]
    sizes[index] += delta
    sizes[index + 1] -= delta
    dispatch({ type: "resize-split", splitId: split.id, sizes })
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (index >= split.children.length - 1) return
    event.preventDefault()
    const start = split.direction === "row" ? event.clientX : event.clientY
    const parent = ref.current?.parentElement
    const extent = split.direction === "row" ? parent?.clientWidth : parent?.clientHeight
    if (!extent) return
    const move = (next: globalThis.PointerEvent) => {
      const coordinate = split.direction === "row" ? next.clientX : next.clientY
      resize((coordinate - start) / extent)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const backwards =
      split.direction === "row" ? event.key === "ArrowLeft" : event.key === "ArrowUp"
    const forwards =
      split.direction === "row" ? event.key === "ArrowRight" : event.key === "ArrowDown"
    if (!backwards && !forwards) return
    event.preventDefault()
    resize(backwards ? -0.05 : 0.05)
  }
  return (
    <>
      <div
        ref={ref}
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: `${percentage}%`, flexGrow: split.sizes[index], flexShrink: 1 }}
      >
        {children}
      </div>
      {index < split.children.length - 1 && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={CHAT_WORKBENCH_A11Y.resize}
          aria-orientation={split.direction === "row" ? "vertical" : "horizontal"}
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(boundaryPercentage)}
          data-pointer-hit-area="12"
          className={cn(
            "group z-20 flex shrink-0 items-center justify-center bg-transparent outline-none",
            split.direction === "row"
              ? "-mx-1 w-3 cursor-col-resize"
              : "-my-1 h-3 cursor-row-resize",
          )}
          onPointerDown={pointerDown}
          onKeyDown={keyDown}
        >
          <span
            aria-hidden
            className={cn(
              "bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary",
              split.direction === "row" ? "h-full w-px" : "h-px w-full",
            )}
          />
        </div>
      )}
    </>
  )
}

function ChatGroup({
  group,
  layout,
  chatNames,
  chatAccents,
  readOnlyChatIds,
  renderChat,
  dispatch,
  onActiveChatChange,
  dragPreview,
  setDragPreview,
  commitDrop,
  windowId,
  dragSessionRef,
  onMoveToNewWindow,
  onMoveToExistingWindow,
  onClaimOwnership,
  onSaveWorkspace,
  savingWorkspace,
  logicalGroupForChat,
}: {
  group: Extract<ChatGroupNode, { type: "group" }>
  layout: ChatWorkbenchLayout
  chatNames: ReadonlyMap<string, string>
  chatAccents: ReadonlyMap<string, string | null>
  readOnlyChatIds: ReadonlySet<string>
  renderChat: (chatId: string, active: boolean) => ReactNode
  dispatch: (action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  dragPreview: ChatDropPreview | null
  setDragPreview: (preview: ChatDropPreview | null) => void
  commitDrop: (event: DragEvent, target?: { groupId: string; zone: ChatDropZone }) => void
  windowId: string
  dragSessionRef: MutableRefObject<{
    source: ChatWorkbenchDragSource
    screenX: number
    screenY: number
    cancelled: boolean
  } | null>
  onMoveToNewWindow?: (
    operation: "move" | "read-only-copy",
    chatId: string,
    groupId: string,
  ) => Promise<void>
  onMoveToExistingWindow?: (
    operation: "move-existing",
    chatId: string,
    groupId: string,
  ) => Promise<void>
  onClaimOwnership?: (operation: "claim", chatId: string, groupId: string) => Promise<void>
  onSaveWorkspace?: () => void
  savingWorkspace: boolean
  logicalGroupForChat: (chatId: string) => Extract<ChatGroupNode, { type: "group" }> | undefined
}) {
  const activeChatId = group.chatIds.includes(group.activeChatId)
    ? group.activeChatId
    : group.chatIds[0]
  const groupPreferenceKey = `flapstack-chat-group:${windowId}:${group.id}`
  const [groupPresentation, setGroupPresentation] = useState<{
    name: string
    collapsed: boolean
  }>(() => {
    try {
      const stored = localStorage.getItem(groupPreferenceKey)
      if (stored) return JSON.parse(stored) as { name: string; collapsed: boolean }
    } catch {
      // Ignore malformed presentation preferences.
    }
    return { name: `Group ${group.id.split("-").at(-1) ?? "1"}`, collapsed: false }
  })
  useEffect(() => {
    localStorage.setItem(groupPreferenceKey, JSON.stringify(groupPresentation))
  }, [groupPreferenceKey, groupPresentation])
  const activate = (chatId: string) => {
    dispatch({ type: "activate-tab", groupId: group.id, chatId })
    onActiveChatChange(chatId)
  }
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === "ArrowRight") next = (index + 1) % group.chatIds.length
    if (event.key === "ArrowLeft") next = (index - 1 + group.chatIds.length) % group.chatIds.length
    if (event.key === "Home") next = 0
    if (event.key === "End") next = group.chatIds.length - 1
    if (next === null) return
    event.preventDefault()
    activate(group.chatIds[next])
    document.getElementById(tabId(group.id, group.chatIds[next]))?.focus()
  }
  const preview = (event: DragEvent, zone: ChatDropZone, toIndex?: number) => {
    event.preventDefault()
    const source = readDrag(event)
    if (!source) return
    event.dataTransfer.dropEffect = "move"
    const request = {
      chatId: source.chatId,
      sourceGroupId: source.groupId,
      targetGroupId: group.id,
      zone,
      toIndex,
    }
    if (source.sourceWindowId && source.sourceWindowId !== windowId) {
      setDragPreview(
        zone !== "tab" && collectChatGroups(layout.root).length >= 4
          ? {
              accepted: false,
              request,
              reason: "group-limit",
              recovery: { type: "add-as-tab", targetGroupId: group.id },
            }
          : {
              accepted: true,
              request,
              layout,
              announcement:
                zone === "tab"
                  ? `Move Chat to group ${group.id}`
                  : `Split ${zone} of group ${group.id}`,
            },
      )
      return
    }
    setDragPreview(previewChatDrop(layout, request))
  }

  return (
    <section
      role="region"
      aria-label={`Chat pane ${chatNames.get(activeChatId) ?? activeChatId}`}
      tabIndex={layout.activeGroupId === group.id ? 0 : -1}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-border outline-none",
        layout.activeGroupId === group.id && "ring-1 ring-inset ring-primary/70",
      )}
      data-chat-group={group.id}
      data-active-chat-id={activeChatId}
      data-active-group={layout.activeGroupId === group.id || undefined}
      onFocusCapture={() => {
        if (layout.activeGroupId !== group.id) activate(activeChatId)
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-1">
        <button
          type="button"
          className="flex h-8 max-w-32 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={!groupPresentation.collapsed}
          onClick={() =>
            setGroupPresentation((current) => ({ ...current, collapsed: !current.collapsed }))
          }
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              !groupPresentation.collapsed && "rotate-90",
            )}
          />
          <span className="truncate">{groupPresentation.name}</span>
        </button>
        <div
          role="tablist"
          aria-label={CHAT_WORKBENCH_A11Y.tabs}
          className={cn(
            "min-w-0 flex-1 items-center gap-1 overflow-x-auto",
            groupPresentation.collapsed ? "hidden" : "flex",
          )}
          onDragOver={(event) => preview(event, "tab")}
          onDrop={(event) => commitDrop(event, { groupId: group.id, zone: "tab" })}
        >
          {group.chatIds.map((chatId, index) => (
            <div
              key={chatId}
              draggable={!readOnlyChatIds.has(chatId)}
              className={cn(
                "group/tab relative flex h-8 w-44 shrink-0 items-center rounded-md border border-transparent",
                chatId === activeChatId
                  ? "border-border bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent",
              )}
              style={{ borderTopColor: chatAccents.get(chatId) ?? undefined }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move"
                const source = {
                  chatId,
                  groupId: logicalGroupForChat(chatId)?.id ?? group.id,
                  sourceWindowId: windowId,
                }
                dragSessionRef.current = {
                  source,
                  screenX: event.screenX,
                  screenY: event.screenY,
                  cancelled: false,
                }
                event.dataTransfer.setData(CHAT_DRAG_TYPE, JSON.stringify(source))
              }}
              onDragOver={(event) => preview(event, "tab", index)}
              onDrop={(event) => commitDrop(event, { groupId: group.id, zone: "tab" })}
            >
              <button
                id={tabId(group.id, chatId)}
                type="button"
                role="tab"
                aria-selected={chatId === activeChatId}
                aria-controls={panelId(group.id, chatId)}
                tabIndex={chatId === activeChatId ? 0 : -1}
                className="min-w-0 flex-1 truncate px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => activate(chatId)}
                onKeyDown={(event) => tabKeyDown(event, index)}
              >
                {chatNames.get(chatId) ?? chatId}
                {readOnlyChatIds.has(chatId) ? " (read only)" : ""}
              </button>
              <button
                type="button"
                aria-label={`Close ${chatNames.get(chatId) ?? "Chat"} presentation`}
                className={cn(
                  "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted group-hover/tab:opacity-100 focus-visible:opacity-100",
                  chatId === activeChatId && "opacity-60",
                )}
                onClick={() => dispatch({ type: "close-tab", groupId: group.id, chatId })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
              aria-label="Chat pane options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layout</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {(
                  [
                    "single",
                    "two-columns",
                    "two-rows",
                    "three-columns",
                    "three-rows",
                    "grid-2x2",
                    "four-columns",
                    "four-rows",
                  ] as ChatWorkbenchPreset[]
                ).map((preset) => (
                  <DropdownMenuItem
                    key={preset}
                    className="capitalize"
                    onSelect={() => dispatch({ type: "apply-preset", preset })}
                  >
                    {preset.replaceAll("-", " ")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "toggle-maximize", groupId: group.id })}
            >
              {layout.maximizedGroupId === group.id ? "Restore pane" : "Maximize pane"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const name = window.prompt("Group name", groupPresentation.name)?.trim()
                if (name) setGroupPresentation((current) => ({ ...current, name }))
              }}
            >
              Rename group…
            </DropdownMenuItem>
            {layout.activeGroupId === group.id &&
              readOnlyChatIds.has(activeChatId) &&
              onClaimOwnership && (
                <DropdownMenuItem
                  onSelect={() => void onClaimOwnership("claim", activeChatId, group.id)}
                >
                  Take ownership here
                </DropdownMenuItem>
              )}
            {layout.activeGroupId === group.id &&
              !readOnlyChatIds.has(activeChatId) &&
              onMoveToNewWindow && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void onMoveToNewWindow("move", activeChatId, group.id)}
                  >
                    Move to new window
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void onMoveToNewWindow("read-only-copy", activeChatId, group.id)
                    }
                  >
                    Open read-only copy
                  </DropdownMenuItem>
                </>
              )}
            {layout.activeGroupId === group.id &&
              !readOnlyChatIds.has(activeChatId) &&
              onMoveToExistingWindow && (
                <DropdownMenuItem
                  onSelect={() =>
                    void onMoveToExistingWindow("move-existing", activeChatId, group.id)
                  }
                >
                  Move to existing window…
                </DropdownMenuItem>
              )}
            {onSaveWorkspace && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={savingWorkspace} onSelect={onSaveWorkspace}>
                  {savingWorkspace ? "Saving workspace…" : "Save as workspace"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        id={panelId(group.id, activeChatId)}
        role="tabpanel"
        aria-labelledby={tabId(group.id, activeChatId)}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {renderChat(activeChatId, layout.activeGroupId === group.id)}
      </div>
      {dragPreview && (
        <div className="pointer-events-none absolute inset-0 z-30 grid grid-cols-3 grid-rows-3 gap-1 bg-background/35 p-2">
          {(["top", "left", "tab", "right", "bottom"] as const).map((zone) => (
            <button
              key={zone}
              type="button"
              tabIndex={-1}
              aria-label={`Drop Chat ${zone === "tab" ? "as tab" : zone}`}
              data-chat-drop-zone={zone}
              className={cn(
                "pointer-events-auto rounded border border-primary/60 bg-primary/15 text-xs",
                zone === "top" && "col-start-2 row-start-1",
                zone === "left" && "col-start-1 row-start-2",
                zone === "tab" && "col-start-2 row-start-2",
                zone === "right" && "col-start-3 row-start-2",
                zone === "bottom" && "col-start-2 row-start-3",
              )}
              onDragOver={(event) => preview(event, zone)}
              onDrop={(event) => commitDrop(event, { groupId: group.id, zone })}
            >
              {zone}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function readDrag(event: DragEvent): ChatWorkbenchDragSource | null {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(CHAT_DRAG_TYPE)) as {
      chatId?: unknown
      groupId?: unknown
      sourceWindowId?: unknown
    }
    return typeof parsed.chatId === "string" && typeof parsed.groupId === "string"
      ? {
          chatId: parsed.chatId,
          groupId: parsed.groupId,
          sourceWindowId:
            typeof parsed.sourceWindowId === "string" ? parsed.sourceWindowId : "main",
        }
      : null
  } catch {
    return null
  }
}

function findGroup(
  node: ChatGroupNode,
  id: string,
): Extract<ChatGroupNode, { type: "group" }> | null {
  if (node.type === "group") return node.id === id ? node : null
  for (const child of node.children) {
    const group = findGroup(child, id)
    if (group) return group
  }
  return null
}

function tabId(groupId: string, chatId: string) {
  return `chat-workbench-tab-${groupId}-${chatId}`
}

function panelId(groupId: string, chatId: string) {
  return `chat-workbench-panel-${groupId}-${chatId}`
}

function describeAction(action: ChatWorkbenchAction): string {
  if (action.type === "split") return `Split Chat ${action.zone}`
  if (action.type === "toggle-maximize") return "Chat pane maximize state changed"
  if (action.type === "close-tab") return "Chat presentation closed"
  if (action.type === "resize-split") return "Chat pane sizes changed"
  if (action.type === "apply-preset") return `Applied ${action.preset} layout`
  return "Active Chat changed"
}

function dropAction(preview: Extract<ChatDropPreview, { accepted: true }>): ChatWorkbenchAction {
  return preview.request.zone === "tab"
    ? {
        type: "move-tab",
        fromGroupId: preview.request.sourceGroupId,
        toGroupId: preview.request.targetGroupId,
        chatId: preview.request.chatId,
        toIndex: preview.request.toIndex,
      }
    : {
        type: "split",
        groupId: preview.request.targetGroupId,
        chatId: preview.request.chatId,
        zone: preview.request.zone,
      }
}
