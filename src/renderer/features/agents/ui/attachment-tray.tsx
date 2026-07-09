"use client"

import { FileText, FolderInput, Plus, Upload } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

type AttachmentTrayProps = {
  chatId: string
  taskId?: string | null
  worktreePath?: string | null
}

function formatKind(kind: string) {
  if (kind === "pasted-text") return "text"
  if (kind === "chat-history") return "history"
  return kind
}

const ATTACHMENT_PREVIEW_COUNT = 6

export function AttachmentTray({ chatId, taskId, worktreePath }: AttachmentTrayProps) {
  const utils = trpc.useUtils()
  const [targetPaths, setTargetPaths] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const { data: attachments = [] } = trpc.attachments.listByChat.useQuery(
    { chatId },
    { enabled: !!chatId },
  )
  // Task artifacts promoted from any chat in this task, so they stay findable
  // later regardless of which chat is open.
  const { data: taskArtifacts = [] } = trpc.attachments.listByTask.useQuery(
    { taskId: taskId ?? "" },
    { enabled: !!taskId },
  )

  const promoteMutation = trpc.attachments.promoteToTask.useMutation({
    onSuccess: () => {
      toast.success("Attachment added to task")
      utils.attachments.listByChat.invalidate({ chatId })
      if (taskId) utils.attachments.listByTask.invalidate({ taskId })
    },
    onError: (error) => toast.error(error.message || "Failed to add attachment to task"),
  })

  const writeMutation = trpc.attachments.writeToWorktree.useMutation({
    onSuccess: (result) => toast.success(`Wrote ${result.targetPath}`),
    onError: (error) => toast.error(error.message || "Failed to write attachment"),
  })

  const visibleAttachments = useMemo(
    () => (showAll ? attachments : attachments.slice(0, ATTACHMENT_PREVIEW_COUNT)),
    [attachments, showAll],
  )

  if (attachments.length === 0 && taskArtifacts.length === 0) return null

  return (
    <div className="px-2 pb-2">
      <div className="w-full max-w-2xl mx-auto rounded-lg border border-border/70 bg-background/95 p-2 shadow-sm">
        {attachments.length > 0 && (
          <div className="flex items-center gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>Attachments</span>
          </div>
        )}
        <div className="space-y-1.5">
          {visibleAttachments.map((attachment) => {
            const targetPath = targetPaths[attachment.id] ?? attachment.name
            const isTaskAttachment = taskId && attachment.taskId === taskId
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {attachment.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatKind(attachment.kind)}
                    {attachment.taskId ? " · task" : " · chat"}
                  </div>
                </div>
                <Input
                  value={targetPath}
                  onChange={(event) =>
                    setTargetPaths((current) => ({
                      ...current,
                      [attachment.id]: event.target.value,
                    }))
                  }
                  className="h-7 w-40 rounded-md text-xs"
                  disabled={!worktreePath}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={!taskId || !!isTaskAttachment || promoteMutation.isPending}
                      onClick={() => {
                        if (!taskId) return
                        promoteMutation.mutate({ id: attachment.id, taskId })
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add to task</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("h-7 w-7", !worktreePath && "opacity-50")}
                      disabled={!worktreePath || writeMutation.isPending}
                      onClick={() => {
                        if (!worktreePath) return
                        writeMutation.mutate({
                          id: attachment.id,
                          worktreePath,
                          targetRelativePath: targetPath || attachment.name,
                          overwrite: false,
                        })
                      }}
                    >
                      <FolderInput className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Write to worktree</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("h-7 w-7", !worktreePath && "opacity-50")}
                      disabled={!worktreePath || writeMutation.isPending}
                      onClick={() => {
                        if (!worktreePath) return
                        const ok = window.confirm(`Overwrite ${targetPath || attachment.name}?`)
                        if (!ok) return
                        writeMutation.mutate({
                          id: attachment.id,
                          worktreePath,
                          targetRelativePath: targetPath || attachment.name,
                          overwrite: true,
                        })
                      }}
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Overwrite in worktree</TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
        {attachments.length > ATTACHMENT_PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="mt-1.5 w-full rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            {showAll ? "Show fewer attachments" : `Show all ${attachments.length} attachments`}
          </button>
        )}
        {taskId && taskArtifacts.length > 0 && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <div className="flex items-center gap-2 px-1 pb-1.5 text-xs font-medium text-muted-foreground">
              <FolderInput className="h-3.5 w-3.5" />
              <span>Task artifacts</span>
            </div>
            <div className="space-y-1">
              {taskArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs text-foreground">{artifact.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {formatKind(artifact.kind)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
