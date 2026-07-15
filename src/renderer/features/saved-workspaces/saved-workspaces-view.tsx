import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { PanelsTopLeft, Save } from "lucide-react"
import type {
  SavedWorkspaceLayout,
  SavedWorkspaceLayoutNode,
  SavedWorkspacePaneBinding,
  SavedWorkspacePinnedContext,
} from "../../../shared/saved-workspaces"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { trpc } from "../../lib/trpc"
import {
  createSingleChatWorkspaceLayout,
  enforceWorkspaceChatCap,
  getWorkspaceGroups,
  reduceWorkspaceLayout,
  type WorkspaceLayoutAction,
} from "./layout-reducer"
import {
  readPendingWorkspaceLayout,
  readSavedWorkspaceSelection,
  writePendingWorkspaceLayout,
  writeSavedWorkspaceSelection,
} from "./selection-storage"
import { WorkspaceLayoutShell } from "./workspace-layout-shell"
import { WorkspacePaneAdapter, WorkspacePaneBindingForm } from "./pane-adapters"
import { workspacePaneChatIds } from "./workspace-window-ownership"

const AUTO_SAVE_DELAY_MS = 400

export function SavedWorkspacesView({
  projectId,
  initialChatId,
  initialWorkspaceId,
  popoutPaneId,
  initialSkipPaneId,
}: {
  projectId: string | null
  initialChatId: string | null
  initialWorkspaceId?: string
  popoutPaneId?: string
  initialSkipPaneId?: string
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    () => initialWorkspaceId ?? (projectId ? readSavedWorkspaceSelection(projectId) : null),
  )
  const [name, setName] = useState("Workspace")
  const [layout, setLayout] = useState<SavedWorkspaceLayout | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string>("")
  const [addPaneGroupId, setAddPaneGroupId] = useState<string | null>(null)
  const loadedWorkspaceId = useRef<string | null>(null)
  const saveInFlight = useRef(false)
  const saveQueued = useRef(false)
  const layoutRevision = useRef(0)
  const latestLayout = useRef<SavedWorkspaceLayout | null>(null)
  const latestVersion = useRef<number | null>(null)
  const workspaceGeneration = useRef(0)
  const currentWorkspaceId = useRef<string | null>(selectedWorkspaceId)
  const saveCurrentRef = useRef<() => Promise<void>>(async () => undefined)
  const utils = trpc.useUtils()

  const list = trpc.savedWorkspaces.list.useQuery(
    projectId ? { projectId, archive: "active" } : {},
    { enabled: Boolean(projectId) },
  )
  const selected = trpc.savedWorkspaces.get.useQuery(
    { workspaceId: selectedWorkspaceId ?? "" },
    { enabled: Boolean(selectedWorkspaceId) },
  )
  const createMutation = trpc.savedWorkspaces.create.useMutation()
  const saveMutation = trpc.savedWorkspaces.saveLayout.useMutation()
  const initialWorkspaceMissing = Boolean(
    initialWorkspaceId &&
    list.data &&
    !list.data.some((workspace) => workspace.id === initialWorkspaceId),
  )

  useEffect(() => {
    workspaceGeneration.current += 1
    loadedWorkspaceId.current = null
    currentWorkspaceId.current = null
    latestLayout.current = null
    latestVersion.current = null
    layoutRevision.current = 0
    saveQueued.current = false
    setLayout(null)
    setDirty(false)
    setStatus("")
    setSelectedWorkspaceId(
      initialWorkspaceId ?? (projectId ? readSavedWorkspaceSelection(projectId) : null),
    )
  }, [initialWorkspaceId, projectId])

  useEffect(() => {
    const workspaces = list.data ?? []
    if (!projectId || list.isLoading || !list.data) return
    if (initialWorkspaceId) {
      setSelectedWorkspaceId(
        workspaces.some((workspace) => workspace.id === initialWorkspaceId)
          ? initialWorkspaceId
          : null,
      )
      return
    }
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null)
      return
    }
    if (
      !selectedWorkspaceId ||
      !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      const restored = readSavedWorkspaceSelection(projectId)
      const next = workspaces.find((workspace) => workspace.id === restored)?.id ?? workspaces[0].id
      setSelectedWorkspaceId(next)
      writeSavedWorkspaceSelection(projectId, next)
    }
  }, [initialWorkspaceId, list.data, list.isLoading, projectId, selectedWorkspaceId])

  useEffect(() => {
    const record = selected.data
    if (!record || loadedWorkspaceId.current === record.id) return
    loadedWorkspaceId.current = record.id
    const pendingLayout = readPendingWorkspaceLayout(record.id)
    const canRestorePending = pendingLayout?.expectedVersion === record.version
    const restoredLayout = canRestorePending
      ? pendingLayout.layout
      : record.layout
        ? enforceWorkspaceChatCap(record.layout)
        : null
    currentWorkspaceId.current = record.id
    latestLayout.current = restoredLayout
    latestVersion.current = record.version
    layoutRevision.current = canRestorePending ? 1 : 0
    saveQueued.current = false
    setLayout(restoredLayout)
    setDirty(canRestorePending)
    setStatus(
      canRestorePending
        ? "Recovered unsaved workspace changes. Saving…"
        : record.layoutIssue
          ? "Workspace layout needs repair."
          : "Workspace restored.",
    )
  }, [selected.data])

  const selectWorkspace = (workspaceId: string) => {
    if (dirty || saveInFlight.current) {
      setStatus("Save workspace changes before switching.")
      return
    }
    workspaceGeneration.current += 1
    loadedWorkspaceId.current = null
    currentWorkspaceId.current = workspaceId
    latestLayout.current = null
    latestVersion.current = null
    layoutRevision.current = 0
    saveQueued.current = false
    setSelectedWorkspaceId(workspaceId)
    setLayout(null)
    setDirty(false)
    if (projectId) writeSavedWorkspaceSelection(projectId, workspaceId)
  }

  const saveCurrent = useCallback(async () => {
    if (saveInFlight.current) {
      saveQueued.current = true
      return
    }
    const workspaceId = currentWorkspaceId.current
    const layoutToSave = latestLayout.current
    const versionToSave = latestVersion.current
    if (!workspaceId || !layoutToSave || versionToSave === null) return
    const revisionToSave = layoutRevision.current
    const generationToSave = workspaceGeneration.current
    saveInFlight.current = true
    setSaving(true)
    setStatus("Saving workspace…")
    try {
      const result = await saveMutation.mutateAsync({
        workspaceId,
        expectedVersion: versionToSave,
        layout: layoutToSave,
      })
      if (
        workspaceGeneration.current !== generationToSave ||
        currentWorkspaceId.current !== workspaceId
      ) {
        return
      }
      loadedWorkspaceId.current = result.workspace.id
      latestVersion.current = result.workspace.version
      if (layoutRevision.current === revisionToSave) {
        const persistedLayout = result.workspace.layout ?? layoutToSave
        latestLayout.current = persistedLayout
        writePendingWorkspaceLayout(workspaceId, null)
        setLayout(persistedLayout)
        setDirty(false)
        setStatus("Workspace saved.")
      } else {
        saveQueued.current = true
        setDirty(true)
        setStatus("Newer workspace changes queued for save.")
      }
      await Promise.all([
        utils.savedWorkspaces.list.invalidate(),
        utils.savedWorkspaces.get.invalidate({ workspaceId }),
        utils.savedWorkspaces.resolvePane.invalidate(),
      ])
    } catch (error) {
      if (
        workspaceGeneration.current === generationToSave &&
        currentWorkspaceId.current === workspaceId
      ) {
        saveQueued.current = false
        setStatus(error instanceof Error ? error.message : "Workspace save failed.")
      }
    } finally {
      saveInFlight.current = false
      setSaving(false)
      if (saveQueued.current) {
        saveQueued.current = false
        queueMicrotask(() => void saveCurrentRef.current())
      }
    }
  }, [saveMutation, utils.savedWorkspaces.get, utils.savedWorkspaces.list])
  saveCurrentRef.current = saveCurrent

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => void saveCurrent(), AUTO_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, layout, saveCurrent])

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [dirty])

  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    if (dirty || saveInFlight.current) {
      setStatus("Save workspace changes before creating another workspace.")
      return
    }
    if (!projectId || !initialChatId || !name.trim()) return
    setStatus("Creating workspace…")
    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        scope: { type: "project", projectId },
        layout: createSingleChatWorkspaceLayout(initialChatId, {
          groupId: uniqueId("group"),
          paneId: uniqueId("pane"),
        }),
      })
      loadedWorkspaceId.current = result.workspace.id
      workspaceGeneration.current += 1
      currentWorkspaceId.current = result.workspace.id
      latestLayout.current = result.workspace.layout
      latestVersion.current = result.workspace.version
      layoutRevision.current = 0
      saveQueued.current = false
      setSelectedWorkspaceId(result.workspace.id)
      setLayout(result.workspace.layout)
      setDirty(false)
      setStatus("Workspace created and saved.")
      writeSavedWorkspaceSelection(projectId, result.workspace.id)
      await utils.savedWorkspaces.list.invalidate()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workspace creation failed.")
    }
  }

  const changeLayout = (next: SavedWorkspaceLayout, _action: WorkspaceLayoutAction) => {
    layoutRevision.current += 1
    latestLayout.current = next
    const workspaceId = currentWorkspaceId.current
    const expectedVersion = latestVersion.current
    if (workspaceId && expectedVersion !== null) {
      writePendingWorkspaceLayout(workspaceId, { layout: next, expectedVersion })
    }
    if (saveInFlight.current) saveQueued.current = true
    setLayout(next)
    setDirty(true)
    setStatus("Workspace has unsaved layout changes.")
  }

  const dispatchLayout = (action: WorkspaceLayoutAction) => {
    if (!layout) return
    changeLayout(reduceWorkspaceLayout(layout, action), action)
  }

  const groupForPane = (paneId: string) =>
    layout
      ? getWorkspaceGroups(layout).find((group) => group.panes.some((pane) => pane.id === paneId))
      : null

  const addPane = (binding: SavedWorkspacePaneBinding) => {
    if (!addPaneGroupId) return
    dispatchLayout({
      type: "add-pane",
      groupId: addPaneGroupId,
      pane: {
        id: uniqueId("pane"),
        title: paneTitle(binding),
        binding,
      },
    })
    setAddPaneGroupId(null)
  }

  const workspaceOptions = useMemo(() => list.data ?? [], [list.data])
  const windowLayout = useMemo(
    () =>
      layout
        ? resolveWorkspaceWindowLayout(layout, {
            paneId: popoutPaneId,
            skipPaneId: initialSkipPaneId,
          })
        : null,
    [initialSkipPaneId, layout, popoutPaneId],
  )
  const displayedLayout = windowLayout?.kind === "ready" ? windowLayout.layout : null
  const derivedWindowLayout = Boolean(popoutPaneId || initialSkipPaneId)

  const popOutPane = async (pane: Parameters<typeof workspacePaneChatIds>[0]) => {
    if (!selectedWorkspaceId || !projectId) return
    const result = await window.desktopApi?.openWorkspacePane?.({
      projectId,
      workspaceId: selectedWorkspaceId,
      paneId: pane.id,
      chatIds: workspacePaneChatIds(pane),
    })
    setStatus(
      result?.ok
        ? result.state === "opened"
          ? "Pane opened in a stable workspace window."
          : "Focused the existing pane window."
        : result?.reason === "recovering"
          ? "Pane window is recovering. Try again after it reloads."
          : `Pane remains owned by ${result?.ownerStableId ?? "another window"}.`,
    )
  }

  const pullBackPane = async (pane: Parameters<typeof workspacePaneChatIds>[0]) => {
    if (!selectedWorkspaceId) return
    const result = await window.desktopApi?.pullBackWorkspacePane?.(selectedWorkspaceId, pane.id)
    setStatus(
      result?.ok
        ? "Pane returned to its workspace window."
        : "No workspace window is available for pull-back.",
    )
  }

  const openWorkspaceWindow = async () => {
    if (!selectedWorkspaceId || !projectId || !layout) return
    const result = await window.desktopApi?.openWorkspaceWindow?.({
      projectId,
      workspaceId: selectedWorkspaceId,
      panes: getWorkspaceGroups(layout).flatMap((group) =>
        group.panes.map((pane) => ({ paneId: pane.id, chatIds: workspacePaneChatIds(pane) })),
      ),
    })
    setStatus(
      result?.ok
        ? result.state === "opened"
          ? "Workspace moved to a stable window."
          : "Focused the existing workspace window."
        : result?.reason === "recovering"
          ? "Workspace window is recovering. Try again after it reloads."
          : `Workspace remains owned by ${result?.ownerStableId ?? "another window"}.`,
    )
  }

  if (!projectId) {
    return (
      <WorkspaceNotice title="No project selected">
        Select a project before opening saved workspaces.
      </WorkspaceNotice>
    )
  }

  return (
    <main className="flex h-full min-h-0 flex-col gap-3 p-3" aria-label="Saved workspaces">
      <header className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
        {popoutPaneId && (
          <span className="text-sm font-medium">
            Workspace pane <span className="font-mono text-xs">{popoutPaneId}</span>
          </span>
        )}
        {!popoutPaneId && (
          <>
            <label className="sr-only" htmlFor="saved-workspace-picker">
              Saved workspace
            </label>
            <select
              id="saved-workspace-picker"
              aria-label="Saved workspace"
              className="h-9 min-w-48 rounded-lg border border-input bg-background px-3 text-sm"
              value={selectedWorkspaceId ?? ""}
              onChange={(event) => selectWorkspace(event.target.value)}
              disabled={
                workspaceOptions.length === 0 || dirty || saving || Boolean(initialWorkspaceId)
              }
            >
              {workspaceOptions.length === 0 && <option value="">No saved workspaces</option>}
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <form className="flex min-w-64 flex-1 items-center gap-2" onSubmit={createWorkspace}>
              <label className="sr-only" htmlFor="saved-workspace-name">
                New workspace name
              </label>
              <Input
                id="saved-workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workspace name"
                maxLength={256}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!initialChatId || createMutation.isPending || dirty || saving}
              >
                Create from chat
              </Button>
            </form>
            <Button
              type="button"
              onClick={() => void saveCurrent()}
              disabled={!dirty || saveMutation.isPending}
            >
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!layout}
              onClick={() => void openWorkspaceWindow()}
            >
              <PanelsTopLeft className="mr-1 h-4 w-4" /> Open workspace window
            </Button>
          </>
        )}
      </header>
      <div className="min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">
        {status ||
          (!initialChatId ? "Open a chat to create a workspace." : "Select or create a workspace.")}
      </div>
      <div className="min-h-0 flex-1">
        {initialWorkspaceMissing ? (
          <WorkspaceNotice title="Workspace target needs repair">
            Workspace {initialWorkspaceId} no longer exists in this project. Close this window or
            repair the saved window target.
          </WorkspaceNotice>
        ) : selected.isLoading ? (
          <WorkspaceNotice title="Restoring workspace">
            Loading the last saved layout…
          </WorkspaceNotice>
        ) : selected.error ? (
          <WorkspaceNotice
            title={initialWorkspaceId ? "Workspace target needs repair" : "Workspace unavailable"}
          >
            {selected.error.message}
          </WorkspaceNotice>
        ) : selected.data?.layoutIssue ? (
          <WorkspaceNotice title="Workspace layout needs repair">
            {selected.data.layoutIssue} Valid workspace metadata was preserved.
          </WorkspaceNotice>
        ) : windowLayout?.kind === "repair" ? (
          <WorkspaceNotice title="Workspace window target needs repair">
            {windowLayout.message}
          </WorkspaceNotice>
        ) : windowLayout?.kind === "empty" ? (
          <WorkspaceNotice title="No remaining workspace panes">
            {windowLayout.message}
          </WorkspaceNotice>
        ) : displayedLayout ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {addPaneGroupId && (
              <section
                className="shrink-0 rounded-lg border border-border bg-muted/20 p-3"
                aria-label="Add workspace pane"
              >
                <h2 className="text-sm font-medium">Add pane</h2>
                <WorkspacePaneBindingForm
                  submitLabel="Add pane"
                  onSubmit={addPane}
                  onCancel={() => setAddPaneGroupId(null)}
                />
              </section>
            )}
            <div className="min-h-0 flex-1">
              <WorkspaceLayoutShell
                layout={displayedLayout}
                onLayoutChange={(next, action) => {
                  if (!derivedWindowLayout) changeLayout(next, action)
                  else if (action.type === "activate-pane") dispatchLayout(action)
                }}
                onRequestAddPane={derivedWindowLayout ? undefined : setAddPaneGroupId}
                onPopOutPane={popoutPaneId ? undefined : (pane) => void popOutPane(pane)}
                popoutPaneId={popoutPaneId}
                onPullBackPane={popoutPaneId ? (pane) => void pullBackPane(pane) : undefined}
                structuralReadOnly={derivedWindowLayout}
                renderPane={(pane) => {
                  const group = groupForPane(pane.id)
                  return (
                    <WorkspacePaneAdapter
                      projectId={projectId}
                      workspaceId={selectedWorkspaceId!}
                      pane={pane}
                      onReplaceBinding={(binding) =>
                        dispatchLayout({ type: "replace-binding", paneId: pane.id, binding })
                      }
                      onRemove={() => {
                        if (group)
                          dispatchLayout({
                            type: "remove-pane",
                            groupId: group.id,
                            paneId: pane.id,
                          })
                      }}
                      onPinContext={(context: SavedWorkspacePinnedContext) =>
                        dispatchLayout({ type: "pin-context", paneId: pane.id, context })
                      }
                      onUnpinContext={(contextId) =>
                        dispatchLayout({ type: "unpin-context", paneId: pane.id, contextId })
                      }
                    />
                  )
                }}
              />
            </div>
          </div>
        ) : (
          <WorkspaceNotice title="No workspace layout">
            Create a workspace from the currently open chat. Empty state does not create fake pane
            bindings.
          </WorkspaceNotice>
        )}
      </div>
    </main>
  )
}

export function WorkspaceNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-border p-8 text-center"
      role="status"
    >
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">{children}</p>
      </div>
    </section>
  )
}

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function paneTitle(binding: SavedWorkspacePaneBinding): string {
  if (binding.type === "browser") return "Web link"
  if (binding.type === "file") return "File"
  return binding.type.charAt(0).toUpperCase() + binding.type.slice(1)
}

export function isolateWorkspacePane(
  layout: SavedWorkspaceLayout,
  paneId: string,
): SavedWorkspaceLayout | null {
  const group = getWorkspaceGroups(layout).find((candidate) =>
    candidate.panes.some((pane) => pane.id === paneId),
  )
  const pane = group?.panes.find((candidate) => candidate.id === paneId)
  if (!group || !pane) return null
  return {
    version: layout.version,
    root: {
      type: "tabs",
      id: group.id,
      activePaneId: pane.id,
      panes: [pane],
    },
  }
}

export type WorkspaceWindowLayoutResolution =
  | { kind: "ready"; layout: SavedWorkspaceLayout }
  | { kind: "empty"; message: string }
  | { kind: "repair"; message: string }

export function resolveWorkspaceWindowLayout(
  layout: SavedWorkspaceLayout,
  target: { paneId?: string; skipPaneId?: string },
): WorkspaceWindowLayoutResolution {
  if (target.paneId && target.skipPaneId) {
    return { kind: "repair", message: "The window has conflicting pane targets." }
  }
  if (target.paneId) {
    const isolated = isolateWorkspacePane(layout, target.paneId)
    return isolated
      ? { kind: "ready", layout: isolated }
      : {
          kind: "repair",
          message: `Pane ${target.paneId} no longer exists in this workspace. Repair the saved window target.`,
        }
  }
  if (!target.skipPaneId) return { kind: "ready", layout }
  if (!workspaceHasPane(layout.root, target.skipPaneId)) {
    return {
      kind: "repair",
      message: `Pane ${target.skipPaneId} no longer exists in this workspace. Repair the saved window target.`,
    }
  }
  const root = excludeWorkspacePane(layout.root, target.skipPaneId)
  return root
    ? { kind: "ready", layout: { ...layout, root } }
    : {
        kind: "empty",
        message: `Pane ${target.skipPaneId} was excluded; no other panes remain.`,
      }
}

function workspaceHasPane(node: SavedWorkspaceLayoutNode, paneId: string): boolean {
  if (node.type === "tabs") return node.panes.some((pane) => pane.id === paneId)
  return node.children.some((child) => workspaceHasPane(child, paneId))
}

function excludeWorkspacePane(
  node: SavedWorkspaceLayoutNode,
  paneId: string,
): SavedWorkspaceLayoutNode | null {
  if (node.type === "tabs") {
    const panes = node.panes.filter((pane) => pane.id !== paneId)
    if (panes.length === 0) return null
    return {
      ...node,
      activePaneId: panes.some((pane) => pane.id === node.activePaneId)
        ? node.activePaneId
        : panes[0].id,
      panes,
    }
  }
  const kept = node.children.flatMap((child, index) => {
    const next = excludeWorkspacePane(child, paneId)
    return next ? [{ node: next, size: node.sizes[index] }] : []
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].node
  const total = kept.reduce((sum, item) => sum + item.size, 0)
  return {
    ...node,
    children: kept.map((item) => item.node),
    sizes: kept.map((item) => item.size / total),
  }
}
