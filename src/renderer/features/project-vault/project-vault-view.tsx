"use client"

import { diffLines } from "diff"
import { useAtomValue, useSetAtom } from "jotai"
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Edit3,
  FileText,
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
  type KeyboardEvent as ReactKeyboardEvent,
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
import { cn } from "../../lib/utils"
import { desktopViewAtom, selectedProjectAtom } from "../agents/atoms"
import {
  createVaultEditorState,
  hasVaultEditorChanges,
  markVaultEditorConflict,
  updateVaultEditorDraft,
  type VaultDocumentSnapshot,
  type VaultEditorState,
} from "./editor-state"

const SECTION_IDS = ["index", "handoff", "decisions", "context", "tasks", "logs"] as const
type SectionId = (typeof SECTION_IDS)[number]

const SECTION_GROUPS: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Foundation", ids: ["index", "handoff"] },
  { label: "Project memory", ids: ["decisions", "context", "tasks"] },
  { label: "Activity", ids: ["logs"] },
]

function isSectionId(value: string): value is SectionId {
  return SECTION_IDS.includes(value as SectionId)
}

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
  const projectId = project?.id ?? ""
  const utils = trpc.useUtils()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const treeItemsRef = useRef(new Map<SectionId, HTMLButtonElement>())
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const [editors, setEditors] = useState<Partial<Record<SectionId, VaultEditorState>>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [setupSections, setSetupSections] = useState<SectionId[]>(["index", "handoff"])

  useEffect(() => {
    setSelectedSectionId(null)
    setEditors({})
    setSearchQuery("")
    setSelectedBackupId(null)
    setShowHistory(false)
  }, [projectId])

  const registryQuery = trpc.projectVaults.getSectionRegistry.useQuery()
  const sectionsQuery = trpc.projectVaults.listSections.useQuery(
    { projectId },
    { enabled: !!projectId },
  )
  const sections = useMemo(
    () => (sectionsQuery.data ?? []).filter((section) => isSectionId(section.sectionId)),
    [sectionsQuery.data],
  )
  const sectionIds = useMemo(
    () => sections.map((section) => section.sectionId as SectionId),
    [sections],
  )

  useEffect(() => {
    if (!selectedSectionId || !sectionIds.includes(selectedSectionId)) {
      setSelectedSectionId(sectionIds[0] ?? null)
    }
  }, [sectionIds, selectedSectionId])

  const readQuery = trpc.projectVaults.readSection.useQuery(
    { projectId, sectionId: selectedSectionId ?? "index" },
    { enabled: !!projectId && !!selectedSectionId },
  )
  useEffect(() => {
    if (!selectedSectionId || !readQuery.data) return
    const snapshot = toSnapshot(readQuery.data)
    setEditors((current) => {
      const existing = current[selectedSectionId]
      if (existing && (hasVaultEditorChanges(existing) || existing.conflict)) return current
      return { ...current, [selectedSectionId]: createVaultEditorState(snapshot) }
    })
  }, [readQuery.data, selectedSectionId])

  const editor = selectedSectionId ? editors[selectedSectionId] : undefined
  const selectedSection = sections.find((section) => section.sectionId === selectedSectionId)
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

  const refreshSection = async (sectionId: SectionId) => {
    const result = await utils.projectVaults.readSection.fetch({ projectId, sectionId })
    setEditors((current) => ({
      ...current,
      [sectionId]: createVaultEditorState(toSnapshot(result)),
    }))
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

  const handleSave = async (resolution?: VaultDocumentSnapshot) => {
    if (!selectedSectionId || !editor) return
    if ((!hasVaultEditorChanges(editor) || editor.conflict) && !resolution) return
    try {
      await writeMutation.mutateAsync({
        projectId,
        sectionId: selectedSectionId,
        expectedVersion: resolution?.version ?? editor.base.version,
        ...(resolution?.externallyModified
          ? { expectedCurrentContentHash: resolution.currentContentHash }
          : {}),
        content: editor.draft,
      })
      await refreshSection(selectedSectionId)
      toast.success("Vault section saved")
    } catch (error) {
      const current = await utils.projectVaults.readSection.fetch({
        projectId,
        sectionId: selectedSectionId,
      })
      const snapshot = toSnapshot(current)
      const changedSinceLoad =
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
      toast.error(
        error instanceof Error
          ? error.message
          : changedSinceLoad
            ? "Vault section changed before save"
            : "Vault section could not be saved",
      )
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
      toast.success("Current version kept")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Current version changed again")
    }
  }

  const handleRestore = async () => {
    if (!selectedSectionId || !selectedBackupId || !editor) return
    try {
      await restoreMutation.mutateAsync({
        projectId,
        sectionId: selectedSectionId,
        backupId: selectedBackupId,
        expectedVersion: editor.base.version,
      })
      setRestoreOpen(false)
      setSelectedBackupId(null)
      await refreshSection(selectedSectionId)
      toast.success("Backup restored as a new version")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup could not be restored")
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

  if (sectionsQuery.isLoading || registryQuery.isLoading) {
    return <LoadingState label="Loading project knowledge…" />
  }

  if (sections.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-auto bg-background select-text">
        <VaultHeader projectName={project.name} onClose={() => setDesktopView(null)} />
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
          <Button
            className="mt-6"
            disabled={setupSections.length === 0 || scaffoldMutation.isPending}
            onClick={() =>
              scaffoldMutation.mutate(
                { projectId, sections: setupSections },
                {
                  onSuccess: () => void sectionsQuery.refetch(),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            {scaffoldMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create vault
          </Button>
        </main>
      </div>
    )
  }

  const conflictDiff = editor?.conflict ? diffLines(editor.conflict.content, editor.draft) : []

  return (
    <div className="flex h-full flex-col bg-background select-text" data-project-vault-view>
      <VaultHeader projectName={project.name} onClose={() => setDesktopView(null)} />
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
              onSelect={(sectionId) => {
                if (isSectionId(sectionId)) setSelectedSectionId(sectionId)
              }}
            />
          ) : (
            <SectionTree
              groups={SECTION_GROUPS}
              sections={sections}
              selected={selectedSectionId}
              editors={editors}
              itemRefs={treeItemsRef}
              onSelect={setSelectedSectionId}
            />
          )}
          <div className="mt-auto border-t p-2">
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
          {!selectedSection || !editor ? (
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
                      <div className="mt-3 max-h-52 overflow-auto rounded-md border bg-background font-mono text-xs">
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
                    onChange={(event) =>
                      setEditors((states) => ({
                        ...states,
                        [selectedSectionId!]: updateVaultEditorDraft(editor, event.target.value),
                      }))
                    }
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
              {(backupsQuery.data ?? []).length === 0 ? (
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

function VaultHeader({ projectName, onClose }: { projectName: string; onClose: () => void }) {
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
      <div className="ml-auto text-[11px] text-muted-foreground">
        ⌘/Ctrl+F search · ⌘/Ctrl+S save
      </div>
    </header>
  )
}

function SectionTree({
  groups,
  sections,
  selected,
  editors,
  itemRefs,
  onSelect,
}: {
  groups: typeof SECTION_GROUPS
  sections: Array<{ sectionId: string; title: string; sectionType: string }>
  selected: SectionId | null
  editors: Partial<Record<SectionId, VaultEditorState>>
  itemRefs: React.MutableRefObject<Map<SectionId, HTMLButtonElement>>
  onSelect: (id: SectionId) => void
}) {
  const visibleIds = groups.flatMap((group) =>
    group.ids.filter((id) => sections.some((section) => section.sectionId === id)),
  )
  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: SectionId) => {
    const index = visibleIds.indexOf(id)
    const targetIndex =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? visibleIds.length - 1
              : -1
    if (targetIndex < 0 || targetIndex >= visibleIds.length) return
    event.preventDefault()
    itemRefs.current.get(visibleIds[targetIndex]!)?.focus()
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" role="tree" aria-label="Typed vault sections">
      {groups.map((group) => {
        const groupSections = group.ids
          .map((id) => sections.find((section) => section.sectionId === id))
          .filter(Boolean)
        if (groupSections.length === 0) return null
        return (
          <div key={group.label} role="group" aria-label={group.label} className="mb-3">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </div>
            {groupSections.map((section) => {
              const id = section!.sectionId as SectionId
              const editor = editors[id]
              const changed = editor ? hasVaultEditorChanges(editor) : false
              return (
                <button
                  key={id}
                  ref={(node) => {
                    if (node) itemRefs.current.set(id, node)
                    else itemRefs.current.delete(id)
                  }}
                  type="button"
                  role="treeitem"
                  aria-selected={selected === id}
                  tabIndex={selected === id ? 0 : -1}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                    selected === id && "bg-muted",
                  )}
                  onClick={() => onSelect(id)}
                  onKeyDown={(event) => onTreeKeyDown(event, id)}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{section!.title}</span>
                  {editor?.conflict ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-label="Conflict" />
                  ) : changed ? (
                    <Circle
                      className="h-2.5 w-2.5 fill-amber-500 text-amber-500"
                      aria-label="Unsaved changes"
                    />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-muted-foreground/50" aria-label="Saved" />
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function SearchResults({
  results,
  loading,
  onSelect,
}: {
  results: Array<{ sectionId: string; title: string; snippet: string; externallyModified: boolean }>
  loading: boolean
  onSelect: (id: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" aria-live="polite">
      {loading && results.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">Searching…</p>
      ) : results.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No results in this vault.</p>
      ) : (
        results.map((result) => (
          <button
            key={result.sectionId}
            type="button"
            data-vault-search-result
            className="mb-1 w-full rounded-md border border-transparent p-2 text-left hover:border-border hover:bg-muted"
            onClick={() => onSelect(result.sectionId)}
          >
            <span className="flex items-center gap-1 text-xs font-medium">
              {result.title}
              {result.externallyModified && (
                <AlertTriangle
                  className="h-3 w-3 text-red-600"
                  aria-label="Changed outside Flapstack"
                />
              )}
            </span>
            <span className="mt-1 line-clamp-3 block text-[11px] text-muted-foreground">
              {result.snippet}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}
