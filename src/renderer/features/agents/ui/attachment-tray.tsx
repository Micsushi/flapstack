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

export function AttachmentTray({ chatId, taskId, worktreePath }: AttachmentTrayProps) {
  const utils = trpc.useUtils()
  const [targetPaths, setTargetPaths] = useState<Record<string, string>>({})
  const { data: attachments = [] } = trpc.attachments.listByChat.useQuery(
    { chatId },
    { enabled: !!chatId },
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

  const visibleAttachments = useMemo(() => attachments.slice(0, 6), [attachments])

  if (visibleAttachments.length === 0) return null

  return (
    <div className="px-2 pb-2">
      <div className="w-full max-w-2xl mx-auto rounded-lg border border-border/70 bg-background/95 p-2 shadow-sm">
        <div className="flex items-center gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span>Attachments</span>
        </div>
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
      </div>
    </div>
  )
}
