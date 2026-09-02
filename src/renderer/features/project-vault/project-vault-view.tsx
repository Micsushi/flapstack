"use client"

import { diffLines } from "diff"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock3,
  Edit3,
  FileText,
  FolderTree,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from "lucide-react"
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { toast } from "sonner"

import { ChatMarkdownRenderer } from "../../components/chat-markdown-renderer"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { Button } from "../../components/ui/button"
import { Checkbox } from "../../components/ui/checkbox"
import { Input } from "../../components/ui/input"
import { Textarea } from "../../components/ui/textarea"
import { trpc } from "../../lib/trpc"
import { agentsSettingsDialogActiveTabAtom } from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { desktopViewAtom, selectedProjectAtom } from "../agents/atoms"
import {
  applyVaultEditorExternalSnapshot,
  createVaultEditorState,
  hasVaultEditorChanges,
  hasUnsavedVaultDrafts,
  markVaultEditorConflict,
  projectVaultCustomNoteEditorCacheAtom,
  protectUnsavedVaultDraftsBeforeUnload,
  rebaseVaultEditorAfterSave,
  updateVaultEditorDraft,
  type VaultDocumentSnapshot,
  type VaultEditorCache,
  type VaultEditorState,
} from "./editor-state"
import {
  isSectionId,
  SearchResults,
  SECTION_GROUPS,
  SectionTree,
  VaultContextPicker,
  type SectionId,
} from "./project-vault-navigation"
import { ProjectVaultGraphPanel } from "./project-vault-graph-panel"
import { ProjectVaultCustomNotesPanel } from "./project-vault-custom-notes-panel"

const projectVaultEditorCacheAtom = atom<VaultEditorCache>({})

function toSnapshot(data: {
  version: number
  content: string
  contentHash: string
  currentContentHash: string
  externallyModified: boolean
}): VaultDocumentSnapshot {
  return {
    version: data.version,
    content: data.content,
    contentHash: data.contentHash,
    currentContentHash: data.currentContentHash,
    externallyModified: data.externallyModified,
  }
}

export function ProjectVaultView() {
  const project = useAtomValue(selectedProjectAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const projectId = project?.id ?? ""
  const utils = trpc.useUtils()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const [editorCache, setEditorCache] = useAtom(projectVaultEditorCacheAtom)
  const customNoteEditorCache = useAtomValue(projectVaultCustomNoteEditorCacheAtom)
  const editors = editorCache[projectId] ?? {}
  const setEditors: Dispatch<SetStateAction<Partial<Record<SectionId, VaultEditorState>>>> = (
    update,
  ) =>
    setEditorCache((current) => {
      const existing = current[projectId] ?? {}
      const next = typeof update === "function" ? update(existing) : update
      return { ...current, [projectId]: next }
    })
  const [showHistory, setShowHistory] = useState(false)
  const [showGraph, setShowGraph] = useState(false)
  const [showCustomNotes, setShowCustomNotes] = useState(false)
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [setupSections, setSetupSections] = useState<SectionId[]>(["index", "handoff"])
  const [setupLocationMode, setSetupLocationMode] = useState<"app-managed" | "project-owned">(
    "app-managed",
  )
  const [setupGitTracking, setSetupGitTracking] = useState(false)
  const [operationStatus, setOperationStatus] = useState<{
    kind: "success" | "error" | "info"
    message: string
  } | null>(null)
  const openPortability = () => {
    setSettingsActiveTab("portability")
    setDesktopView("settings")
  }

  useEffect(() => {
    setSelectedSectionId(null)
    setSearchQuery("")
    setSelectedBackupId(null)
    setShowHistory(false)
    setOperationStatus(null)
  }, [projectId])

  const registryQuery = trpc.projectVaults.getSectionRegistry.useQuery()
  const policyQuery = trpc.projectVaults.getPolicy.useQuery({ projectId }, { enabled: !!projectId })
  const sectionsQuery = trpc.projectVaults.listSections.useQuery(
    { projectId },
    { enabled: !!projectId },
  )
  const sections = useMemo(
    () => (sectionsQuery.data ?? []).filter((section) => isSectionId(section.sectionId)),
    [sectionsQuery.data],
  )
  const unsupportedSections = useMemo(
    () => (sectionsQuery.data ?? []).filter((section) => !isSectionId(section.sectionId)),
    [sectionsQuery.data],
  )
  const sectionIds = useMemo(
    () => sections.map((section) => section.sectionId as SectionId),
    [sections],
  )
  const contextSelectionQuery = trpc.projectVaults.getContextSelection.useQuery(
    { projectId },
    { enabled: !!projectId && sections.length > 0 },
  )

  useEffect(() => {
    if (!policyQuery.data || sections.length > 0) return
    setSetupLocationMode(policyQuery.data.locationMode)
    setSetupGitTracking(policyQuery.data.gitTrackingEnabled)
  }, [policyQuery.data, sections.length])

  useEffect(() => {
    if (!selectedSectionId || !sectionIds.includes(selectedSectionId)) {
      setSelectedSectionId(sectionIds[0] ?? null)
    }
  }, [sectionIds, selectedSectionId])

  useEffect(() => {
    setSelectedBackupId(null)
    setRestoreOpen(false)
    setOperationStatus(null)
  }, [selectedSectionId])

  const readQuery = trpc.projectVaults.readSection.useQuery(
    { projectId, sectionId: selectedSectionId ?? "index" },
    { enabled: !!projectId && !!selectedSectionId },
  )
  useEffect(() => {
    if (!selectedSectionId || !readQuery.data) return
    const snapshot = toSnapshot(readQuery.data)
    setEditors((current) => {
      const existing = current[selectedSectionId]
      const next = applyVaultEditorExternalSnapshot(existing, snapshot)
      return next === existing ? current : { ...current, [selectedSectionId]: next }
    })
  }, [readQuery.data, selectedSectionId])

  const editor = selectedSectionId ? editors[selectedSectionId] : undefined
  const selectedSection = sections.find((section) => section.sectionId === selectedSectionId)
  const hasUnsavedDrafts =
    hasUnsavedVaultDrafts(editorCache) || hasUnsavedVaultDrafts(customNoteEditorCache)

  useEffect(() => {
    if (!hasUnsavedDrafts) return
    const protectUnsavedDrafts = (event: BeforeUnloadEvent) => {
      protectUnsavedVaultDraftsBeforeUnload(event, editorCache)
      protectUnsavedVaultDraftsBeforeUnload(event, customNoteEditorCache)
    }
    window.addEventListener("beforeunload", protectUnsavedDrafts)
    return () => window.removeEventListener("beforeunload", protectUnsavedDrafts)
  }, [customNoteEditorCache, editorCache, hasUnsavedDrafts])
  const backupsQuery = trpc.projectVaults.listBackups.useQuery(
    { projectId, sectionId: selectedSectionId ?? "index" },
    { enabled: !!projectId && !!selectedSectionId && showHistory },
  )
  const backupQuery = trpc.projectVaults.readBackup.useQuery(
    { projectId, sectionId: selectedSectionId ?? "index", backupId: selectedBackupId ?? "" },
    { enabled: !!projectId && !!selectedSectionId && !!selectedBackupId },
  )
  const searchQueryResult = trpc.projectVaults.search.useQuery(
    { projectId, query: deferredQuery || " " },
    { enabled: !!projectId && !!deferredQuery },
  )

  const refreshSection = async (
    sectionId: SectionId,
    options: { submittedRevision?: number } = {},
  ) => {
    const result = await utils.projectVaults.readSection.fetch({ projectId, sectionId })
    const snapshot = toSnapshot(result)
    setEditors((current) => {
      const existing = current[sectionId]
      return {
        ...current,
        [sectionId]:
          existing && options.submittedRevision !== undefined
            ? rebaseVaultEditorAfterSave(existing, snapshot, options.submittedRevision)
            : createVaultEditorState(snapshot),
      }
    })
    await Promise.all([
      utils.projectVaults.listSections.invalidate({ projectId }),
      utils.projectVaults.listBackups.invalidate({ projectId, sectionId }),
      utils.projectVaults.search.invalidate(),
    ])
  }

  const writeMutation = trpc.projectVaults.writeSection.useMutation()
  const adoptMutation = trpc.projectVaults.adoptExternalChange.useMutation()
  const restoreMutation = trpc.projectVaults.restoreBackup.useMutation()
  const scaffoldMutation = trpc.projectVaults.scaffold.useMutation()
  const updatePolicyMutation = trpc.projectVaults.updatePolicy.useMutation()
  const updateContextSelectionMutation = trpc.projectVaults.updateContextSelection.useMutation()

  const handleScaffold = async () => {
    setOperationStatus({ kind: "info", message: "Creating project knowledge vault…" })
    try {
      await updatePolicyMutation.mutateAsync({
        projectId,
        locationMode: setupLocationMode,
        gitTrackingEnabled: setupLocationMode === "project-owned" && setupGitTracking,
        ...(setupLocationMode === "project-owned" ? { projectOwnedOptIn: true as const } : {}),
        ...(setupLocationMode === "project-owned" && setupGitTracking
          ? { gitTrackingOptIn: true as const }
          : {}),
      })
      await scaffoldMutation.mutateAsync({ projectId, sections: setupSections })
      await Promise.all([sectionsQuery.refetch(), policyQuery.refetch()])
      setOperationStatus({ kind: "success", message: "Project knowledge vault created." })
      toast.success("Project knowledge vault created")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project vault could not be created"
      setOperationStatus({ kind: "error", message })
      toast.error(message)
    }
  }

  const handleContextToggle = async (sectionId: SectionId, enabled: boolean) => {
    const current = (contextSelectionQuery.data?.projectSectionIds ?? []).filter(isSectionId)
    const next = enabled
      ? [...new Set([...current, sectionId])]
      : current.filter((id) => id !== sectionId)
    try {
      await updateContextSelectionMutation.mutateAsync({ projectId, sectionIds: next })
      await contextSelectionQuery.refetch()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Run context selection could not be saved"
      setOperationStatus({ kind: "error", message })
    }
  }

  const handleSave = async (resolution?: VaultDocumentSnapshot) => {
    if (!selectedSectionId || !editor) return
    if ((!hasVaultEditorChanges(editor) || editor.conflict) && !resolution) return
    const submittedRevision = editor.revision
    setOperationStatus({ kind: "info", message: "Saving vault section…" })
    try {
      await writeMutation.mutateAsync({
        projectId,
        sectionId: selectedSectionId,
        expectedVersion: resolution?.version ?? editor.base.version,
        ...(resolution?.externallyModified
          ? { expectedCurrentContentHash: resolution.currentContentHash }
          : {}),
        content: editor.draft,
        changeKind: resolution ? "conflict-resolved" : "section-saved",
      })
      await refreshSection(selectedSectionId, { submittedRevision })
      setOperationStatus({
        kind: "success",
        message: "Submitted draft saved. Edits made during save remain unsaved.",
      })
      toast.success("Vault section saved")
    } catch (error) {
      let changedSinceLoad = false
      try {
        const current = await utils.projectVaults.readSection.fetch({
          projectId,
          sectionId: selectedSectionId,
        })
        const snapshot = toSnapshot(current)
        changedSinceLoad =
          snapshot.version !== editor.base.version ||
          snapshot.currentContentHash !== editor.base.currentContentHash ||
          snapshot.externallyModified
        if (changedSinceLoad) {
          setEditors((states) => {
            const state = states[selectedSectionId]
            return state
              ? { ...states, [selectedSectionId]: markVaultEditorConflict(state, snapshot) }
              : states
          })
        }
      } catch {
        // Keep the draft intact. The persistent error below exposes missing,
        // unreadable, or unsafe storage without replacing it with a spinner.
      }
      const message =
        error instanceof Error
          ? error.message
          : changedSinceLoad
            ? "Vault section changed before save"
            : "Vault section could not be saved"
      setOperationStatus({ kind: "error", message })
      toast.error(message)
    }
  }

  const handleUseCurrent = async () => {
    if (!selectedSectionId || !editor?.conflict) return
    try {
      const current = editor.conflict
      if (current.externallyModified) {
        await adoptMutation.mutateAsync({
          projectId,
          sectionId: selectedSectionId,
          expectedVersion: current.version,
          expectedCurrentContentHash: current.currentContentHash,
        })
      }
      await refreshSection(selectedSectionId)
      setOperationStatus({ kind: "success", message: "Current version loaded." })
      toast.success("Current version kept")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Current version changed again"
      setOperationStatus({ kind: "error", message })
      toast.error(message)
    }
  }

  const handleRestore = async () => {
    const expectedVersion = editor?.base.version ?? selectedSection?.version
    if (!selectedSectionId || !selectedBackupId || !expectedVersion) return
    setOperationStatus({ kind: "info", message: "Restoring vault backup…" })
    try {
      await restoreMutation.mutateAsync({
        projectId,
        sectionId: selectedSectionId,
        backupId: selectedBackupId,
        expectedVersion,
      })
      setRestoreOpen(false)
      setSelectedBackupId(null)
      await refreshSection(selectedSectionId)
      setOperationStatus({ kind: "success", message: "Backup restored as a new version." })
      toast.success("Backup restored as a new version")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup could not be restored"
      setOperationStatus({ kind: "error", message })
      toast.error(message)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void handleSave()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Select a project to open its knowledge vault.
      </div>
    )
  }

  if (sectionsQuery.isLoading || registryQuery.isLoading || policyQuery.isLoading) {
    return <LoadingState label="Loading project knowledge…" />
  }

  if (sectionsQuery.error || registryQuery.error || policyQuery.error) {
    return (
      <div className="flex h-full flex-col bg-background select-text">
        <VaultHeader
          projectName={project.name}
          onClose={() => setDesktopView(null)}
          onOpenPortability={openPortability}
        />
        <ErrorState
          title="Project knowledge is unavailable"
          message={
            (sectionsQuery.error ?? registryQuery.error ?? policyQuery.error)?.message ??
            "Vault metadata failed to load."
          }
          onRetry={() => {
            void sectionsQuery.refetch()
            void registryQuery.refetch()
            void policyQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (sections.length === 0 && unsupportedSections.length > 0) {
    return (
      <div className="flex h-full flex-col bg-background select-text">
        <VaultHeader
          projectName={project.name}
          onClose={() => setDesktopView(null)}
          onOpenPortability={openPortability}
        />
        <ErrorState
          title="Vault metadata needs recovery"
          message="The vault contains unsupported or malformed section metadata. Flapstack will not recreate or overwrite it automatically."
          onRetry={() => void sectionsQuery.refetch()}
        />
      </div>
    )
  }

  if (sections.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-auto bg-background select-text">
        <VaultHeader
          projectName={project.name}
          onClose={() => setDesktopView(null)}
          onOpenPortability={openPortability}
        />
        <main className="mx-auto w-full max-w-2xl p-8">
          <BookOpen className="mb-4 h-9 w-9 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Create project knowledge vault</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Markdown stays in app-managed central storage by default. Secrets are rejected and no
            files are added to the project unless its location policy is changed explicitly.
          </p>
          <fieldset className="mt-6 space-y-2">
            <legend className="mb-2 text-sm font-medium">Typed sections</legend>
            {(registryQuery.data ?? []).map((section) => (
              <label key={section.id} className="flex items-center gap-3 rounded-md border p-3">
                <Checkbox
                  checked={setupSections.includes(section.id)}
                  onCheckedChange={(checked) =>
                    setSetupSections((current) =>
                      checked
                        ? [...new Set([...current, section.id])]
                        : current.filter((id) => id !== section.id),
                    )
                  }
                />
                <span>
                  <span className="block text-sm font-medium">{section.title}</span>
                  <span className="block text-xs text-muted-foreground">{section.fileName}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-6 space-y-3">
            <legend className="mb-2 text-sm font-medium">Storage location</legend>
            <label className="flex items-start gap-3 rounded-md border p-3">
              <input
                type="radio"
                name="vault-location"
                checked={setupLocationMode === "app-managed"}
                onChange={() => {
                  setSetupLocationMode("app-managed")
                  setSetupGitTracking(false)
                }}
              />
              <span>
                <span className="block text-sm font-medium">App-managed central storage</span>
                <span className="block break-all text-xs text-muted-foreground">
                  {policyQuery.data?.centralPath}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border p-3">
              <input
                type="radio"
                name="vault-location"
                checked={setupLocationMode === "project-owned"}
                onChange={() => setSetupLocationMode("project-owned")}
              />
              <span>
                <span className="block text-sm font-medium">Project-owned storage</span>
                <span className="block text-xs text-muted-foreground">
                  Creates .flapstack/knowledge in the registered project root.
                </span>
              </span>
            </label>
            {setupLocationMode === "project-owned" && (
              <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={setupGitTracking}
                  onCheckedChange={(checked) => setSetupGitTracking(checked === true)}
                />
                Allow these project-owned Markdown files to be git tracked
              </label>
            )}
          </fieldset>
          <Button
            className="mt-6"
            disabled={
              setupSections.length === 0 ||
              scaffoldMutation.isPending ||
              updatePolicyMutation.isPending
            }
            onClick={() => void handleScaffold()}
          >
            {(scaffoldMutation.isPending || updatePolicyMutation.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create vault
          </Button>
          {operationStatus && (
            <p
              className={cn(
                "mt-3 text-xs",
                operationStatus.kind === "error" ? "text-red-600" : "text-muted-foreground",
              )}
              role={operationStatus.kind === "error" ? "alert" : "status"}
            >
              {operationStatus.message}
            </p>
          )}
        </main>
      </div>
    )
  }

  const conflictDiff = editor?.conflict ? diffLines(editor.conflict.content, editor.draft) : []

  return (
    <div className="flex h-full flex-col bg-background select-text" data-project-vault-view>
      <VaultHeader
        projectName={project.name}
        onClose={() => setDesktopView(null)}
        onOpenPortability={openPortability}
      />
      {unsupportedSections.length > 0 && (
        <div
          className="border-b border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
          role="alert"
        >
          {unsupportedSections.length} unsupported vault section
          {unsupportedSections.length === 1 ? " was" : "s were"} hidden. Existing files were not
          changed.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-64 shrink-0 flex-col border-r bg-muted/15"
          aria-label="Vault navigation"
        >
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearchQuery("")
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    document.querySelector<HTMLButtonElement>("[data-vault-search-result]")?.focus()
                  }
                }}
                className="h-8 pl-8 text-xs"
                placeholder="Search this vault…"
                aria-label="Search this project vault"
              />
            </div>
          </div>
          {deferredQuery ? (
            <SearchResults
              results={searchQueryResult.data ?? []}
              loading={searchQueryResult.isFetching}
              error={searchQueryResult.error?.message}
              onSelect={(sectionId) => {
                if (isSectionId(sectionId)) {
                  setSelectedSectionId(sectionId)
                  setShowGraph(false)
                  setShowCustomNotes(false)
                }
              }}
              onExit={() => searchInputRef.current?.focus()}
            />
          ) : (
            <SectionTree
              groups={SECTION_GROUPS}
              sections={sections}
              selected={selectedSectionId}
              editors={editors}
              onSelect={(sectionId) => {
                setSelectedSectionId(sectionId)
                setShowGraph(false)
                setShowCustomNotes(false)
              }}
            />
          )}
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
            <span className="block font-medium text-foreground">
              {policyQuery.data?.locationMode === "project-owned"
                ? "Project-owned storage"
                : "App-managed storage"}
            </span>
            <span className="block truncate" title={policyQuery.data?.vaultPath}>
              {policyQuery.data?.vaultPath}
            </span>
            <span className="block">
              Git tracking {policyQuery.data?.gitTrackingEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          <VaultContextPicker
            sections={sections}
            selected={(contextSelectionQuery.data?.projectSectionIds ?? []).filter(isSectionId)}
            saving={updateContextSelectionMutation.isPending}
            error={contextSelectionQuery.error?.message}
            onToggle={(sectionId, enabled) => void handleContextToggle(sectionId, enabled)}
          />
          <div className="mt-auto border-t p-2">
            <Button
              variant={showGraph ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              aria-pressed={showGraph}
              onClick={() => {
                setShowGraph((value) => !value)
                setShowCustomNotes(false)
              }}
            >
              <BookOpen className="mr-2 h-4 w-4" /> Knowledge graph
            </Button>
            <Button
              variant={showCustomNotes ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              aria-pressed={showCustomNotes}
              onClick={() => {
                setShowCustomNotes((value) => !value)
                setShowGraph(false)
              }}
            >
              <FolderTree className="mr-2 h-4 w-4" /> Custom notes
            </Button>
            <Button
              variant={showHistory ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowHistory((value) => !value)}
            >
              <Clock3 className="mr-2 h-4 w-4" /> Version history
            </Button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {showCustomNotes ? (
            <ProjectVaultCustomNotesPanel projectId={projectId} />
          ) : showGraph ? (
            <ProjectVaultGraphPanel projectId={projectId} />
          ) : selectedSectionId && readQuery.error ? (
            <ErrorState
              title="Section cannot be opened"
              message={readQuery.error.message}
              onRetry={() => void readQuery.refetch()}
              secondaryAction={{
                label: "Open version history",
                onClick: () => setShowHistory(true),
              }}
            />
          ) : !selectedSection || !editor ? (
            <LoadingState label="Loading section…" />
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <h2 className="truncate text-sm font-semibold">{selectedSection.title}</h2>
                    <span className="text-xs text-muted-foreground">v{editor.base.version}</span>
                    {hasVaultEditorChanges(editor) && (
                      <span className="text-xs text-amber-600">Unsaved changes</span>
                    )}
                    {editor.base.externallyModified && (
                      <span className="text-xs text-red-600">Changed outside Flapstack</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {selectedSection.sectionType} · {selectedSection.relativePath}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditMode((value) => !value)}
                  >
                    {editMode ? (
                      <BookOpen className="mr-2 h-4 w-4" />
                    ) : (
                      <Edit3 className="mr-2 h-4 w-4" />
                    )}
                    {editMode ? "Preview" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!hasVaultEditorChanges(editor) || writeMutation.isPending}
                    onClick={() => void handleSave()}
                  >
                    <Save className="mr-2 h-4 w-4" /> Save
                  </Button>
                </div>
              </div>

              {(operationStatus || hasVaultEditorChanges(editor)) && (
                <div
                  className={cn(
                    "border-b px-4 py-1.5 text-xs",
                    operationStatus?.kind === "error"
                      ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                      : operationStatus?.kind === "success"
                        ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
                        : "text-muted-foreground",
                  )}
                  role={operationStatus?.kind === "error" ? "alert" : "status"}
                  aria-live={operationStatus?.kind === "error" ? "assertive" : "polite"}
                >
                  {operationStatus?.message ??
                    "Unsaved draft preserved while Flapstack remains open. Save before quitting."}
                </div>
              )}

              {editor.conflict && (
                <section
                  className="border-b border-red-500/40 bg-red-500/5 p-4"
                  aria-live="assertive"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">Save conflict</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Current version {editor.conflict.version} and your draft are both preserved.
                        Review the diff, then choose one explicitly.
                      </p>
                      <div
                        className="mt-3 max-h-52 overflow-auto rounded-md border bg-background font-mono text-xs"
                        role="region"
                        aria-label="Conflict diff between current version and local draft"
                      >
                        {conflictDiff.map((part, index) => (
                          <pre
                            key={index}
                            className={cn(
                              "m-0 whitespace-pre-wrap px-3 py-0.5",
                              part.added && "bg-green-500/10 text-green-700 dark:text-green-300",
                              part.removed && "bg-red-500/10 text-red-700 dark:text-red-300",
                            )}
                            aria-label={
                              part.added
                                ? "Your draft addition"
                                : part.removed
                                  ? "Current version"
                                  : "Unchanged"
                            }
                          >
                            {part.added ? "+ " : part.removed ? "- " : "  "}
                            {part.value}
                          </pre>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => void handleUseCurrent()}>
                          <RefreshCw className="mr-2 h-4 w-4" /> Use current version
                        </Button>
                        <Button size="sm" onClick={() => void handleSave(editor.conflict!)}>
                          <Save className="mr-2 h-4 w-4" /> Save my draft as next version
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                {editMode ? (
                  <Textarea
                    value={editor.draft}
                    onChange={(event) => {
                      setOperationStatus(null)
                      setEditors((states) => ({
                        ...states,
                        [selectedSectionId!]: updateVaultEditorDraft(editor, event.target.value),
                      }))
                    }}
                    className="h-full min-h-full resize-none rounded-none border-0 p-6 font-mono text-sm shadow-none focus-visible:ring-0"
                    aria-label={`Edit ${selectedSection.title} Markdown`}
                    spellCheck={false}
                  />
                ) : (
                  <article className="mx-auto max-w-4xl p-6">
                    <ChatMarkdownRenderer content={editor.draft} size="md" />
                  </article>
                )}
              </div>
            </>
          )}
        </main>

        {showHistory && selectedSectionId && (
          <aside className="flex w-80 shrink-0 flex-col border-l" aria-label="Version history">
            <div className="flex h-12 items-center justify-between border-b px-3">
              <h2 className="text-sm font-semibold">Version history</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(false)}
                aria-label="Close version history"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="border-b p-2">
              {backupsQuery.error ? (
                <p className="p-2 text-xs text-red-600" role="alert">
                  Version history unavailable: {backupsQuery.error.message}
                </p>
              ) : (backupsQuery.data ?? []).length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No earlier versions yet.</p>
              ) : (
                (backupsQuery.data ?? []).map((backup) => (
                  <button
                    key={backup.id}
                    type="button"
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted",
                      selectedBackupId === backup.id && "bg-muted",
                    )}
                    onClick={() => setSelectedBackupId(backup.id)}
                  >
                    <span className="block font-medium">Version {backup.version}</span>
                    <span className="block text-xs text-muted-foreground">
                      {backup.createdAt
                        ? new Date(backup.createdAt).toLocaleString()
                        : "Recorded backup"}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {backupQuery.isFetching ? (
                <LoadingState label="Loading backup…" />
              ) : backupQuery.error ? (
                <p className="text-xs text-red-600" role="alert">
                  Backup preview unavailable: {backupQuery.error.message}
                </p>
              ) : backupQuery.data ? (
                <ChatMarkdownRenderer content={backupQuery.data.content} size="sm" />
              ) : (
                <p className="text-xs text-muted-foreground">Select a version to preview it.</p>
              )}
            </div>
            <div className="border-t p-3">
              <Button
                className="w-full"
                variant="outline"
                disabled={!backupQuery.data}
                onClick={() => setRestoreOpen(true)}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Restore as new version
              </Button>
            </div>
          </aside>
        )}
      </div>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The current content remains recoverable. The selected backup becomes a new version.
              {editor && hasVaultEditorChanges(editor)
                ? " Your unsaved draft will be discarded only after you confirm."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody className="text-sm">
            This does not delete any recorded version.
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRestore()}>
              Restore backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function VaultHeader({
  projectName,
  onClose,
  onOpenPortability,
}: {
  projectName: string
  onClose: () => void
  onOpenPortability: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <Button variant="ghost" size="sm" onClick={onClose} aria-label="Back to project chats">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <BookOpen className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">Project knowledge</div>
        <div className="truncate text-[11px] text-muted-foreground">{projectName}</div>
      </div>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenPortability}>
        <ArchiveRestore className="mr-2 h-4 w-4" /> Export or restore
      </Button>
      <div className="text-[11px] text-muted-foreground">⌘/Ctrl+F search · ⌘/Ctrl+S save</div>
    </header>
  )
}

function ErrorState({
  title,
  message,
  onRetry,
  secondaryAction,
}: {
  title: string
  message: string
  onRetry: () => void
  secondaryAction?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-6">
      <section
        className="max-w-lg rounded-lg border border-red-500/30 bg-red-500/5 p-5"
        aria-label={title}
      >
        <AlertTriangle className="mb-3 h-6 w-6 text-red-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <p
          className="mt-2 break-words text-xs text-muted-foreground"
          role="alert"
          aria-live="assertive"
        >
          {message}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Existing vault files were not changed. Check the registered root, file permissions, or
          version history before retrying.
        </p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry
          </Button>
          {secondaryAction && (
            <Button size="sm" variant="outline" onClick={secondaryAction.onClick}>
              <Clock3 className="mr-2 h-4 w-4" aria-hidden="true" />
              {secondaryAction.label}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}
