import {
  useMemo,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Columns2, Copy, PanelTopClose, PictureInPicture2, Plus, Rows2, X } from "lucide-react"
import type {
  SavedWorkspaceLayout,
  SavedWorkspaceLayoutNode,
  SavedWorkspacePaneBinding,
} from "../../../shared/saved-workspaces"
import { Button } from "../../components/ui/button"
import { cn } from "../../lib/utils"
import {
  getVisibleWorkspaceChatPaneIds,
  reduceWorkspaceLayout,
  type SavedWorkspacePane,
  type WorkspaceLayoutAction,
} from "./layout-reducer"

const PANE_DRAG_TYPE = "application/x-flapstack-workspace-pane"

export type WorkspacePaneState = { kind: "ready" } | { kind: "stale" | "missing"; message: string }

export const SAVED_WORKSPACE_A11Y = {
  shell: "Saved workspace layout",
  toolbar: "Saved workspace layout actions",
  tabs: "Workspace pane tabs",
  resize: "Resize workspace panes",
} as const

export function WorkspaceLayoutShell({
  layout,
  onLayoutChange,
  paneStates = {},
  renderPane,
  onRequestAddPane,
  onPopOutPane,
  popoutPaneId,
  onPullBackPane,
  structuralReadOnly = false,
  idFactory = defaultId,
}: {
  layout: SavedWorkspaceLayout
  onLayoutChange: (layout: SavedWorkspaceLayout, action: WorkspaceLayoutAction) => void
  paneStates?: Record<string, WorkspacePaneState | undefined>
  renderPane?: (pane: SavedWorkspacePane) => ReactNode
  onRequestAddPane?: (groupId: string) => void
  onPopOutPane?: (pane: SavedWorkspacePane) => void
  popoutPaneId?: string
  onPullBackPane?: (pane: SavedWorkspacePane) => void
  structuralReadOnly?: boolean
  idFactory?: (prefix: string) => string
}) {
  const visibleChatPaneIds = useMemo(
    () => new Set(getVisibleWorkspaceChatPaneIds(layout)),
    [layout],
  )
  const dispatch = (action: WorkspaceLayoutAction) => {
    onLayoutChange(reduceWorkspaceLayout(layout, action), action)
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background"
      aria-label={SAVED_WORKSPACE_A11Y.shell}
      data-saved-workspace-shell
      data-structural-read-only={structuralReadOnly || undefined}
    >
      <WorkspaceNode
        node={layout.root}
        dispatch={dispatch}
        paneStates={paneStates}
        renderPane={renderPane}
        onRequestAddPane={structuralReadOnly ? undefined : onRequestAddPane}
        onPopOutPane={onPopOutPane}
        popoutPaneId={popoutPaneId}
        onPullBackPane={onPullBackPane}
        structuralReadOnly={structuralReadOnly}
        visibleChatPaneIds={visibleChatPaneIds}
        idFactory={idFactory}
      />
    </section>
  )
}

function WorkspaceNode({
  node,
  dispatch,
  paneStates,
  renderPane,
  onRequestAddPane,
  onPopOutPane,
  popoutPaneId,
  onPullBackPane,
  structuralReadOnly,
  visibleChatPaneIds,
  idFactory,
}: {
  node: SavedWorkspaceLayoutNode
  dispatch: (action: WorkspaceLayoutAction) => void
  paneStates: Record<string, WorkspacePaneState | undefined>
  renderPane?: (pane: SavedWorkspacePane) => ReactNode
  onRequestAddPane?: (groupId: string) => void
  onPopOutPane?: (pane: SavedWorkspacePane) => void
  popoutPaneId?: string
  onPullBackPane?: (pane: SavedWorkspacePane) => void
  structuralReadOnly: boolean
  visibleChatPaneIds: Set<string>
  idFactory: (prefix: string) => string
}) {
  if (node.type === "tabs") {
    return (
      <WorkspaceTabGroup
        node={node}
        dispatch={dispatch}
        paneStates={paneStates}
        renderPane={renderPane}
        onRequestAddPane={onRequestAddPane}
        onPopOutPane={onPopOutPane}
        popoutPaneId={popoutPaneId}
        onPullBackPane={onPullBackPane}
        structuralReadOnly={structuralReadOnly}
        visibleChatPaneIds={visibleChatPaneIds}
        idFactory={idFactory}
      />
    )
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1",
        node.direction === "row" ? "flex-row" : "flex-col",
      )}
      data-workspace-split={node.id}
      data-direction={node.direction}
    >
      {node.children.map((child, index) => (
        <ResizePair
          key={child.id}
          split={node}
          index={index}
          dispatch={dispatch}
          structuralReadOnly={structuralReadOnly}
        >
          <WorkspaceNode
            node={child}
            dispatch={dispatch}
            paneStates={paneStates}
            renderPane={renderPane}
            onRequestAddPane={onRequestAddPane}
            onPopOutPane={onPopOutPane}
            popoutPaneId={popoutPaneId}
            onPullBackPane={onPullBackPane}
            structuralReadOnly={structuralReadOnly}
            visibleChatPaneIds={visibleChatPaneIds}
            idFactory={idFactory}
          />
        </ResizePair>
      ))}
    </div>
  )
}

function ResizePair({
  split,
  index,
  dispatch,
  structuralReadOnly,
  children,
}: {
  split: Extract<SavedWorkspaceLayoutNode, { type: "split" }>
  index: number
  dispatch: (action: WorkspaceLayoutAction) => void
  structuralReadOnly: boolean
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const total = split.sizes.reduce((sum, size) => sum + size, 0)
  const percentage = (split.sizes[index] / total) * 100

  const resizeBy = (delta: number) => {
    if (index >= split.children.length - 1) return
    const sizes = [...split.sizes]
    sizes[index] = Math.max(0.05, sizes[index] + delta * total)
    sizes[index + 1] = Math.max(0.05, sizes[index + 1] - delta * total)
    dispatch({ type: "resize-split", splitId: split.id, sizes })
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (index >= split.children.length - 1) return
    event.preventDefault()
    const start = split.direction === "row" ? event.clientX : event.clientY
    const parent = containerRef.current?.parentElement
    const extent = split.direction === "row" ? parent?.clientWidth : parent?.clientHeight
    if (!extent) return
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const current = split.direction === "row" ? moveEvent.clientX : moveEvent.clientY
      resizeBy((current - start) / extent)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const backwards =
      split.direction === "row" ? event.key === "ArrowLeft" : event.key === "ArrowUp"
    const forwards =
      split.direction === "row" ? event.key === "ArrowRight" : event.key === "ArrowDown"
    if (!backwards && !forwards) return
    event.preventDefault()
    resizeBy(backwards ? -0.05 : 0.05)
  }

  return (
    <>
      <div
        ref={containerRef}
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: `${percentage}%`, flexGrow: split.sizes[index], flexShrink: 1 }}
      >
        {children}
      </div>
      {!structuralReadOnly && index < split.children.length - 1 && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={SAVED_WORKSPACE_A11Y.resize}
          aria-orientation={split.direction === "row" ? "vertical" : "horizontal"}
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(percentage)}
          className={cn(
            "z-10 shrink-0 bg-border outline-none hover:bg-primary/60 focus-visible:bg-primary",
            split.direction === "row" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
          )}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        />
      )}
    </>
  )
}

function WorkspaceTabGroup({
  node,
  dispatch,
  paneStates,
  renderPane,
  onRequestAddPane,
  onPopOutPane,
  popoutPaneId,
  onPullBackPane,
  structuralReadOnly,
  visibleChatPaneIds,
  idFactory,
}: {
  node: Extract<SavedWorkspaceLayoutNode, { type: "tabs" }>
  dispatch: (action: WorkspaceLayoutAction) => void
  paneStates: Record<string, WorkspacePaneState | undefined>
  renderPane?: (pane: SavedWorkspacePane) => ReactNode
  onRequestAddPane?: (groupId: string) => void
  onPopOutPane?: (pane: SavedWorkspacePane) => void
  popoutPaneId?: string
  onPullBackPane?: (pane: SavedWorkspacePane) => void
  structuralReadOnly: boolean
  visibleChatPaneIds: Set<string>
  idFactory: (prefix: string) => string
}) {
  const active = node.panes.find((pane) => pane.id === node.activePaneId) ?? node.panes[0]
  const activateByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, paneIndex: number) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = (paneIndex + 1) % node.panes.length
    if (event.key === "ArrowLeft")
      nextIndex = (paneIndex - 1 + node.panes.length) % node.panes.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = node.panes.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = node.panes[nextIndex]
    dispatch({ type: "activate-pane", groupId: node.id, paneId: next.id })
    document.getElementById(tabId(node.id, next.id))?.focus()
  }
  const handleDrop = (event: DragEvent<HTMLButtonElement>, toIndex: number) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData(PANE_DRAG_TYPE)
    if (!raw) return
    try {
      const source = JSON.parse(raw) as { paneId: string; groupId: string }
      dispatch({
        type: "move-pane",
        paneId: source.paneId,
        fromGroupId: source.groupId,
        toGroupId: node.id,
        toIndex,
      })
    } catch {
      // Ignore external or malformed drags.
    }
  }

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      aria-label={`Pane group ${node.id}`}
    >
      <div className="flex min-w-0 items-center gap-1 border-b border-border bg-muted/30 px-1 py-1">
        <div
          role="tablist"
          aria-label={SAVED_WORKSPACE_A11Y.tabs}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {node.panes.map((pane, index) => (
            <button
              key={pane.id}
              id={tabId(node.id, pane.id)}
              type="button"
              role="tab"
              aria-selected={pane.id === active.id}
              aria-controls={panelId(node.id, pane.id)}
              tabIndex={pane.id === active.id ? 0 : -1}
              draggable={!popoutPaneId && !structuralReadOnly}
              className={cn(
                "max-w-48 truncate rounded px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary",
                pane.id === active.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={() => dispatch({ type: "activate-pane", groupId: node.id, paneId: pane.id })}
              onKeyDown={(event) => activateByKeyboard(event, index)}
              onDragStart={
                structuralReadOnly
                  ? undefined
                  : (event) => {
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        PANE_DRAG_TYPE,
                        JSON.stringify({ paneId: pane.id, groupId: node.id }),
                      )
                    }
              }
              onDragOver={structuralReadOnly ? undefined : (event) => event.preventDefault()}
              onDrop={structuralReadOnly ? undefined : (event) => handleDrop(event, index)}
            >
              {pane.title ?? bindingLabel(pane.binding)}
            </button>
          ))}
        </div>
        <div
          className="flex shrink-0 items-center"
          role="toolbar"
          aria-label={SAVED_WORKSPACE_A11Y.toolbar}
        >
          {popoutPaneId === active.id && onPullBackPane ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Pull active pane back into its workspace window"
              onClick={() => onPullBackPane(active)}
            >
              <PanelTopClose className="h-3.5 w-3.5" />
            </Button>
          ) : onPopOutPane ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Pop active pane out to a new window"
              onClick={() => onPopOutPane(active)}
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onRequestAddPane && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Add pane to this group"
              onClick={() => onRequestAddPane(node.id)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          {!popoutPaneId && !structuralReadOnly && (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Duplicate active pane as tab"
                onClick={() =>
                  dispatch({
                    type: "duplicate-tab",
                    groupId: node.id,
                    paneId: active.id,
                    newPaneId: idFactory("pane"),
                  })
                }
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove active pane"
                disabled={node.panes.length <= 1}
                onClick={() =>
                  dispatch({ type: "remove-pane", groupId: node.id, paneId: active.id })
                }
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Split panes horizontally"
                onClick={() =>
                  dispatch({
                    type: "split-group",
                    groupId: node.id,
                    direction: "row",
                    splitId: idFactory("split"),
                    newGroupId: idFactory("group"),
                    newPaneId: idFactory("pane"),
                  })
                }
              >
                <Columns2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Split panes vertically"
                onClick={() =>
                  dispatch({
                    type: "split-group",
                    groupId: node.id,
                    direction: "column",
                    splitId: idFactory("split"),
                    newGroupId: idFactory("group"),
                    newPaneId: idFactory("pane"),
                  })
                }
              >
                <Rows2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        id={panelId(node.id, active.id)}
        role="tabpanel"
        aria-labelledby={tabId(node.id, active.id)}
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <WorkspacePaneContent
          pane={active}
          paneState={paneStates[active.id]}
          renderPane={renderPane}
          chatVisible={active.binding.type !== "chat" || visibleChatPaneIds.has(active.id)}
        />
      </div>
    </section>
  )
}

function WorkspacePaneContent({
  pane,
  paneState,
  renderPane,
  chatVisible,
}: {
  pane: SavedWorkspacePane
  paneState?: WorkspacePaneState
  renderPane?: (pane: SavedWorkspacePane) => ReactNode
  chatVisible: boolean
}) {
  if (paneState && paneState.kind !== "ready") {
    return (
      <div
        className="flex h-full min-h-40 items-center justify-center p-6 text-center"
        role="status"
      >
        <div>
          <p className="font-medium">
            {paneState.kind === "missing" ? "Pane target missing" : "Pane target is stale"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{paneState.message}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Repair or remove this pane. Other panes remain available.
          </p>
        </div>
      </div>
    )
  }
  if (!chatVisible) {
    return (
      <div
        className="flex h-full min-h-40 items-center justify-center p-6 text-center"
        role="status"
      >
        <p className="text-sm text-muted-foreground">
          Chat moved to overflow tabs to keep four visible chats.
        </p>
      </div>
    )
  }
  if (renderPane) return renderPane(pane)
  return (
    <div
      className="flex h-full min-h-40 items-center justify-center p-6 text-center"
      data-pane-binding={pane.binding.type}
    >
      <div>
        <p className="font-medium">{bindingLabel(pane.binding)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pane binding is saved. Surface rendering is supplied by the pane adapter.
        </p>
      </div>
    </div>
  )
}

function bindingLabel(binding: SavedWorkspacePaneBinding): string {
  switch (binding.type) {
    case "chat":
      return "Chat"
    case "terminal":
      return "Terminal"
    case "diff":
      return "Diff"
    case "file":
      return "File"
    case "browser":
      return "Browser"
    case "agent-roster":
      return "Agent roster"
    case "selected-agent":
      return "Selected agent"
    case "activity":
      return "Activity"
  }
}

function tabId(groupId: string, paneId: string) {
  return `workspace-tab-${groupId}-${paneId}`
}

function panelId(groupId: string, paneId: string) {
  return `workspace-panel-${groupId}-${paneId}`
}

function defaultId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
