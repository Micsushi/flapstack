"use client"

import { Camera, History, Loader2, RotateCcw, ShieldCheck } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { trpc } from "../../../lib/trpc"
import { dataUrlToBlob } from "../utils/base64"

type Source = {
  id: string
  kind: "screen" | "window" | "application-window" | "region"
  label: string
  displayId: string | null
  previewDataUrl?: string
}

type Rectangle = { left: number; top: number; width: number; height: number }
type AnnotationKind = "none" | "box" | "arrow" | "text"
type VisualEdit = {
  crop: Rectangle | null
  redactions: Array<Rectangle & { color: string }>
  annotations: Array<
    | (Rectangle & { kind: "box"; color: string })
    | {
        kind: "arrow"
        fromX: number
        fromY: number
        toX: number
        toY: number
        color: string
      }
    | { kind: "text"; left: number; top: number; text: string; color: string }
  >
}

const emptyRectangle: Rectangle = { left: 0, top: 0, width: 1, height: 1 }

export function VisualCaptureDialog({
  open,
  onOpenChange,
  projectId,
  chatId,
  taskId,
  onAddAttachments,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  chatId: string
  taskId?: string
  onAddAttachments: (files: File[]) => void | Promise<void>
}) {
  const [requestId, setRequestId] = useState<string | null>(null)
  const [resultId, setResultId] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [previewSha256, setPreviewSha256] = useState<string | null>(null)
  const [previewEditKey, setPreviewEditKey] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 })
  const [cropEnabled, setCropEnabled] = useState(false)
  const [crop, setCrop] = useState<Rectangle>(emptyRectangle)
  const [redact, setRedact] = useState(false)
  const [redaction, setRedaction] = useState<Rectangle>(emptyRectangle)
  const [annotationKind, setAnnotationKind] = useState<AnnotationKind>("none")
  const [annotationRectangle, setAnnotationRectangle] = useState<Rectangle>(emptyRectangle)
  const [arrow, setArrow] = useState({ fromX: 0, fromY: 0, toX: 1, toY: 1 })
  const [text, setText] = useState({ left: 0, top: 0, text: "" })
  const [annotationColor, setAnnotationColor] = useState("#0034ff")
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")
  const [retentionDays, setRetentionDays] = useState(30)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
  const [showAudit, setShowAudit] = useState(false)

  const begin = trpc.visualCapture.beginUser.useMutation()
  const beginApprovedAgent = trpc.visualCapture.beginApprovedAgent.useMutation()
  const approvedAgentRequests = trpc.visualCapture.approvedAgentRequests.useQuery(
    { projectId, chatId },
    { enabled: open && !resultId },
  )
  const list = trpc.visualCapture.listSources.useQuery(
    { requestId: requestId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(requestId) },
  )
  const history = trpc.visualCapture.history.useQuery(
    { projectId },
    { enabled: open && showHistory },
  )
  const select = trpc.visualCapture.selectSource.useMutation()
  const capture = trpc.visualCapture.captureSelected.useMutation()
  const cancelRequest = trpc.visualCapture.cancelRequest.useMutation()
  const cancel = trpc.visualCapture.cancelPreview.useMutation()
  const previewEdit = trpc.visualCapture.previewEdit.useMutation()
  const confirm = trpc.visualCapture.confirm.useMutation()
  const selectForChat = trpc.visualCapture.selectForChat.useMutation()
  const archiveArtifact = trpc.visualCapture.archive.useMutation({
    onSuccess: () => void history.refetch(),
    onError: (caught) => setError(caught.message),
  })
  const setRetentionArtifact = trpc.visualCapture.setRetention.useMutation({
    onSuccess: () => void history.refetch(),
    onError: (caught) => setError(caught.message),
  })
  const deleteArtifact = trpc.visualCapture.delete.useMutation({
    onSuccess: () => void history.refetch(),
    onError: (caught) => setError(caught.message),
  })
  const exportArtifacts = trpc.visualCapture.exportSelected.useMutation({
    onSuccess: (result) => {
      if (!result.cancelled) toast.success(`Exported ${result.files.length} visual artifacts.`)
    },
    onError: (caught) => setError(caught.message),
  })
  const importArtifact = trpc.visualCapture.importDerivative.useMutation({
    onSuccess: () => {
      toast.success("Visual derivative imported.")
      void history.refetch()
    },
    onError: (caught) => setError(caught.message),
  })
  const cleanupArtifacts = trpc.visualCapture.cleanupExpired.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Retention cleanup deleted ${result.deleted.length}; ${result.skippedReferenced.length} referenced artifacts were preserved.`,
      )
      void history.refetch()
    },
    onError: (caught) => setError(caught.message),
  })
  const auditHistory = trpc.visualCapture.auditHistory.useQuery(
    { projectId, limit: 100 },
    { enabled: open && showHistory && showAudit },
  )

  const edit = useMemo(
    () => ({
      crop: cropEnabled ? crop : null,
      redactions: redact ? [{ ...redaction, color: "#111111" }] : [],
      annotations:
        annotationKind === "box"
          ? [{ kind: "box" as const, ...annotationRectangle, color: annotationColor }]
          : annotationKind === "arrow"
            ? [{ kind: "arrow" as const, ...arrow, color: annotationColor }]
            : annotationKind === "text" && text.text.trim()
              ? [
                  {
                    kind: "text" as const,
                    left: text.left,
                    top: text.top,
                    text: text.text.trim(),
                    color: annotationColor,
                  },
                ]
              : [],
    }),
    [
      annotationColor,
      annotationKind,
      annotationRectangle,
      arrow,
      crop,
      cropEnabled,
      redact,
      redaction,
      text,
    ],
  )

  useEffect(() => {
    if (!open || requestId || resultId || showHistory || begin.isPending) return
    setError(null)
    void begin
      .mutateAsync({ scope: { projectId, chatId, ...(taskId ? { taskId } : {}) } })
      .then((request) => setRequestId(request.id))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Screen capture is unavailable.")
      })
  }, [begin, chatId, open, projectId, requestId, resultId, showHistory, taskId])

  useEffect(() => {
    if (list.data) {
      setSources(list.data)
      setError(null)
    }
    if (list.error) setError(list.error.message)
  }, [list.data, list.error])

  const resetEditor = (width = 1, height = 1) => {
    const full = { left: 0, top: 0, width, height }
    setCropEnabled(false)
    setCrop(full)
    setRedact(false)
    setRedaction({
      left: 0,
      top: 0,
      width: Math.max(1, Math.min(100, width)),
      height: Math.max(1, Math.min(40, height)),
    })
    setAnnotationKind("none")
    setAnnotationRectangle({
      left: 0,
      top: 0,
      width: Math.max(1, Math.min(100, width)),
      height: Math.max(1, Math.min(40, height)),
    })
    setArrow({
      fromX: 0,
      fromY: 0,
      toX: Math.max(0, Math.min(width - 1, 100)),
      toY: Math.max(0, Math.min(height - 1, 40)),
    })
    setText({ left: 0, top: 0, text: "" })
  }

  const close = async () => {
    if (resultId) await cancel.mutateAsync({ resultId }).catch(() => undefined)
    if (requestId) await cancelRequest.mutateAsync({ requestId }).catch(() => undefined)
    setRequestId(null)
    setResultId(null)
    setSources([])
    setPreview(null)
    setPreviewSha256(null)
    setPreviewEditKey(null)
    setError(null)
    setShowHistory(false)
    resetEditor()
    onOpenChange(false)
  }

  const renderPreview = async (
    nextResultId: string,
    nextEdit: VisualEdit = {
      crop: null,
      redactions: [],
      annotations: [],
    },
  ) => {
    const rendered = await previewEdit.mutateAsync({
      resultId: nextResultId,
      edit: nextEdit,
    })
    setPreview(rendered.previewDataUrl)
    setPreviewSha256(rendered.previewSha256)
    setPreviewEditKey(JSON.stringify(nextEdit))
    setDimensions({ width: rendered.width, height: rendered.height })
    return rendered
  }

  const choose = async (source: Source) => {
    if (!requestId) return
    try {
      setError(null)
      await select.mutateAsync({ requestId, sourceId: source.id })
      const captured = await capture.mutateAsync({ requestId })
      setRequestId(null)
      setResultId(captured.resultId)
      const rendered = await renderPreview(captured.resultId)
      resetEditor(rendered.width, rendered.height)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Capture failed.")
    }
  }

  const continueAgentRequest = async (captureRequestId: string) => {
    try {
      setError(null)
      if (requestId) {
        await cancelRequest.mutateAsync({ requestId }).catch(() => undefined)
      }
      const request = await beginApprovedAgent.mutateAsync({ captureRequestId })
      setRequestId(request.id)
      setSources([])
      await approvedAgentRequests.refetch()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not continue the approved agent request.",
      )
    }
  }

  const previewChanges = async () => {
    if (!resultId) return
    try {
      setError(null)
      await renderPreview(resultId, edit)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not preview these edits.")
    }
  }

  const persist = async () => {
    if (!resultId || !previewSha256 || previewEditKey !== JSON.stringify(edit)) return
    try {
      setError(null)
      const artifact = await confirm.mutateAsync({
        resultId,
        edit,
        expectedPreviewSha256: previewSha256,
        retainedUntil:
          retentionDays === 0 ? null : Date.now() + retentionDays * 24 * 60 * 60 * 1_000,
      })
      setResultId(null)
      try {
        await addArtifactFile(artifact)
      } catch (caught) {
        setPreview(null)
        setShowHistory(true)
        await history.refetch()
        setError(
          `Capture ${artifact.record.id} was confirmed and stored, but it could not be added to the composer. Retry from History. ${
            caught instanceof Error ? caught.message : ""
          }`.trim(),
        )
        return
      }
      toast.success("Confirmed derivative added to this chat and its next run context.")
      await close()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm capture.")
    }
  }

  const addArtifactFile = async (artifact: {
    record: { id: string; derivativeSha256: string }
    dataUrl: string
  }) => {
    const blob = dataUrlToBlob(artifact.dataUrl)
    const file = new File(
      [blob],
      `flapstack-visual-${artifact.record.id}-${artifact.record.derivativeSha256}.png`,
      { type: "image/png" },
    )
    await onAddAttachments([file])
  }

  const addFromHistory = async (artifactId: string) => {
    try {
      setError(null)
      const artifact = await selectForChat.mutateAsync({ artifactId, chatId })
      await addArtifactFile(artifact)
      toast.success("Confirmed derivative added to the composer.")
      await close()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add this artifact to the composer.",
      )
    }
  }

  const importDerivative = async (file: File) => {
    if (file.type !== "image/png") {
      setError("Only metadata-stripped PNG derivatives can be imported.")
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    await importArtifact.mutateAsync({
      projectId,
      chatId,
      ...(taskId ? { taskId } : {}),
      dataBase64: btoa(binary),
    })
  }

  const busy =
    begin.isPending ||
    beginApprovedAgent.isPending ||
    list.isFetching ||
    select.isPending ||
    capture.isPending ||
    previewEdit.isPending ||
    confirm.isPending ||
    selectForChat.isPending ||
    archiveArtifact.isPending ||
    setRetentionArtifact.isPending ||
    deleteArtifact.isPending ||
    exportArtifacts.isPending ||
    importArtifact.isPending ||
    cleanupArtifacts.isPending
  const filteredHistory = (history.data ?? []).filter((artifact) => {
    const query = historyQuery.trim().toLowerCase()
    return (
      !query ||
      artifact.id.toLowerCase().includes(query) ||
      artifact.sourceClass.toLowerCase().includes(query) ||
      artifact.actorId.toLowerCase().includes(query)
    )
  })
  const previewIsCurrent = previewEditKey === JSON.stringify(edit)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void close())}>
      <DialogContent
        className="max-h-[calc(100vh-1rem)] w-[min(860px,calc(100vw-16px))] max-w-[860px] overflow-y-auto overscroll-contain sm:max-h-[calc(100vh-2rem)]"
        aria-describedby="visual-capture-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Add visual context
          </DialogTitle>
          <DialogDescription id="visual-capture-description">
            Choose one visible source, inspect the exact derivative, and sanitize it before anything
            is stored or sent to an agent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={showHistory ? "outline" : "secondary"}
            size="sm"
            onClick={() => setShowHistory(false)}
          >
            <Camera className="mr-2 h-4 w-4" />
            New capture
          </Button>
          <Button
            type="button"
            variant={showHistory ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowHistory(true)}
          >
            <History className="mr-2 h-4 w-4" />
            History
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <div className="font-medium">Visual capture could not continue</div>
            <div className="mt-1 text-muted-foreground">{error}</div>
            {!resultId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setError(null)
                  setRequestId(null)
                }}
              >
                Retry source selection
              </Button>
            )}
          </div>
        )}

        {showHistory ? (
          <section aria-labelledby="visual-capture-history-heading" className="space-y-3">
            <h3 id="visual-capture-history-heading" className="text-sm font-medium">
              Confirmed visual artifacts
            </h3>
            <label className="grid gap-1 text-sm">
              <span>Search history</span>
              <input
                type="search"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Artifact ID, source, or actor"
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
              <label className="cursor-pointer rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
                Import PNG
                <input
                  type="file"
                  accept="image/png"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void importDerivative(file)
                    event.currentTarget.value = ""
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedHistoryIds.length === 0 || busy}
                onClick={() => exportArtifacts.mutate({ artifactIds: selectedHistoryIds })}
              >
                Export selected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => cleanupArtifacts.mutate()}
              >
                Run retention cleanup
              </Button>
              <Button
                type="button"
                size="sm"
                variant={showAudit ? "secondary" : "outline"}
                onClick={() => setShowAudit((current) => !current)}
              >
                Audit history
              </Button>
            </div>
            {showAudit && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                {(auditHistory.data ?? []).map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3">
                    <span>
                      {entry.operation} · {entry.outcome}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(entry.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
                {!auditHistory.isFetching && (auditHistory.data?.length ?? 0) === 0 && (
                  <li className="text-muted-foreground">No lifecycle audit events.</li>
                )}
              </ul>
            )}
            <ul className="max-h-[420px] space-y-2 overflow-y-auto" aria-busy={history.isFetching}>
              {filteredHistory.map((artifact) => (
                <li key={artifact.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedHistoryIds.includes(artifact.id)}
                        onChange={(event) =>
                          setSelectedHistoryIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, artifact.id])]
                              : current.filter((id) => id !== artifact.id),
                          )
                        }
                        aria-label={`Select artifact ${artifact.id}`}
                      />
                      <span className="truncate font-mono text-xs">{artifact.id}</span>
                    </label>
                    <span
                      className={
                        artifact.integrityState === "ok" ? "text-emerald-600" : "text-destructive"
                      }
                    >
                      {artifact.integrityState} · {artifact.archivedAt ? "Archived" : "Active"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {artifact.sourceClass} · {artifact.width}×{artifact.height} ·{" "}
                    {artifact.redactionCount} redactions · {artifact.annotationCount} annotations
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    sha256:{artifact.derivativeSha256}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Retention:{" "}
                    {artifact.retainedUntil
                      ? new Date(artifact.retainedUntil).toLocaleString()
                      : "keep until explicitly changed"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!artifact.archivedAt && artifact.integrityState === "ok" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void addFromHistory(artifact.id)}
                        disabled={busy}
                      >
                        Add to composer
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        archiveArtifact.mutate({
                          artifactId: artifact.id,
                          archived: !artifact.archivedAt,
                        })
                      }
                    >
                      {artifact.archivedAt ? "Restore" : "Archive"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setRetentionArtifact.mutate({
                          artifactId: artifact.id,
                          retainedUntil: Date.now() + 30 * 24 * 60 * 60 * 1_000,
                        })
                      }
                    >
                      Retain 30 days
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setRetentionArtifact.mutate({
                          artifactId: artifact.id,
                          retainedUntil: null,
                        })
                      }
                    >
                      Keep
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Permanently delete this unreferenced visual artifact and override its retention date?",
                          )
                        ) {
                          deleteArtifact.mutate({
                            artifactId: artifact.id,
                            retentionOverride: true,
                          })
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
              {!history.isFetching && filteredHistory.length === 0 && (
                <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No matching confirmed captures.
                </li>
              )}
            </ul>
          </section>
        ) : !preview ? (
          <div className="space-y-3">
            {(approvedAgentRequests.data?.length ?? 0) > 0 && (
              <section
                aria-labelledby="approved-agent-captures-heading"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
              >
                <h3 id="approved-agent-captures-heading" className="text-sm font-medium">
                  Approved agent capture requests
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approval does not select a source. Continue only the exact request you recognize.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {approvedAgentRequests.data?.map((request) => (
                    <Button
                      key={request.captureRequestId}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void continueAgentRequest(request.captureRequestId)}
                      disabled={busy}
                    >
                      Continue run {request.runId.slice(0, 8)}
                    </Button>
                  ))}
                </div>
              </section>
            )}
            <div
              className="grid max-h-[520px] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2"
              aria-busy={busy}
            >
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="min-h-10 rounded-lg border p-2 text-left outline-offset-2 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => void choose(source)}
                  disabled={busy}
                  aria-label={`Capture ${source.kind}: ${source.label}`}
                >
                  {source.previewDataUrl ? (
                    <img
                      src={source.previewDataUrl}
                      alt=""
                      className="mb-2 aspect-video w-full rounded-md bg-black object-contain"
                    />
                  ) : (
                    <div className="mb-2 aspect-video w-full rounded-md bg-muted" />
                  )}
                  <div className="truncate text-sm font-medium">{source.label}</div>
                  <div className="text-xs text-muted-foreground">{source.kind}</div>
                </button>
              ))}
              {busy && sources.length === 0 && (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground sm:col-span-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading available screens and windows…
                </div>
              )}
              {!busy && sources.length === 0 && !error && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground sm:col-span-2">
                  No capture sources are available. Retry source selection after checking platform
                  permissions.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="relative overflow-auto rounded-lg border bg-black">
              <img
                src={preview}
                alt="Exact edited derivative preview"
                className="max-h-[500px] w-full object-contain"
              />
            </div>
            <div className="max-h-[500px] space-y-4 overflow-y-auto rounded-lg border p-3">
              <EditRectangle
                title="Crop"
                enabled={cropEnabled}
                onEnabledChange={setCropEnabled}
                value={crop}
                onChange={setCrop}
              />
              <EditRectangle
                title="Solid redaction"
                enabled={redact}
                onEnabledChange={setRedact}
                value={redaction}
                onChange={setRedaction}
              />
              <fieldset className="space-y-2 border-t pt-3">
                <legend className="text-sm font-medium">Annotation</legend>
                <label className="grid gap-1 text-xs">
                  <span>Type</span>
                  <select
                    value={annotationKind}
                    onChange={(event) => setAnnotationKind(event.target.value as AnnotationKind)}
                    className="h-10 rounded border bg-background px-2"
                  >
                    <option value="none">None</option>
                    <option value="box">Box</option>
                    <option value="arrow">Arrow</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                {annotationKind !== "none" && (
                  <label className="grid gap-1 text-xs">
                    <span>Color</span>
                    <input
                      type="color"
                      value={annotationColor}
                      onChange={(event) => setAnnotationColor(event.target.value)}
                      className="h-10 w-full rounded border bg-background p-1"
                    />
                  </label>
                )}
                {annotationKind === "box" && (
                  <RectangleFields
                    label="Box"
                    value={annotationRectangle}
                    onChange={setAnnotationRectangle}
                  />
                )}
                {annotationKind === "arrow" && (
                  <NumericFields label="Arrow" value={arrow} onChange={setArrow} />
                )}
                {annotationKind === "text" && (
                  <>
                    <NumericFields
                      label="Text position"
                      value={{ left: text.left, top: text.top }}
                      onChange={(position) => setText((current) => ({ ...current, ...position }))}
                    />
                    <label className="grid gap-1 text-xs">
                      <span>Text</span>
                      <input
                        type="text"
                        maxLength={500}
                        value={text.text}
                        onChange={(event) =>
                          setText((current) => ({ ...current, text: event.target.value }))
                        }
                        className="h-10 rounded border bg-background px-2"
                      />
                    </label>
                  </>
                )}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => resetEditor(dimensions.width, dimensions.height)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Undo edits
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void previewChanges()}
                  disabled={previewEdit.isPending}
                >
                  {previewEdit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Preview changes
                </Button>
              </div>
              <label className="grid gap-1 text-xs">
                <span>Retention</span>
                <select
                  value={retentionDays}
                  onChange={(event) => setRetentionDays(Number(event.target.value))}
                  className="h-10 rounded border bg-background px-2"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Keep until explicitly deleted</option>
                </select>
              </label>
              <p className="flex gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Only the exact metadata-stripped PNG shown after Preview changes can be confirmed.
                Cancel purges the pending raw frame.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => void close()} disabled={confirm.isPending}>
            Cancel
          </Button>
          {preview && !showHistory && (
            <Button
              onClick={() => void persist()}
              disabled={busy || !previewSha256 || !previewIsCurrent}
            >
              {confirm.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {previewSha256 && previewIsCurrent
                ? "Confirm and add"
                : "Preview changes before confirming"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditRectangle({
  title,
  enabled,
  onEnabledChange,
  value,
  onChange,
}: {
  title: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  value: Rectangle
  onChange: (value: Rectangle) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        Enable {title.toLowerCase()}
      </label>
      {enabled && <RectangleFields label={title} value={value} onChange={onChange} />}
    </fieldset>
  )
}

function RectangleFields({
  label,
  value,
  onChange,
}: {
  label: string
  value: Rectangle
  onChange: (value: Rectangle) => void
}) {
  return (
    <NumericFields
      label={label}
      value={value}
      onChange={onChange}
      minimums={{ width: 1, height: 1 }}
    />
  )
}

function NumericFields<T extends Record<string, number>>({
  label,
  value,
  onChange,
  minimums = {},
}: {
  label: string
  value: T
  onChange: (value: T) => void
  minimums?: Partial<Record<keyof T, number>>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(Object.keys(value) as Array<keyof T>).map((field) => (
        <label key={String(field)} className="grid gap-1 text-xs">
          <span>
            {label} {String(field)}
          </span>
          <input
            type="number"
            min={minimums[field] ?? 0}
            value={value[field]}
            onChange={(event) =>
              onChange({
                ...value,
                [field]: Math.max(minimums[field] ?? 0, Number(event.target.value)),
              })
            }
            className="h-10 min-w-0 rounded border bg-background px-2"
          />
        </label>
      ))}
    </div>
  )
}
