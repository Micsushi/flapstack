import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { Archive, Copy, PanelsTopLeft, RotateCcw, Save, Trash2 } from "lucide-react"
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
  asWorkbenchWindowCreationFailure,
  describeWorkbenchWindowCreationFailure,
  showWorkbenchWindowCreationFeedback,
} from "../../lib/workbench-window-limit"
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
  initialProjectId,
  initialChatId,
  initialWorkspaceId,
  popoutPaneId,
  initialSkipPaneId,
}: {
  projectId: string | null
  initialProjectId?: string
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
  const [showArchived, setShowArchived] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [lifecycleAction, setLifecycleAction] = useState<"archive" | "delete" | null>(null)
  const loadedWorkspaceId = useRef<string | null>(null)
  const saveInFlight = useRef(false)
  const saveQueued = useRef(false)
  const duplicateInFlight = useRef(false)
  const layoutRevision = useRef(0)
  const latestLayout = useRef<SavedWorkspaceLayout | null>(null)
  const latestVersion = useRef<number | null>(null)
  const workspaceGeneration = useRef(0)
  const currentWorkspaceId = useRef<string | null>(selectedWorkspaceId)
  const saveCurrentRef = useRef<() => Promise<void>>(async () => undefined)
  const utils = trpc.useUtils()

  const list = trpc.savedWorkspaces.list.useQuery(
    projectId
      ? {
          projectId,
          archive: initialWorkspaceId ? "all" : showArchived ? "archived" : "active",
        }
      : {},
    { enabled: Boolean(projectId) },
  )
  const selectedWorkspaceIsMember = Boolean(
    projectId &&
    selectedWorkspaceId &&
    list.data?.some((workspace) => workspace.id === selectedWorkspaceId),
  )
  const selected = trpc.savedWorkspaces.get.useQuery(
    { workspaceId: selectedWorkspaceId ?? "" },
    { enabled: selectedWorkspaceIsMember },
  )
  const operationOwnership = trpc.savedWorkspaces.getOperation.useQuery(
    { workspaceId: selectedWorkspaceId ?? "" },
    {
      enabled: Boolean(selectedWorkspaceIsMember && selected.data?.owner?.kind === "orchestration"),
    },
  )
  const createMutation = trpc.savedWorkspaces.create.useMutation()
  const saveMutation = trpc.savedWorkspaces.saveLayout.useMutation()
  const renameMutation = trpc.savedWorkspaces.rename.useMutation()
  const duplicateMutation = trpc.savedWorkspaces.duplicate.useMutation()
  const archiveMutation = trpc.savedWorkspaces.archive.useMutation()
  const restoreMutation = trpc.savedWorkspaces.restore.useMutation()
  const deleteMutation = trpc.savedWorkspaces.delete.useMutation()
  const lifecyclePreview = trpc.savedWorkspaces.previewDelete.useQuery(
    { workspaceId: selectedWorkspaceId ?? "" },
    { enabled: Boolean(lifecycleAction && selectedWorkspaceIsMember) },
  )
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
    setLifecycleAction(null)
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
    setRenameValue(record.name)
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

  const resetLoadedWorkspace = (workspaceId: string | null) => {
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
  }

  const toggleArchivedWorkspaces = () => {
    if (dirty || saveInFlight.current) {
      setStatus("Save workspace changes before changing the workspace list.")
      return
    }
    const next = !showArchived
    setShowArchived(next)
    setLifecycleAction(null)
    resetLoadedWorkspace(null)
    setStatus(next ? "Showing archived workspaces." : "Showing active workspaces.")
  }

  const invalidateWorkspace = async (workspaceId: string) => {
    await Promise.all([
      utils.savedWorkspaces.list.invalidate(),
      utils.savedWorkspaces.get.invalidate({ workspaceId }),
      utils.savedWorkspaces.resolvePane.invalidate(),
      utils.savedWorkspaces.getOperation.invalidate({ workspaceId }),
    ])
  }

  const renameWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    const workspace = selected.data
    const nextName = renameValue.trim()
    if (!workspace || !nextName || nextName === workspace.name) return
    setStatus("Renaming workspace…")
    try {
      const result = await renameMutation.mutateAsync({
        workspaceId: workspace.id,
        expectedVersion: workspace.version,
        name: nextName,
      })
      loadedWorkspaceId.current = result.workspace.id
      latestVersion.current = result.workspace.version
      setRenameValue(result.workspace.name)
      setStatus("Workspace renamed.")
      await invalidateWorkspace(result.workspace.id)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workspace rename failed.")
    }
  }

  const previewLifecycleAction = (action: "archive" | "delete") => {
    if (dirty || saveInFlight.current) {
      setStatus("Save workspace changes before changing workspace lifecycle.")
      return
    }
    setLifecycleAction(action)
    setStatus(`Review ${action} impact before confirming.`)
  }

  const confirmLifecycleAction = async () => {
    const action = lifecycleAction
    const workspace = selected.data
    const preview = lifecyclePreview.data
    if (!action || !workspace || !preview) return
    const confirmActiveOperationImpact = Boolean(preview.operation?.active)
    setStatus(action === "archive" ? "Archiving workspace…" : "Deleting workspace metadata…")
    try {
      if (action === "archive") {
        const result = await archiveMutation.mutateAsync({
          workspaceId: workspace.id,
          expectedVersion: workspace.version,
          confirmActiveOperationImpact,
        })
        setLifecycleAction(null)
        await invalidateWorkspace(workspace.id)
        if (initialWorkspaceId) {
          loadedWorkspaceId.current = null
          latestVersion.current = result.workspace.version
          setStatus("Workspace archived. Referenced work remains available.")
        } else {
          if (projectId) writeSavedWorkspaceSelection(projectId, null)
          resetLoadedWorkspace(null)
          setStatus("Workspace archived. Referenced work remains available.")
        }
        return
      }
      await deleteMutation.mutateAsync({
        workspaceId: workspace.id,
        expectedVersion: workspace.version,
        confirmActiveOperationImpact,
      })
      setLifecycleAction(null)
      writePendingWorkspaceLayout(workspace.id, null)
      if (projectId) writeSavedWorkspaceSelection(projectId, null)
      resetLoadedWorkspace(null)
      await Promise.all([
        utils.savedWorkspaces.list.invalidate(),
        utils.savedWorkspaces.get.invalidate({ workspaceId: workspace.id }),
        utils.savedWorkspaces.getOperation.invalidate({ workspaceId: workspace.id }),
      ])
      setStatus("Workspace metadata deleted. Referenced work was preserved.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Workspace ${action} failed.`)
    }
  }

  const restoreWorkspace = async () => {
    const workspace = selected.data
    if (!workspace || workspace.archivedAt === null) return
    setStatus("Restoring workspace…")
    try {
      const result = await restoreMutation.mutateAsync({
        workspaceId: workspace.id,
        expectedVersion: workspace.version,
      })
      setShowArchived(false)
      resetLoadedWorkspace(result.workspace.id)
      if (projectId) writeSavedWorkspaceSelection(projectId, result.workspace.id)
      await invalidateWorkspace(result.workspace.id)
      setStatus("Workspace restored.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workspace restore failed.")
    }
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

  const selectOperationAgent = (orchestrationId: string, agentId: string) => {
    if (!layout || selected.data?.archivedAt != null) return
    const selectedPane = getWorkspaceGroups(layout)
      .flatMap((group) => group.panes)
      .find(
        (pane) =>
          pane.binding.type === "selected-agent" &&
          pane.binding.orchestrationId === orchestrationId,
      )
    if (!selectedPane) {
      setStatus("This operation layout has no selected-agent pane. Add or repair one first.")
      return
    }
    dispatchLayout({
      type: "replace-binding",
      paneId: selectedPane.id,
      binding: { type: "selected-agent", orchestrationId, agentId },
    })
    setStatus("Selected agent updated.")
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
  const selectedWorkspaceArchived = selected.data?.archivedAt != null
  const workspaceReadOnly = derivedWindowLayout || selectedWorkspaceArchived

  const duplicateWorkspace = async () => {
    const workspace = selected.data
    if (
      duplicateInFlight.current ||
      !projectId ||
      Boolean(initialWorkspaceId) ||
      !selectedWorkspaceIsMember ||
      !workspace ||
      workspace.owner.kind !== "manual" ||
      workspace.archivedAt !== null ||
      workspaceReadOnly ||
      workspace.layoutIssue ||
      !layout ||
      dirty ||
      saving ||
      saveInFlight.current
    ) {
      return
    }

    const generationToDuplicate = workspaceGeneration.current
    const sourceWorkspaceId = workspace.id
    duplicateInFlight.current = true
    setStatus("Duplicating workspace…")
    try {
      const result = await duplicateMutation.mutateAsync({
        workspaceId: workspace.id,
        expectedVersion: workspace.version,
      })
      const invalidations = await Promise.allSettled([
        utils.savedWorkspaces.list.invalidate({
          projectId,
          archive: initialWorkspaceId ? "all" : "active",
        }),
        utils.savedWorkspaces.get.invalidate({ workspaceId: result.workspace.id }),
      ])
      if (
        workspaceGeneration.current !== generationToDuplicate ||
        currentWorkspaceId.current !== sourceWorkspaceId
      ) {
        return
      }
      writePendingWorkspaceLayout(result.workspace.id, null)
      workspaceGeneration.current += 1
      loadedWorkspaceId.current = result.workspace.id
      currentWorkspaceId.current = result.workspace.id
      latestLayout.current = result.workspace.layout
      latestVersion.current = result.workspace.version
      layoutRevision.current = 0
      saveQueued.current = false
      setSelectedWorkspaceId(result.workspace.id)
      setLayout(result.workspace.layout)
      setRenameValue(result.workspace.name)
      setDirty(false)
      writeSavedWorkspaceSelection(projectId, result.workspace.id)
      setStatus(
        invalidations.some((invalidation) => invalidation.status === "rejected")
          ? `Workspace duplicated as ${result.workspace.name}. Refresh the workspace list to see the latest data.`
          : `Workspace duplicated as ${result.workspace.name}.`,
      )
    } catch (error) {
      if (
        workspaceGeneration.current === generationToDuplicate &&
        currentWorkspaceId.current === sourceWorkspaceId
      ) {
        setStatus(error instanceof Error ? error.message : "Workspace duplication failed.")
      }
    } finally {
      duplicateInFlight.current = false
    }
  }

  const duplicateDisabled =
    !selectedWorkspaceIsMember ||
    Boolean(initialWorkspaceId) ||
    selected.data?.owner?.kind !== "manual" ||
    selectedWorkspaceArchived ||
    workspaceReadOnly ||
    Boolean(selected.data?.layoutIssue) ||
    !layout ||
    dirty ||
    saving ||
    createMutation.isPending ||
    saveMutation.isPending ||
    renameMutation.isPending ||
    duplicateInFlight.current ||
    duplicateMutation.isPending ||
    archiveMutation.isPending ||
    restoreMutation.isPending ||
    deleteMutation.isPending

  const popOutPane = async (pane: Parameters<typeof workspacePaneChatIds>[0]) => {
    if (!selectedWorkspaceId || !projectId) return
    try {
      const result = await window.desktopApi?.openWorkspacePane?.({
        projectId,
        workspaceId: selectedWorkspaceId,
        paneId: pane.id,
        chatIds: workspacePaneChatIds(pane, operationOwnership.data),
      })
      const creationFailure = !result?.ok ? asWorkbenchWindowCreationFailure(result) : null
      if (creationFailure) showWorkbenchWindowCreationFeedback(creationFailure)
      setStatus(
        result?.ok
          ? result.state === "opened"
            ? "Pane opened in a stable workspace window."
            : "Focused the existing pane window."
          : result?.reason === "recovering"
            ? "Pane window is recovering. Try again after it reloads."
            : creationFailure
              ? describeWorkbenchWindowCreationFailure(creationFailure.reason).description
              : `Pane remains owned by ${result?.ownerStableId ?? "another window"}.`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The pane window could not be opened.")
    }
  }

  const pullBackPane = async (pane: Parameters<typeof workspacePaneChatIds>[0]) => {
    if (!selectedWorkspaceId) return
    try {
      const result = await window.desktopApi?.pullBackWorkspacePane?.(selectedWorkspaceId, pane.id)
      setStatus(
        result?.ok
          ? "Pane returned to its workspace window."
          : "No workspace window is available for pull-back.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The pane could not be pulled back.")
    }
  }

  const openWorkspaceWindow = async () => {
    if (!selectedWorkspaceId || !projectId || !layout) return
    try {
      const result = await window.desktopApi?.openWorkspaceWindow?.({
        projectId,
        workspaceId: selectedWorkspaceId,
        panes: getWorkspaceGroups(layout).flatMap((group) =>
          group.panes.map((pane) => ({
            paneId: pane.id,
            chatIds: workspacePaneChatIds(pane, operationOwnership.data),
          })),
        ),
      })
      const creationFailure = !result?.ok ? asWorkbenchWindowCreationFailure(result) : null
      if (creationFailure) showWorkbenchWindowCreationFeedback(creationFailure)
      setStatus(
        result?.ok
          ? result.state === "opened"
            ? "Workspace moved to a stable window."
            : "Focused the existing workspace window."
          : result?.reason === "recovering"
            ? "Workspace window is recovering. Try again after it reloads."
            : creationFailure
              ? describeWorkbenchWindowCreationFailure(creationFailure.reason).description
              : `Workspace remains owned by ${result?.ownerStableId ?? "another window"}.`,
      )
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "The workspace window could not be opened.",
      )
    }
  }

  if (!projectId) {
    return (
      <WorkspaceNotice
        title={initialWorkspaceId ? "Workspace project target needs repair" : "No project selected"}
      >
        {initialWorkspaceId
          ? initialProjectId
            ? `Project ${initialProjectId} is unavailable. This window will not fall back to a previously selected project.`
            : "This saved workspace window has no project target and will not fall back to a previously selected project."
          : "Select a project before opening saved workspaces."}
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
            {!initialWorkspaceId && (
              <Button
                type="button"
                variant={showArchived ? "default" : "outline"}
                onClick={toggleArchivedWorkspaces}
                disabled={dirty || saving}
                aria-pressed={showArchived}
              >
                <Archive className="mr-1 h-4 w-4" />
                {showArchived ? "Archived" : "Active"}
              </Button>
            )}
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
                disabled={
                  !initialChatId ||
                  createMutation.isPending ||
                  dirty ||
                  saving ||
                  showArchived ||
                  selectedWorkspaceArchived
                }
              >
                Create from chat
              </Button>
            </form>
            <Button
              type="button"
              onClick={() => void saveCurrent()}
              disabled={!dirty || saveMutation.isPending || selectedWorkspaceArchived}
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
      {!popoutPaneId && selected.data && (
        <section
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/10 p-2"
          aria-label="Workspace lifecycle"
        >
          <form className="flex min-w-64 flex-1 items-center gap-2" onSubmit={renameWorkspace}>
            <label className="sr-only" htmlFor="saved-workspace-rename">
              Workspace name
            </label>
            <Input
              id="saved-workspace-rename"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={256}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={
                renameMutation.isPending ||
                !renameValue.trim() ||
                renameValue.trim() === selected.data.name
              }
            >
              Rename
            </Button>
          </form>
          {selectedWorkspaceArchived ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void restoreWorkspace()}
              disabled={restoreMutation.isPending}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Restore
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => previewLifecycleAction("archive")}
              disabled={archiveMutation.isPending || dirty || saving}
            >
              <Archive className="mr-1 h-4 w-4" /> Archive
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void duplicateWorkspace()}
            disabled={duplicateDisabled}
            title={
              selected.data.owner?.kind === "orchestration"
                ? "Operation workspaces cannot be duplicated."
                : initialWorkspaceId
                  ? "Duplicate workspaces from the main Saved Workspaces view."
                  : undefined
            }
          >
            <Copy className="mr-1 h-4 w-4" /> Duplicate workspace
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => previewLifecycleAction("delete")}
            disabled={deleteMutation.isPending || dirty || saving}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete metadata
          </Button>
        </section>
      )}
      {lifecycleAction && selected.data && (
        <WorkspaceLifecycleImpact
          action={lifecycleAction}
          workspaceName={selected.data.name}
          loading={lifecyclePreview.isLoading}
          ready={Boolean(lifecyclePreview.data)}
          error={lifecyclePreview.error?.message ?? null}
          operation={lifecyclePreview.data?.operation ?? null}
          referenceCount={
            lifecyclePreview.data
              ? Object.values(lifecyclePreview.data.references).reduce(
                  (count, references) => count + references.length,
                  0,
                )
              : 0
          }
          pending={archiveMutation.isPending || deleteMutation.isPending}
          onCancel={() => setLifecycleAction(null)}
          onConfirm={() => void confirmLifecycleAction()}
        />
      )}
      <div className="min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">
        {status ||
          (!initialChatId ? "Open a chat to create a workspace." : "Select or create a workspace.")}
      </div>
      <div className="min-h-0 flex-1">
        {list.isLoading || (projectId && !list.data) ? (
          <WorkspaceNotice title="Restoring project workspaces">
            Confirming this workspace belongs to the current project…
          </WorkspaceNotice>
        ) : initialWorkspaceMissing ? (
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
                  if (!workspaceReadOnly) changeLayout(next, action)
                  else if (!selectedWorkspaceArchived && action.type === "activate-pane")
                    dispatchLayout(action)
                }}
                onRequestAddPane={workspaceReadOnly ? undefined : setAddPaneGroupId}
                onPopOutPane={popoutPaneId ? undefined : (pane) => void popOutPane(pane)}
                popoutPaneId={popoutPaneId}
                onPullBackPane={popoutPaneId ? (pane) => void pullBackPane(pane) : undefined}
                structuralReadOnly={workspaceReadOnly}
                renderPane={(pane) => {
                  const group = groupForPane(pane.id)
                  return (
                    <WorkspacePaneAdapter
                      projectId={projectId}
                      workspaceId={selectedWorkspaceId!}
                      pane={pane}
                      ownershipChatIds={workspacePaneChatIds(pane, operationOwnership.data)}
                      readOnly={selectedWorkspaceArchived}
                      onReplaceBinding={(binding) => {
                        if (!selectedWorkspaceArchived)
                          dispatchLayout({ type: "replace-binding", paneId: pane.id, binding })
                      }}
                      onRemove={() => {
                        if (group && !selectedWorkspaceArchived)
                          dispatchLayout({
                            type: "remove-pane",
                            groupId: group.id,
                            paneId: pane.id,
                          })
                      }}
                      onPinContext={(context: SavedWorkspacePinnedContext) => {
                        if (!selectedWorkspaceArchived)
                          dispatchLayout({ type: "pin-context", paneId: pane.id, context })
                      }}
                      onUnpinContext={(contextId) => {
                        if (!selectedWorkspaceArchived)
                          dispatchLayout({ type: "unpin-context", paneId: pane.id, contextId })
                      }}
                      onSelectOperationAgent={
                        selectedWorkspaceArchived ? undefined : selectOperationAgent
                      }
                    />
                  )
                }}
              />
            </div>
          </div>
        ) : (
          <WorkspaceNotice title={showArchived ? "No archived workspaces" : "No workspace layout"}>
            {showArchived
              ? "Archived workspace metadata appears here without changing referenced work."
              : "Create a workspace from the currently open chat. Empty state does not create fake pane bindings."}
          </WorkspaceNotice>
        )}
      </div>
    </main>
  )
}

export function WorkspaceLifecycleImpact({
  action,
  workspaceName,
  loading,
  ready,
  error,
  operation,
  referenceCount,
  pending,
  onCancel,
  onConfirm,
}: {
  action: "archive" | "delete"
  workspaceName: string
  loading: boolean
  ready: boolean
  error: string | null
  operation: {
    status: string
    active: boolean
    agentCount: number
    materializedChatCount: number
    canRegenerateFromLineage: true
  } | null
  referenceCount: number
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const title = action === "archive" ? "Archive workspace" : "Delete workspace metadata"
  return (
    <section
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
      role="alertdialog"
      aria-labelledby="workspace-lifecycle-impact-title"
      aria-describedby="workspace-lifecycle-impact-description"
    >
      <h2 id="workspace-lifecycle-impact-title" className="text-sm font-medium">
        {title}: {workspaceName}
      </h2>
      <div
        id="workspace-lifecycle-impact-description"
        className="mt-1 space-y-1 text-xs text-muted-foreground"
      >
        {loading ? (
          <p>Loading exact impact…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          <>
            <p>
              {action === "archive"
                ? "The workspace leaves the active list; referenced work remains unchanged."
                : "Only workspace metadata is deleted; referenced work remains unchanged."}
            </p>
            <p>{referenceCount} durable references were found in this workspace.</p>
            {operation && (
              <p>
                Operation {operation.status}: {operation.agentCount} agents,{" "}
                {operation.materializedChatCount} materialized chats.{" "}
                {operation.active
                  ? "The operation remains active and will not be stopped."
                  : "The operation remains preserved."}{" "}
                {operation.canRegenerateFromLineage
                  ? "Workspace metadata can be regenerated from lineage."
                  : ""}
              </p>
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" autoFocus onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={!ready || loading || Boolean(error) || pending}
        >
          {pending ? "Working…" : title}
        </Button>
      </div>
    </section>
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
