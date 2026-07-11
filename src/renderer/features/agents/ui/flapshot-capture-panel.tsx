"use client"

import { Camera, Loader2, RotateCw, Square, Video, X } from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { flapshotActionErrorMessage, flapshotStatusLabel } from "./flapshot-ui"

type FlapshotCapturePanelProps = {
  chatId: string
}

export function FlapshotCapturePanel({ chatId }: FlapshotCapturePanelProps) {
  const utils = trpc.useUtils()
  const status = trpc.flapshot.status.useQuery({ chatId }, { refetchInterval: 5_000, retry: false })
  const operations = trpc.flapshot.listOperations.useQuery(
    { chatId },
    { refetchInterval: 1_000, retry: false },
  )

  const refresh = () => {
    utils.flapshot.status.invalidate({ chatId })
    utils.flapshot.listOperations.invalidate({ chatId })
    utils.attachments.listByChat.invalidate({ chatId })
  }
  const screenshot = trpc.flapshot.captureScreenshot.useMutation({
    onSuccess: () => {
      toast.success("Flapshot screenshot started")
      refresh()
    },
    onError: (error) =>
      toast.error(flapshotActionErrorMessage(error.message, "Flapshot screenshot failed")),
  })
  const recording = trpc.flapshot.startRecording.useMutation({
    onSuccess: refresh,
    onError: (error) =>
      toast.error(flapshotActionErrorMessage(error.message, "Flapshot recording failed")),
  })
  const stop = trpc.flapshot.stopRecording.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || "Could not stop Flapshot recording"),
  })
  const cancel = trpc.flapshot.cancelOperation.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || "Could not cancel Flapshot operation"),
  })
  const restart = trpc.flapshot.restart.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || "Could not reconnect Flapshot"),
  })

  const active = useMemo(
    () =>
      (operations.data ?? []).filter((operation) =>
        ["queued", "running", "cancelling"].includes(operation.state),
      ),
    [operations.data],
  )
  const activeRecording = active.find((operation) => operation.kind === "recording")
  const latest = (operations.data ?? [])[0]
  const currentStatus = status.data
  const statusText = currentStatus
    ? flapshotStatusLabel({ ...currentStatus, latest })
    : "Checking Flapshot…"

  if (currentStatus?.platform && currentStatus.platform !== "darwin") return null

  return (
    <div className="px-2 pb-2">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-lg border border-border/70 bg-background/95 px-2 py-1.5 shadow-sm">
        <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">{statusText}</span>
        {currentStatus?.configured && !currentStatus.connected && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={restart.isPending}
            onClick={() => restart.mutate({ chatId })}
            title="Restart the external Flapshot MCP process"
          >
            <RotateCw className={cn("h-3.5 w-3.5", restart.isPending && "animate-spin")} />
            Reconnect
          </Button>
        )}
        {currentStatus?.connected && !currentStatus.paired && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={status.isFetching}
            onClick={() => status.refetch()}
            title="Refresh this live Flapshot connection after pairing it in Flapshot"
          >
            <RotateCw className={cn("h-3.5 w-3.5", status.isFetching && "animate-spin")} />
            Check pairing
          </Button>
        )}
        {currentStatus?.connected && currentStatus.paired && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={
                !currentStatus.actions.screenshot.available ||
                screenshot.isPending ||
                active.length > 0
              }
              onClick={() => screenshot.mutate({ chatId })}
              title={currentStatus.actions.screenshot.reason}
            >
              {screenshot.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              Screenshot
            </Button>
            {activeRecording ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                disabled={stop.isPending}
                onClick={() => stop.mutate({ chatId, operationId: activeRecording.operationId })}
                title="Stop recording and validate the resulting video"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                disabled={!currentStatus.actions.recording.available || recording.isPending}
                onClick={() => recording.mutate({ chatId })}
                title={currentStatus.actions.recording.reason}
              >
                <Video className="h-3.5 w-3.5" />
                Record
              </Button>
            )}
            {active[0] && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={cancel.isPending || active[0].state === "cancelling"}
                onClick={() => cancel.mutate({ chatId, operationId: active[0].operationId })}
                title={`Cancel ${active[0].kind} operation`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
