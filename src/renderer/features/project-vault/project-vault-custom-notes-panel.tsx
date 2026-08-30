"use client"

import { diffLines } from "diff"
import { useAtom } from "jotai"
import {
  AlertTriangle,
  Copy,
  FileImage,
  FilePlus2,
  FolderCog,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Textarea } from "../../components/ui/textarea"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  applyVaultEditorExternalSnapshot,
  createVaultConflictCopyPath,
  createVaultEditorState,
  hasVaultEditorChanges,
  markVaultEditorConflict,
  projectVaultCustomNoteEditorCacheAtom,
  rebaseVaultEditorAfterSave,
  updateVaultEditorDraft,
  type VaultDocumentSnapshot,
} from "./editor-state"

function toCustomNoteSnapshot(data: {
  version: number
  content: string
  contentHash: string
  externallyModified: boolean
}): VaultDocumentSnapshot {
  return {
    version: data.version,
    content: data.content,
    contentHash: data.contentHash,
    currentContentHash: data.contentHash,
    externallyModified: data.externallyModified,
  }
}

export function ProjectVaultCustomNotesPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const graph = trpc.projectVaults.getGraph.useQuery({ projectId })
  const [selectedStableId, setSelectedStableId] = useState<string | null>(null)
  const [managingFiles, setManagingFiles] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [conflictDestination, setConflictDestination] = useState("")
  const [editorCache, setEditorCache] = useAtom(projectVaultCustomNoteEditorCacheAtom)
  const create = trpc.projectVaults.createNote.useMutation()
  const update = trpc.projectVaults.updateNote.useMutation()
  const remove = trpc.projectVaults.removeNote.useMutation()
  const restore = trpc.projectVaults.restoreNote.useMutation()
  const adoptExternal = trpc.projectVaults.adoptExternalNote.useMutation()
  const keepBoth = trpc.projectVaults.keepBothNotes.useMutation()
  const notes = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((node) => node.noteType === "custom" || node.stableId?.startsWith("custom:"))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    [graph.data],
  )
  const selectedNote = notes.find((item) => item.stableId === selectedStableId)
  const selectedPath = selectedNote?.relativePath ?? null
  const note = trpc.projectVaults.readNote.useQuery(
    { projectId, relativePath: selectedPath ?? "placeholder.md" },
    { enabled: Boolean(selectedPath) },
  )
  const editor = selectedStableId ? editorCache[projectId]?.[selectedStableId] : undefined
  const conflictDiff = useMemo(
    () => (editor?.conflict ? diffLines(editor.conflict.content, editor.draft) : []),
    [editor?.conflict, editor?.draft],
  )

  useEffect(() => {
    const stableId = note.data?.identity?.id
    if (!note.data || !stableId) return
    const snapshot = toCustomNoteSnapshot(note.data)
    setEditorCache((current) => {
      const projectEditors = current[projectId] ?? {}
      const existing = projectEditors[stableId]
      const next = applyVaultEditorExternalSnapshot(existing, snapshot)
      return next === existing
        ? current
        : { ...current, [projectId]: { ...projectEditors, [stableId]: next } }
    })
  }, [note.data, projectId, setEditorCache])

  useEffect(() => {
    setConflictDestination(
      editor?.conflict && selectedPath ? createVaultConflictCopyPath(selectedPath) : "",
    )
  }, [editor?.conflict?.currentContentHash, selectedPath])

  const refresh = async (relativePath = selectedPath) => {
    await utils.projectVaults.getGraph.invalidate({ projectId })
    if (relativePath) {
      await utils.projectVaults.readNote.invalidate({ projectId, relativePath })
    }
  }

  const createNote = async () => {
    try {
      const created = await create.mutateAsync({
        projectId,
        relativePath: newPath,
        title: newTitle,
      })
      setCreating(false)
      setNewPath("")
      setNewTitle("")
      const stableId = created.identity?.id
      if (!stableId) throw new Error("Created note is missing its stable identity.")
      utils.projectVaults.readNote.setData(
        { projectId, relativePath: created.relativePath },
        created,
      )
      setEditorCache((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [stableId]: createVaultEditorState(toCustomNoteSnapshot(created)),
        },
      }))
      setSelectedStableId(stableId)
      setManagingFiles(false)
      await refresh(created.relativePath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create note")
    }
  }

  const save = async () => {
    if (!editor || !selectedPath || !selectedStableId || editor.conflict) return
    const submittedRevision = editor.revision
    try {
      const saved = await update.mutateAsync({
        projectId,
        relativePath: selectedPath,
        expectedVersion: editor.base.version,
        expectedHash: editor.base.contentHash,
        content: editor.draft,
      })
      utils.projectVaults.readNote.setData({ projectId, relativePath: selectedPath }, saved)
      const snapshot = toCustomNoteSnapshot(saved)
      setEditorCache((current) => {
        const projectEditors = current[projectId] ?? {}
        const currentEditor = projectEditors[selectedStableId]
        return !currentEditor
          ? current
          : {
              ...current,
              [projectId]: {
                ...projectEditors,
                [selectedStableId]: rebaseVaultEditorAfterSave(
                  currentEditor,
                  snapshot,
                  submittedRevision,
                ),
              },
            }
      })
      await utils.projectVaults.getGraph.invalidate({ projectId })
      toast.success("Note saved")
    } catch (error) {
      try {
        const current = await utils.projectVaults.readNote.fetch({
          projectId,
          relativePath: selectedPath,
        })
        const snapshot = toCustomNoteSnapshot(current)
        setEditorCache((cache) => {
          const projectEditors = cache[projectId] ?? {}
          const currentEditor = projectEditors[selectedStableId]
          if (!currentEditor) return cache
          return {
            ...cache,
            [projectId]: {
              ...projectEditors,
              [selectedStableId]: applyVaultEditorExternalSnapshot(currentEditor, snapshot),
            },
          }
        })
      } catch {
        // Keep the local draft intact while the persistent toast reports the failed save.
      }
      toast.error(error instanceof Error ? error.message : "Could not save note")
    }
  }

  const useExternalVersion = async (current: VaultDocumentSnapshot) => {
    if (!selectedPath || !selectedStableId) return
    try {
      const resolved = current.externallyModified
        ? toCustomNoteSnapshot(
            await adoptExternal.mutateAsync({
              projectId,
              relativePath: selectedPath,
              expectedVersion: current.version,
              expectedHash: current.contentHash,
            }),
          )
        : current
      setEditorCache((cache) => ({
        ...cache,
        [projectId]: {
          ...(cache[projectId] ?? {}),
          [selectedStableId]: createVaultEditorState(resolved),
        },
      }))
      await refresh(selectedPath)
      toast.success("External note version adopted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "External note changed again")
    }
  }

  const keepBothVersions = async () => {
    if (!editor?.conflict || !selectedPath || !selectedStableId || !conflictDestination.trim()) {
      return
    }
    try {
      const kept = await keepBoth.mutateAsync({
        projectId,
        relativePath: selectedPath,
        destinationPath: conflictDestination,
        expectedVersion: editor.conflict.version,
        expectedCurrentHash: editor.conflict.contentHash,
        draftContent: editor.draft,
      })
      const keptStableId = kept.identity?.id
      if (!keptStableId) throw new Error("Conflict copy is missing its stable identity.")
      setEditorCache((cache) => ({
        ...cache,
        [projectId]: {
          ...(cache[projectId] ?? {}),
          [selectedStableId]: createVaultEditorState(editor.conflict!),
          [keptStableId]: createVaultEditorState(toCustomNoteSnapshot(kept)),
        },
      }))
      utils.projectVaults.readNote.setData({ projectId, relativePath: kept.relativePath }, kept)
      setSelectedStableId(keptStableId)
      await refresh(kept.relativePath)
      toast.success(`Kept both versions. Local draft saved as ${kept.relativePath}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not keep both note versions")
    }
  }

  const deleteNote = async () => {
    if (!note.data || !selectedPath) return
    const exactPath = selectedPath
    if (!window.confirm(`Move ${exactPath} to Flapstack's recoverable vault trash?`)) return
    try {
      const removed = await remove.mutateAsync({
        projectId,
        relativePath: exactPath,
        expectedVersion: note.data.version,
        expectedHash: note.data.contentHash,
      })
      setSelectedStableId(null)
      await refresh(exactPath)
      toast.success("Note moved to recoverable trash", {
        action: {
          label: "Restore",
          onClick: () => {
            void restore
              .mutateAsync({
                projectId,
                trashId: removed.trashId,
                relativePath: removed.relativePath,
                expectedVersion: removed.version,
              })
              .then(async (restoredNote) => {
                setSelectedStableId(restoredNote.identity?.id ?? null)
                await refresh(restoredNote.relativePath)
              })
              .catch((error) => toast.error(error.message || "Could not restore note"))
          },
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove note")
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(12rem,0.65fr)_minmax(0,1.35fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
      <aside
        className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r"
        aria-label="Custom note tree"
      >
        <div className="flex h-12 items-center justify-between border-b px-3">
          <h2 className="text-sm font-semibold">Custom notes</h2>
          <div className="flex items-center gap-1">
            <Button
              variant={managingFiles ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setManagingFiles(true)
                setSelectedStableId(null)
                setCreating(false)
              }}
              aria-label="Manage vault folders and attachments"
              aria-pressed={managingFiles}
            >
              <FolderCog className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setCreating(true)
                setManagingFiles(false)
              }}
              aria-label="Create custom note"
            >
              <FilePlus2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {creating && (
          <div className="space-y-2 border-b p-3">
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Note title"
              aria-label="New note title"
            />
            <Input
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
              placeholder="Folder/Note.md"
              aria-label="New note path"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void createNote()}
                disabled={!newTitle.trim() || !newPath.trim() || create.isPending}
              >
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {graph.isFetching ? (
            <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading notes…
            </p>
          ) : notes.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              No custom notes yet. Seed notes remain in the main tree.
            </p>
          ) : (
            notes.map((item) => (
              <button
                key={item.nodeId}
                type="button"
                className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                aria-current={selectedStableId === item.stableId ? "page" : undefined}
                onClick={() => {
                  setSelectedStableId(item.stableId ?? null)
                  setManagingFiles(false)
                }}
              >
                <span className="block truncate font-medium">{item.title}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {item.relativePath}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      <main className="flex min-h-0 flex-col">
        {managingFiles ? (
          <VaultFileManager projectId={projectId} />
        ) : !selectedPath ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Select a custom note or create one.
          </div>
        ) : note.isFetching || !note.data || !editor ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading note…
          </div>
        ) : (
          <>
            <div className="flex h-12 items-center border-b px-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{note.data.title}</h2>
                <p className="truncate text-[11px] text-muted-foreground">{selectedPath}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => void deleteNote()}
                disabled={remove.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove
              </Button>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={
                  update.isPending ||
                  !hasVaultEditorChanges(editor) ||
                  Boolean(editor.conflict) ||
                  editor.base.externallyModified
                }
              >
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
            </div>

            {editor.base.externallyModified && !editor.conflict && (
              <section className="border-b border-amber-500/40 bg-amber-500/5 p-4" role="status">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">Changed outside Flapstack</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Review this Obsidian version, then adopt it before saving further edits.
                    </p>
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      onClick={() => void useExternalVersion(editor.base)}
                      disabled={adoptExternal.isPending}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" /> Adopt external version
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {editor.conflict && (
              <section
                className="border-b border-red-500/40 bg-red-500/5 p-4"
                aria-live="assertive"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">Custom note conflict</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The current disk version and your local draft are both preserved. Review the
                      exact diff, then choose one explicitly.
                    </p>
                    <div
                      className="mt-3 max-h-52 overflow-auto rounded-md border bg-background font-mono text-xs"
                      role="region"
                      aria-label="Conflict diff between current custom note and local draft"
                    >
                      {conflictDiff.map((part, index) => (
                        <pre
                          key={index}
                          className={cn(
                            "m-0 whitespace-pre-wrap px-3 py-0.5",
                            part.added && "bg-green-500/10 text-green-700 dark:text-green-300",
                            part.removed && "bg-red-500/10 text-red-700 dark:text-red-300",
                          )}
                        >
                          {part.added ? "+ " : part.removed ? "- " : "  "}
                          {part.value}
                        </pre>
                      ))}
                    </div>
                    <label className="mt-3 block space-y-1.5 text-xs font-medium">
                      Local draft copy path
                      <Input
                        value={conflictDestination}
                        onChange={(event) => setConflictDestination(event.target.value)}
                        aria-label="Local draft conflict copy path"
                        disabled={keepBoth.isPending}
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void useExternalVersion(editor.conflict!)}
                        disabled={adoptExternal.isPending}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Use external version
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void keepBothVersions()}
                        disabled={!conflictDestination.trim() || keepBoth.isPending}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Keep both versions
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            )}
            <Textarea
              value={editor.draft}
              onChange={(event) => {
                if (!selectedStableId) return
                setEditorCache((cache) => {
                  const projectEditors = cache[projectId] ?? {}
                  const currentEditor = projectEditors[selectedStableId]
                  if (!currentEditor) return cache
                  let next = updateVaultEditorDraft(currentEditor, event.target.value)
                  if (next.base.externallyModified && hasVaultEditorChanges(next)) {
                    next = markVaultEditorConflict(next, next.base)
                  }
                  return {
                    ...cache,
                    [projectId]: { ...projectEditors, [selectedStableId]: next },
                  }
                })
              }}
              className="min-h-0 flex-1 resize-none rounded-none border-0 p-6 font-mono text-sm focus-visible:ring-0"
              aria-label={`Edit custom note ${note.data.title}`}
              spellCheck={false}
            />
          </>
        )}
      </main>
    </div>
  )
}

type OperationStatus = {
  kind: "error" | "info" | "success"
  message: string
}

const SAFE_RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_RASTER_BYTES = 16 * 1_048_576

function VaultFileManager({ projectId }: { projectId: string }) {
  const [folderPath, setFolderPath] = useState("")
  const [folderNewName, setFolderNewName] = useState("")
  const [attachmentPath, setAttachmentPath] = useState("")
  const [attachmentNewName, setAttachmentNewName] = useState("")
  const [attachmentDestination, setAttachmentDestination] = useState("")
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [status, setStatus] = useState<OperationStatus | null>(null)
  const [removedAttachment, setRemovedAttachment] = useState<{
    trashId: string
    relativePath: string
    expectedHash: string
  } | null>(null)

  const attachment = trpc.projectVaults.readAttachment.useQuery(
    { projectId, relativePath: attachmentPath || "placeholder.png" },
    { enabled: false, retry: false },
  )
  const createFolder = trpc.projectVaults.createFolder.useMutation()
  const renameFolder = trpc.projectVaults.renameFolder.useMutation()
  const removeFolder = trpc.projectVaults.removeFolder.useMutation()
  const createAttachment = trpc.projectVaults.createAttachment.useMutation()
  const renameAttachment = trpc.projectVaults.renameAttachment.useMutation()
  const moveAttachment = trpc.projectVaults.moveAttachment.useMutation()
  const removeAttachment = trpc.projectVaults.removeAttachment.useMutation()
  const restoreAttachment = trpc.projectVaults.restoreAttachment.useMutation()

  const folderPending = createFolder.isPending || renameFolder.isPending || removeFolder.isPending
  const attachmentPending =
    attachment.isFetching ||
    createAttachment.isPending ||
    renameAttachment.isPending ||
    moveAttachment.isPending ||
    removeAttachment.isPending ||
    restoreAttachment.isPending

  const runFolderOperation = async (
    pendingMessage: string,
    successMessage: string,
    operation: () => Promise<{ relativePath: string }>,
  ) => {
    setStatus({ kind: "info", message: pendingMessage })
    try {
      const result = await operation()
      setFolderPath(result.relativePath)
      setStatus({ kind: "success", message: successMessage })
    } catch (error) {
      setStatus({ kind: "error", message: operationError(error, "Folder operation failed") })
    }
  }

  const uploadAttachment = async () => {
    if (!attachmentFile || !attachmentPath.trim()) return
    if (!SAFE_RASTER_TYPES.has(attachmentFile.type)) {
      setStatus({
        kind: "error",
        message: "Choose a PNG, JPEG, GIF, or WebP image with a matching file type.",
      })
      return
    }
    if (attachmentFile.size === 0 || attachmentFile.size > MAX_RASTER_BYTES) {
      setStatus({ kind: "error", message: "The raster image must be between 1 byte and 16 MiB." })
      return
    }
    setStatus({ kind: "info", message: "Uploading raster image…" })
    try {
      const created = await createAttachment.mutateAsync({
        projectId,
        relativePath: attachmentPath,
        declaredMimeType: attachmentFile.type,
        dataBase64: await fileToBase64(attachmentFile),
      })
      setAttachmentPath(created.relativePath)
      setAttachmentFile(null)
      setRemovedAttachment(null)
      setStatus({
        kind: "success",
        message: `Uploaded ${created.relativePath}. Load it to inspect verified metadata.`,
      })
    } catch (error) {
      setStatus({ kind: "error", message: attachmentError(error, "Upload failed") })
    }
  }

  const loadAttachment = async () => {
    if (!attachmentPath.trim()) return
    setStatus({ kind: "info", message: "Loading attachment metadata…" })
    const result = await attachment.refetch()
    if (result.error) {
      setStatus({ kind: "error", message: attachmentError(result.error, "Load failed") })
      return
    }
    if (result.data) {
      setStatus({
        kind: "success",
        message: `Loaded ${result.data.relativePath} (${formatBytes(result.data.byteLength)}).`,
      })
    }
  }

  const renameLoadedAttachment = async () => {
    if (!attachment.data || !attachmentNewName.trim()) return
    setStatus({ kind: "info", message: "Renaming attachment…" })
    try {
      const renamed = await renameAttachment.mutateAsync({
        projectId,
        relativePath: attachment.data.relativePath,
        newName: attachmentNewName,
        expectedHash: attachment.data.contentHash,
      })
      setAttachmentPath(renamed.relativePath)
      setAttachmentNewName("")
      setStatus({
        kind: "success",
        message: `Renamed to ${renamed.relativePath}. Load it again to continue editing.`,
      })
    } catch (error) {
      setStatus({ kind: "error", message: attachmentError(error, "Rename failed") })
    }
  }

  const moveLoadedAttachment = async () => {
    if (!attachment.data || !attachmentDestination.trim()) return
    setStatus({ kind: "info", message: "Moving attachment…" })
    try {
      const moved = await moveAttachment.mutateAsync({
        projectId,
        relativePath: attachment.data.relativePath,
        destinationPath: attachmentDestination,
        expectedHash: attachment.data.contentHash,
      })
      setAttachmentPath(moved.relativePath)
      setAttachmentDestination("")
      setStatus({
        kind: "success",
        message: `Moved to ${moved.relativePath}. Load it again to continue editing.`,
      })
    } catch (error) {
      setStatus({ kind: "error", message: attachmentError(error, "Move failed") })
    }
  }

  const removeLoadedAttachment = async () => {
    if (!attachment.data) return
    const exactPath = attachment.data.relativePath
    if (!window.confirm(`Move ${exactPath} to Flapstack's recoverable vault trash?`)) return
    setStatus({ kind: "info", message: "Moving attachment to recoverable trash…" })
    try {
      const removed = await removeAttachment.mutateAsync({
        projectId,
        relativePath: exactPath,
        expectedHash: attachment.data.contentHash,
      })
      setRemovedAttachment({
        trashId: removed.trashId,
        relativePath: removed.relativePath,
        expectedHash: removed.contentHash,
      })
      setAttachmentPath("")
      setStatus({
        kind: "success",
        message: `${removed.relativePath} is in recoverable trash.`,
      })
    } catch (error) {
      setStatus({ kind: "error", message: attachmentError(error, "Remove failed") })
    }
  }

  const restoreRemovedAttachment = async () => {
    if (!removedAttachment) return
    setStatus({ kind: "info", message: "Restoring attachment…" })
    try {
      const restored = await restoreAttachment.mutateAsync({
        projectId,
        ...removedAttachment,
      })
      setAttachmentPath(restored.relativePath)
      setRemovedAttachment(null)
      setStatus({
        kind: "success",
        message: `Restored ${restored.relativePath}. Load it to inspect verified metadata.`,
      })
    } catch (error) {
      setStatus({ kind: "error", message: attachmentError(error, "Restore failed") })
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-5">
      <div className="mx-auto grid max-w-5xl gap-4 xl:grid-cols-2">
        <section
          className="rounded-lg border bg-background shadow-sm"
          aria-labelledby="folder-tools"
        >
          <header className="border-b px-4 py-3">
            <h2 id="folder-tools" className="text-sm font-semibold">
              Folder operations
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Rename folders in place. Removal is limited to empty folders.
            </p>
          </header>
          <div className="space-y-4 p-4">
            <label className="block space-y-1.5 text-xs font-medium">
              Vault-relative folder path
              <Input
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="Research/References"
                aria-label="Folder path"
                disabled={folderPending}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void runFolderOperation("Creating folder…", `Created ${folderPath}.`, () =>
                    createFolder.mutateAsync({ projectId, relativePath: folderPath }),
                  )
                }
                disabled={!folderPath.trim() || folderPending}
              >
                Create folder
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove empty folder ${folderPath}? Files are never removed by this action.`,
                    )
                  ) {
                    void runFolderOperation(
                      "Checking and removing empty folder…",
                      `Removed empty folder ${folderPath}.`,
                      () => removeFolder.mutateAsync({ projectId, relativePath: folderPath }),
                    )
                  }
                }}
                disabled={!folderPath.trim() || folderPending}
              >
                Remove empty folder
              </Button>
            </div>
            <div className="border-t pt-4">
              <label className="block space-y-1.5 text-xs font-medium">
                New folder name
                <Input
                  value={folderNewName}
                  onChange={(event) => setFolderNewName(event.target.value)}
                  placeholder="Sources"
                  aria-label="New folder name"
                  disabled={folderPending}
                />
              </label>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() =>
                  void runFolderOperation("Renaming folder…", "Folder renamed.", () =>
                    renameFolder.mutateAsync({
                      projectId,
                      relativePath: folderPath,
                      newName: folderNewName,
                    }),
                  )
                }
                disabled={!folderPath.trim() || !folderNewName.trim() || folderPending}
              >
                Rename folder
              </Button>
            </div>
          </div>
        </section>

        <section
          className="rounded-lg border bg-background shadow-sm"
          aria-labelledby="attachment-tools"
        >
          <header className="border-b px-4 py-3">
            <h2 id="attachment-tools" className="flex items-center gap-2 text-sm font-semibold">
              <FileImage className="h-4 w-4" />
              Safe raster attachments
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPEG, GIF, or WebP only, up to 16 MiB. The app verifies the file signature before
              storing it.
            </p>
          </header>
          <div className="space-y-4 p-4">
            <label className="block space-y-1.5 text-xs font-medium">
              Vault-relative attachment path
              <Input
                value={attachmentPath}
                onChange={(event) => setAttachmentPath(event.target.value)}
                placeholder="Assets/diagram.png"
                aria-label="Attachment path"
                disabled={attachmentPending}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              Raster image
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp"
                aria-label="Safe raster attachment file"
                className="block w-full rounded-md border bg-background px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
                disabled={attachmentPending}
                onChange={(event) => setAttachmentFile(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void uploadAttachment()}
                disabled={!attachmentPath.trim() || !attachmentFile || attachmentPending}
              >
                Upload attachment
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void loadAttachment()}
                disabled={!attachmentPath.trim() || attachmentPending}
              >
                {attachment.isFetching && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Load attachment
              </Button>
            </div>

            {attachment.data && (
              <div className="space-y-3 border-t pt-4">
                <div className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)]">
                  <img
                    src={`data:${attachment.data.mimeType};base64,${attachment.data.dataBase64}`}
                    alt={`Preview of ${attachment.data.relativePath}`}
                    className="h-28 w-28 rounded-md border bg-muted object-contain"
                  />
                  <dl className="min-w-0 space-y-1 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Verified type</dt>
                      <dd className="font-medium">{attachment.data.mimeType}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">SHA-256</dt>
                      <dd className="truncate font-mono text-[10px]">
                        {attachment.data.contentHash}
                      </dd>
                    </div>
                  </dl>
                </div>
                <label className="block space-y-1.5 text-xs font-medium">
                  New file name
                  <Input
                    value={attachmentNewName}
                    onChange={(event) => setAttachmentNewName(event.target.value)}
                    placeholder="architecture.png"
                    aria-label="New attachment name"
                    disabled={attachmentPending}
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void renameLoadedAttachment()}
                  disabled={!attachmentNewName.trim() || attachmentPending}
                >
                  Rename attachment
                </Button>
                <label className="block space-y-1.5 text-xs font-medium">
                  Destination path
                  <Input
                    value={attachmentDestination}
                    onChange={(event) => setAttachmentDestination(event.target.value)}
                    placeholder="Archive/architecture.png"
                    aria-label="Attachment destination path"
                    disabled={attachmentPending}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void moveLoadedAttachment()}
                    disabled={!attachmentDestination.trim() || attachmentPending}
                  >
                    Move attachment
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void removeLoadedAttachment()}
                    disabled={attachmentPending}
                    aria-label="Move attachment to recoverable trash"
                  >
                    Move to trash
                  </Button>
                </div>
              </div>
            )}

            {removedAttachment && (
              <div className="flex items-center justify-between gap-3 border-t pt-4 text-xs">
                <span className="min-w-0 truncate">{removedAttachment.relativePath}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void restoreRemovedAttachment()}
                  disabled={attachmentPending}
                >
                  Restore attachment
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {status && (
        <p
          role="status"
          aria-live="polite"
          className={`mx-auto mt-4 max-w-5xl rounded-md border px-3 py-2 text-xs ${
            status.kind === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : status.kind === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-background text-muted-foreground"
          }`}
        >
          {status.message}
        </p>
      )}
    </div>
  )
}

function operationError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  return message === fallback ? fallback : `${fallback}: ${message}`
}

function attachmentError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  if (/changed before|conflict/i.test(message)) {
    return `Conflict: ${message} Reload the attachment before retrying.`
  }
  return message === fallback ? fallback : `${fallback}: ${message}`
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  return `${(value / 1_048_576).toFixed(2)} MiB`
}
