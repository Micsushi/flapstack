import {
  useEffect,
  memo,
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
  CHAT_WORKBENCH_DRAG_MIME,
  CHAT_WORKBENCH_DRAG_SESSION_KEY,
  CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
  collectChatGroups,
  previewChatDrop,
  projectResponsiveChatWorkbench,
  reduceChatWorkbench,
  type ChatDropPreview,
  type ChatDropZone,
  type ChatGroupNode,
  type ChatWorkbenchAction,
  type ChatWorkbenchLayout,
} from "../../../../shared/chat-workbench"
import { cn } from "../../../lib/utils"
import { configureChatDragFeedback } from "../lib/chat-drag-feedback"
import { MoreHorizontal, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu"

export const CHAT_WORKBENCH_A11Y = {
  shell: "Chat workbench",
  resize: "Resize Chat panes",
  tabs: "Chat group tabs",
  status: "Chat workbench status",
} as const

export type ChatWorkbenchChat = {
  id: string
  name?: string | null
  accentColor?: string | null
  hasUnseenChanges?: boolean
}
export type ChatWorkbenchDragSource = {
  chatId: string
  groupId: string
  sourceWindowId: string
}
type ChatWorkbenchGroupDragSource = {
  kind: "group"
  groupId: string
  sourceWindowId: string
}
type ChatWorkbenchAnyDragSource = ChatWorkbenchDragSource | ChatWorkbenchGroupDragSource
type ChatMoveMenu = {
  savedGroups: ReadonlyArray<{ id: string; name: string }>
  activeSavedGroupId: string | null
  onMoveChatToMainBar?: (chatId: string) => void
  onMoveChatToGroup?: (chatId: string, groupId: string) => void
  onCreateGroupFromChat?: (chatId: string) => void
}

function ChatWorkbenchComponent({
  chats,
  layout,
  onLayoutChange,
  onActiveChatChange,
  onChatViewed,
  renderChat,
  readOnlyChatIds = new Set(),
  windowId = "main",
  onCrossWindowDrop,
  onDragOutside,
  onClaimOwnership,
  onSaveAsWorkspace,
  showPaneHeaders = true,
  savedGroups = [],
  activeSavedGroupId = null,
  onMoveChatToMainBar,
  onMoveChatToGroup,
  onCreateGroupFromChat,
  viewport,
}: {
  chats: ChatWorkbenchChat[]
  layout: ChatWorkbenchLayout
  onLayoutChange: (layout: ChatWorkbenchLayout, action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  onChatViewed?: (chatId: string) => void
  renderChat: (chatId: string, active: boolean) => ReactNode
  readOnlyChatIds?: ReadonlySet<string>
  windowId?: string
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
  showPaneHeaders?: boolean
  savedGroups?: ReadonlyArray<{ id: string; name: string }>
  activeSavedGroupId?: string | null
  onMoveChatToMainBar?: (chatId: string) => void
  onMoveChatToGroup?: (chatId: string, groupId: string) => void
  onCreateGroupFromChat?: (chatId: string) => void
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
  const setStableDragPreview = (preview: ChatDropPreview | null) =>
    setDragPreview((current) => (sameChatDropPreview(current, preview) ? current : preview))
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
  const unseenChatIds = useMemo(
    () => new Set(chats.filter((chat) => chat.hasUnseenChanges).map((chat) => chat.id)),
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

  const runClaimAction = async (chatId: string) => {
    try {
      const message = await onClaimOwnership?.(chatId)
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
    if (!source) return
    event.preventDefault()
    event.stopPropagation()
    if (isGroupDragSource(source)) {
      setDragPreview(null)
      if (!explicitTarget || source.sourceWindowId !== windowId) {
        setAnnouncement("A whole Chat pane can only be moved inside its current window.")
        return
      }
      dispatch({
        type: "move-group",
        fromGroupId: source.groupId,
        toGroupId: explicitTarget.groupId,
        zone: explicitTarget.zone,
      })
      return
    }
    if (source?.sourceWindowId && source.sourceWindowId !== windowId) {
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
    try {
      localStorage.removeItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)
    } catch {
      // Ignore unavailable storage in restricted renderer contexts.
    }
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
        unseenChatIds={unseenChatIds}
        readOnlyChatIds={readOnlyChatIds}
        renderChat={renderChat}
        dispatch={dispatch}
        onActiveChatChange={onActiveChatChange}
        onChatViewed={onChatViewed}
        dragPreview={dragPreview}
        setDragPreview={setStableDragPreview}
        commitDrop={handleDrop}
        windowId={windowId}
        dragSessionRef={dragSessionRef}
        onClaimOwnership={onClaimOwnership ? runClaimAction : undefined}
        onSaveWorkspace={saveWorkspace}
        savingWorkspace={savingWorkspace}
        logicalGroupForChat={logicalGroupForChat}
        showPaneHeaders={showPaneHeaders}
        moveMenu={{
          savedGroups,
          activeSavedGroupId,
          onMoveChatToMainBar,
          onMoveChatToGroup,
          onCreateGroupFromChat,
        }}
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

export const ChatWorkbench = memo(ChatWorkbenchComponent)

function WorkbenchNode({
  node,
  layout,
  chatNames,
  chatAccents,
  unseenChatIds,
  readOnlyChatIds,
  renderChat,
  dispatch,
  onActiveChatChange,
  onChatViewed,
  dragPreview,
  setDragPreview,
  commitDrop,
  windowId,
  dragSessionRef,
  onClaimOwnership,
  onSaveWorkspace,
  savingWorkspace,
  logicalGroupForChat,
  showPaneHeaders,
  moveMenu,
}: {
  node: ChatGroupNode
  layout: ChatWorkbenchLayout
  chatNames: ReadonlyMap<string, string>
  chatAccents: ReadonlyMap<string, string | null>
  unseenChatIds: ReadonlySet<string>
  readOnlyChatIds: ReadonlySet<string>
  renderChat: (chatId: string, active: boolean) => ReactNode
  dispatch: (action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  onChatViewed?: (chatId: string) => void
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
  onClaimOwnership?: (chatId: string) => Promise<void>
  onSaveWorkspace?: () => void
  savingWorkspace: boolean
  logicalGroupForChat: (chatId: string) => Extract<ChatGroupNode, { type: "group" }> | undefined
  showPaneHeaders: boolean
  moveMenu: ChatMoveMenu
}) {
  if (node.type === "group") {
    return (
      <ChatGroup
        group={node}
        layout={layout}
        chatNames={chatNames}
        chatAccents={chatAccents}
        unseenChatIds={unseenChatIds}
        readOnlyChatIds={readOnlyChatIds}
        renderChat={renderChat}
        dispatch={dispatch}
        onActiveChatChange={onActiveChatChange}
        onChatViewed={onChatViewed}
        dragPreview={dragPreview}
        setDragPreview={setDragPreview}
        commitDrop={commitDrop}
        windowId={windowId}
        dragSessionRef={dragSessionRef}
        onClaimOwnership={onClaimOwnership}
        onSaveWorkspace={onSaveWorkspace}
        savingWorkspace={savingWorkspace}
        logicalGroupForChat={logicalGroupForChat}
        showPaneHeader={showPaneHeaders}
        moveMenu={moveMenu}
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
            unseenChatIds={unseenChatIds}
            readOnlyChatIds={readOnlyChatIds}
            renderChat={renderChat}
            dispatch={dispatch}
            onActiveChatChange={onActiveChatChange}
            onChatViewed={onChatViewed}
            dragPreview={dragPreview}
            setDragPreview={setDragPreview}
            commitDrop={commitDrop}
            windowId={windowId}
            dragSessionRef={dragSessionRef}
            onClaimOwnership={onClaimOwnership}
            onSaveWorkspace={onSaveWorkspace}
            savingWorkspace={savingWorkspace}
            logicalGroupForChat={logicalGroupForChat}
            showPaneHeaders={showPaneHeaders}
            moveMenu={moveMenu}
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
  unseenChatIds,
  readOnlyChatIds,
  renderChat,
  dispatch,
  onActiveChatChange,
  onChatViewed,
  dragPreview,
  setDragPreview,
  commitDrop,
  windowId,
  dragSessionRef,
  onClaimOwnership,
  onSaveWorkspace,
  savingWorkspace,
  logicalGroupForChat,
  showPaneHeader,
  moveMenu,
}: {
  group: Extract<ChatGroupNode, { type: "group" }>
  layout: ChatWorkbenchLayout
  chatNames: ReadonlyMap<string, string>
  chatAccents: ReadonlyMap<string, string | null>
  unseenChatIds: ReadonlySet<string>
  readOnlyChatIds: ReadonlySet<string>
  renderChat: (chatId: string, active: boolean) => ReactNode
  dispatch: (action: ChatWorkbenchAction) => void
  onActiveChatChange: (chatId: string) => void
  onChatViewed?: (chatId: string) => void
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
  onClaimOwnership?: (chatId: string) => Promise<void>
  onSaveWorkspace?: () => void
  savingWorkspace: boolean
  logicalGroupForChat: (chatId: string) => Extract<ChatGroupNode, { type: "group" }> | undefined
  showPaneHeader: boolean
  moveMenu: ChatMoveMenu
}) {
  const activeChatId = group.chatIds.includes(group.activeChatId)
    ? group.activeChatId
    : group.chatIds[0]
  const tabsRef = useRef<HTMLDivElement>(null)
  const [tabsHovered, setTabsHovered] = useState(false)
  const [scrollbar, setScrollbar] = useState({ left: 0, width: 0 })
  const [groupDropZone, setGroupDropZone] = useState<ChatDropZone | null>(null)
  const [tabDropTarget, setTabDropTarget] = useState<{
    chatId: string
    side: "left" | "inside" | "right"
  } | null>(null)
  const renderedChat = useMemo(
    () => renderChat(activeChatId, layout.activeGroupId === group.id),
    [activeChatId, group.id, layout.activeGroupId, renderChat],
  )
  const updateScrollbar = () => {
    const element = tabsRef.current
    if (!element || element.scrollWidth <= element.clientWidth) {
      setScrollbar((current) =>
        current.left === 0 && current.width === 0 ? current : { left: 0, width: 0 },
      )
      return
    }
    const width = Math.max(24, (element.clientWidth / element.scrollWidth) * element.clientWidth)
    const maxLeft = element.clientWidth - width
    const left = (element.scrollLeft / (element.scrollWidth - element.clientWidth)) * maxLeft
    setScrollbar((current) =>
      current.left === left && current.width === width ? current : { left, width },
    )
  }
  useEffect(() => {
    updateScrollbar()
    const element = tabsRef.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateScrollbar)
    observer.observe(element)
    return () => observer.disconnect()
  }, [group.chatIds.length])
  const activate = (chatId: string) => {
    dispatch({ type: "activate-tab", groupId: group.id, chatId })
    onActiveChatChange(chatId)
    onChatViewed?.(chatId)
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
    if (isGroupDragSource(source)) {
      event.dataTransfer.dropEffect = "move"
      setDragPreview(null)
      setGroupDropZone(source.groupId === group.id ? null : zone)
      return
    }
    setGroupDropZone(null)
    const request = {
      chatId: source.chatId,
      sourceGroupId: source.groupId,
      targetGroupId: group.id,
      zone,
      toIndex,
    }
    if (source.sourceWindowId && source.sourceWindowId !== windowId) {
      const nextPreview: ChatDropPreview =
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
            }
      event.dataTransfer.dropEffect = nextPreview.accepted ? "move" : "none"
      setDragPreview(nextPreview)
      return
    }
    const nextPreview = previewChatDrop(layout, request)
    event.dataTransfer.dropEffect = nextPreview.accepted ? "move" : "none"
    setDragPreview(nextPreview)
  }

  const pointerDropZone = (event: DragEvent<HTMLElement>): ChatDropZone => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const headerOffset = showPaneHeader ? 40 : 0
    const height = Math.max(0, rect.height - headerOffset)
    const y = event.clientY - rect.top - headerOffset
    const insideCenter =
      x > rect.width * 0.25 && x < rect.width * 0.75 && y > height * 0.2 && y < height * 0.8
    if (insideCenter) return "tab"
    if (x < rect.width / 3) return "left"
    if (x > (rect.width / 3) * 2) return "right"
    return y < height / 2 ? "top" : "bottom"
  }

  const indicatorZone =
    groupDropZone ??
    (dragPreview?.accepted && dragPreview.request.targetGroupId === group.id
      ? dragPreview.request.zone
      : null)
  const indicatorStyle = dropOverlayStyle(indicatorZone, showPaneHeader ? 40 : 0)

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
      onPointerDownCapture={() => {
        if (unseenChatIds.has(activeChatId)) onChatViewed?.(activeChatId)
      }}
      onFocusCapture={() => {
        if (layout.activeGroupId !== group.id) activate(activeChatId)
        else if (unseenChatIds.has(activeChatId)) onChatViewed?.(activeChatId)
      }}
      onDragOver={(event) => preview(event, pointerDropZone(event))}
      onDrop={(event) => commitDrop(event, { groupId: group.id, zone: pointerDropZone(event) })}
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setGroupDropZone(null)
          setTabDropTarget(null)
        }
      }}
    >
      {showPaneHeader && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-1">
          <div
            className="relative min-w-0 flex-1"
            onMouseEnter={() => setTabsHovered(true)}
            onMouseLeave={() => setTabsHovered(false)}
          >
            <div
              ref={tabsRef}
              role="tablist"
              aria-label={CHAT_WORKBENCH_A11Y.tabs}
              className="scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto"
              draggable
              data-chat-group-drag-handle={group.id}
              onScroll={updateScrollbar}
              onDragStart={(event) => {
                if (event.target !== event.currentTarget) return
                event.dataTransfer.effectAllowed = "move"
                const source: ChatWorkbenchGroupDragSource = {
                  kind: "group",
                  groupId: group.id,
                  sourceWindowId: windowId,
                }
                event.dataTransfer.setData(CHAT_WORKBENCH_DRAG_MIME, JSON.stringify(source))
                try {
                  localStorage.setItem(CHAT_WORKBENCH_DRAG_SESSION_KEY, JSON.stringify(source))
                } catch {
                  // Native dataTransfer remains the primary path.
                }
              }}
              onDragEnd={() => {
                setGroupDropZone(null)
                setTabDropTarget(null)
                try {
                  localStorage.removeItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)
                } catch {
                  // Ignore unavailable storage in restricted renderer contexts.
                }
              }}
              onDragOver={(event) => {
                event.stopPropagation()
                preview(event, "tab", group.chatIds.length)
              }}
              onDrop={(event) => {
                event.stopPropagation()
                setTabDropTarget(null)
                setGroupDropZone(null)
                commitDrop(event, { groupId: group.id, zone: "tab" })
              }}
            >
              {group.chatIds.map((chatId, index) => {
                const targetGroups = moveMenu.savedGroups.filter(
                  (savedGroup) => savedGroup.id !== moveMenu.activeSavedGroupId,
                )
                const canMove =
                  Boolean(moveMenu.activeSavedGroupId && moveMenu.onMoveChatToMainBar) ||
                  Boolean(moveMenu.onMoveChatToGroup && targetGroups.length > 0)
                return (
                  <ContextMenu key={chatId}>
                    <ContextMenuTrigger asChild>
                      <div
                        draggable={!readOnlyChatIds.has(chatId)}
                        className={cn(
                          "group/tab relative flex h-8 w-44 shrink-0 items-center rounded-md border border-transparent",
                          chatId === activeChatId
                            ? "border-border bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                        style={{ borderTopColor: chatAccents.get(chatId) ?? undefined }}
                        data-chat-tab-drop-side={
                          tabDropTarget?.chatId === chatId ? tabDropTarget.side : undefined
                        }
                        onDragStart={(event) => {
                          configureChatDragFeedback(
                            event.dataTransfer,
                            chatNames.get(chatId) ?? "Chat",
                          )
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
                          event.dataTransfer.setData(
                            CHAT_WORKBENCH_DRAG_MIME,
                            JSON.stringify(source),
                          )
                          try {
                            localStorage.setItem(
                              CHAT_WORKBENCH_DRAG_SESSION_KEY,
                              JSON.stringify(source),
                            )
                          } catch {
                            // Native dataTransfer remains the primary path.
                          }
                        }}
                        onDragOver={(event) => {
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const relativeX = (event.clientX - rect.left) / rect.width
                          const side =
                            relativeX <= 0.25 ? "left" : relativeX >= 0.75 ? "right" : "inside"
                          setTabDropTarget({ chatId, side })
                          preview(
                            event,
                            "tab",
                            side === "inside" ? undefined : index + (side === "right" ? 1 : 0),
                          )
                        }}
                        onDrop={(event) => {
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const relativeX = (event.clientX - rect.left) / rect.width
                          const side =
                            relativeX <= 0.25 ? "left" : relativeX >= 0.75 ? "right" : "inside"
                          preview(
                            event,
                            "tab",
                            side === "inside" ? undefined : index + (side === "right" ? 1 : 0),
                          )
                          setTabDropTarget(null)
                          commitDrop(event, { groupId: group.id, zone: "tab" })
                        }}
                      >
                        {tabDropTarget?.chatId === chatId && tabDropTarget.side !== "inside" && (
                          <span
                            aria-hidden
                            data-chat-tab-insertion
                            className={cn(
                              "pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary",
                              tabDropTarget.side === "left" ? "left-0" : "right-0",
                            )}
                          />
                        )}
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
                          {unseenChatIds.has(chatId) && (
                            <span className="sr-only">, new response</span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={`Close ${chatNames.get(chatId) ?? "Chat"} presentation`}
                          className={cn(
                            "relative mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted group-hover/tab:opacity-100 focus-visible:opacity-100",
                            chatId === activeChatId && !unseenChatIds.has(chatId) && "opacity-60",
                            unseenChatIds.has(chatId) && "opacity-100",
                          )}
                          onClick={() => dispatch({ type: "close-tab", groupId: group.id, chatId })}
                        >
                          {unseenChatIds.has(chatId) && (
                            <span
                              aria-hidden
                              data-chat-unseen-indicator={chatId}
                              className="absolute inset-0 flex items-center justify-center transition-opacity group-hover/tab:opacity-0 group-focus-within/tab:opacity-0"
                            >
                              <span className="h-2 w-2 rounded-full bg-[#307BD0]" />
                            </span>
                          )}
                          <X
                            className={cn(
                              "h-3.5 w-3.5",
                              unseenChatIds.has(chatId) &&
                                "opacity-0 transition-opacity group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
                            )}
                          />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      <ContextMenuSub>
                        <ContextMenuSubTrigger disabled={!canMove}>Move</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                          {moveMenu.activeSavedGroupId && moveMenu.onMoveChatToMainBar && (
                            <ContextMenuItem
                              onSelect={() => moveMenu.onMoveChatToMainBar?.(chatId)}
                            >
                              Main bar
                            </ContextMenuItem>
                          )}
                          {targetGroups.map((savedGroup) => (
                            <ContextMenuItem
                              key={savedGroup.id}
                              onSelect={() => moveMenu.onMoveChatToGroup?.(chatId, savedGroup.id)}
                            >
                              {savedGroup.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem
                        disabled={!moveMenu.onCreateGroupFromChat}
                        onSelect={() => moveMenu.onCreateGroupFromChat?.(chatId)}
                      >
                        Add to new group
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onSelect={() => dispatch({ type: "close-tab", groupId: group.id, chatId })}
                      >
                        Close presentation
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
            <span
              aria-hidden
              data-chat-pane-scrollbar
              className={cn(
                "pointer-events-none absolute bottom-0 h-0.5 bg-muted-foreground/45 transition-opacity duration-100",
                tabsHovered && scrollbar.width > 0 ? "opacity-100" : "opacity-0",
              )}
              style={{ left: scrollbar.left, width: scrollbar.width }}
            />
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
              <DropdownMenuItem
                onSelect={() => dispatch({ type: "toggle-maximize", groupId: group.id })}
              >
                {layout.maximizedGroupId === group.id ? "Restore pane" : "Maximize pane"}
              </DropdownMenuItem>
              {layout.activeGroupId === group.id &&
                readOnlyChatIds.has(activeChatId) &&
                onClaimOwnership && (
                  <DropdownMenuItem onSelect={() => void onClaimOwnership(activeChatId)}>
                    Take ownership here
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
      )}
      <div
        id={panelId(group.id, activeChatId)}
        role="tabpanel"
        aria-labelledby={tabId(group.id, activeChatId)}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {renderedChat}
      </div>
      {indicatorZone && (
        <div
          aria-hidden
          data-chat-drop-overlay={indicatorZone}
          className="pointer-events-none absolute z-30 bg-primary/20 outline outline-1 -outline-offset-1 outline-primary/70 transition-[top,left,width,height,opacity] duration-75 ease-out"
          style={indicatorStyle}
        />
      )}
    </section>
  )
}

function readDrag(event: DragEvent): ChatWorkbenchAnyDragSource | null {
  try {
    const serialized =
      event.dataTransfer.getData(CHAT_WORKBENCH_DRAG_MIME) ||
      localStorage.getItem(CHAT_WORKBENCH_DRAG_SESSION_KEY) ||
      ""
    const parsed = JSON.parse(serialized) as {
      kind?: unknown
      chatId?: unknown
      groupId?: unknown
      sourceWindowId?: unknown
    }
    if (parsed.kind === "group" && typeof parsed.groupId === "string") {
      return {
        kind: "group",
        groupId: parsed.groupId,
        sourceWindowId: typeof parsed.sourceWindowId === "string" ? parsed.sourceWindowId : "main",
      }
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

function isGroupDragSource(
  source: ChatWorkbenchAnyDragSource,
): source is ChatWorkbenchGroupDragSource {
  return "kind" in source && source.kind === "group"
}

function dropOverlayStyle(zone: ChatDropZone | null, headerOffset: number) {
  const contentHeight = headerOffset ? `calc(100% - ${headerOffset}px)` : "100%"
  const base = { top: `${headerOffset}px`, left: "0%", width: "100%", height: contentHeight }
  if (zone === "left") return { ...base, width: "50%" }
  if (zone === "right") return { ...base, left: "50%", width: "50%" }
  if (zone === "top")
    return { ...base, height: headerOffset ? `calc((100% - ${headerOffset}px) / 2)` : "50%" }
  if (zone === "bottom") {
    return {
      ...base,
      top: headerOffset ? `calc(${headerOffset}px + (100% - ${headerOffset}px) / 2)` : "50%",
      height: headerOffset ? `calc((100% - ${headerOffset}px) / 2)` : "50%",
    }
  }
  return base
}

function sameChatDropPreview(
  current: ChatDropPreview | null,
  next: ChatDropPreview | null,
): boolean {
  if (current === next) return true
  if (!current || !next || current.accepted !== next.accepted) return false
  const a = current.request
  const b = next.request
  return (
    a.chatId === b.chatId &&
    a.sourceGroupId === b.sourceGroupId &&
    a.targetGroupId === b.targetGroupId &&
    a.zone === b.zone &&
    a.toIndex === b.toIndex
  )
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
  if (action.type === "move-group") return `Moved Chat pane ${action.zone}`
  if (action.type === "apply-preset") return `Applied ${action.preset} layout`
  return "Active Chat changed"
}

function dropAction(preview: Extract<ChatDropPreview, { accepted: true }>): ChatWorkbenchAction {
  if (
    preview.request.sourceGroupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID &&
    preview.request.zone === "tab"
  ) {
    return {
      type: "open-tab",
      groupId: preview.request.targetGroupId,
      chatId: preview.request.chatId,
    }
  }
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
