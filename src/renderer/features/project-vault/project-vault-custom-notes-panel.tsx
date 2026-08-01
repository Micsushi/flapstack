"use client"

import { FileImage, FilePlus2, FolderCog, Loader2, Save, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Textarea } from "../../components/ui/textarea"
import { trpc } from "../../lib/trpc"

export function ProjectVaultCustomNotesPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const graph = trpc.projectVaults.getGraph.useQuery({ projectId })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [managingFiles, setManagingFiles] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const note = trpc.projectVaults.readNote.useQuery(
    { projectId, relativePath: selectedPath ?? "placeholder.md" },
    { enabled: Boolean(selectedPath) },
  )
  const [draft, setDraft] = useState("")
  const create = trpc.projectVaults.createNote.useMutation()
  const update = trpc.projectVaults.updateNote.useMutation()
  const remove = trpc.projectVaults.removeNote.useMutation()
  const restore = trpc.projectVaults.restoreNote.useMutation()
  const notes = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((node) => node.noteType === "custom" || node.stableId?.startsWith("custom:"))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    [graph.data],
  )

  useEffect(() => {
    if (note.data) setDraft(note.data.content)
  }, [note.data])

  const refresh = async () => {
    await utils.projectVaults.getGraph.invalidate({ projectId })
    if (selectedPath) {
      await utils.projectVaults.readNote.invalidate({ projectId, relativePath: selectedPath })
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
      setSelectedPath(created.relativePath)
      setManagingFiles(false)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create note")
    }
  }

  const save = async () => {
    if (!note.data || !selectedPath) return
    try {
      const saved = await update.mutateAsync({
        projectId,
        relativePath: selectedPath,
        expectedVersion: note.data.version,
        expectedHash: note.data.contentHash,
        content: draft,
      })
      utils.projectVaults.readNote.setData({ projectId, relativePath: selectedPath }, saved)
      await utils.projectVaults.getGraph.invalidate({ projectId })
      toast.success("Note saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save note")
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
      setSelectedPath(null)
      setDraft("")
      await refresh()
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
              .then(async () => {
                setSelectedPath(removed.relativePath)
                await refresh()
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
                setSelectedPath(null)
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
                aria-current={selectedPath === item.relativePath ? "page" : undefined}
                onClick={() => {
                  setSelectedPath(item.relativePath)
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
        ) : note.isFetching || !note.data ? (
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
                disabled={update.isPending || draft === note.data.content}
              >
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
            </div>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
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
                accept="image/png,image/jpeg,image/gif,image/webp"
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
