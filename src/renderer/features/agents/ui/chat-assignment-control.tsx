import { Network } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { trpc, trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import { CHAT_ASSIGNED_ROLES, type ChatAssignment } from "../../../../shared/chat-assignment"

export function ChatAssignmentControl({ subChatId }: { subChatId: string }) {
  const utils = trpc.useUtils()
  const query = trpc.chats.getAssignment.useQuery({ subChatId }, { refetchOnWindowFocus: true })
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ChatAssignment | null>(null)
  const [before, setBefore] = useState<ChatAssignment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const data = query.data
  const refresh = () => utils.chats.getAssignment.invalidate().catch(() => undefined)
  useEffect(() => {
    if (open && !draft && data) {
      setDraft(data.assignment)
      setBefore(data.assignment)
    }
  }, [open, draft, data])
  const save = async () => {
    if (!before || !draft || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const next = await trpcClient.chats.updateAssignment.mutate({
        subChatId,
        expected: before,
        assignment: draft,
      })
      const restore = async (expected: ChatAssignment, assignment: ChatAssignment) => {
        await trpcClient.chats.updateAssignment.mutate({ subChatId, expected, assignment })
        await refresh()
      }
      recordAppAction({
        label: "Change assigned chat role and links",
        undo: () => restore(next.assignment, before),
        redo: () => restore(before, next.assignment),
      })
      setOpen(false)
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the assignment. Your draft is retained.",
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const changeRole = (value: string) =>
    setDraft({
      assignedRole: value ? (value as ChatAssignment["assignedRole"]) : null,
      leadChatId: value === "worker" ? (draft?.leadChatId ?? null) : null,
      discussionChatId:
        value === "worker" || value === "lead" ? (draft?.discussionChatId ?? null) : null,
    })
  const unchanged = JSON.stringify(before) === JSON.stringify(draft)
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (busy) return
        setOpen(value)
        if (value) {
          setDraft(data?.assignment ?? null)
          setBefore(data?.assignment ?? null)
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2"
          aria-label={
            data?.assignment.assignedRole
              ? `Edit owner-assigned ${data.assignment.assignedRole} role and links`
              : "Assign chat role and links"
          }
        >
          <Network className="size-3.5" aria-hidden="true" />
          {data?.assignment.assignedRole
            ? `Assigned ${data.assignment.assignedRole}`
            : "Assign role"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <div>
          <p className="font-medium">Owner-assigned role and links</p>
          <p className="text-xs text-muted-foreground">
            Organize related chats. These assignments do not start or delegate work.
          </p>
        </div>
        {data && (
          <p className="break-words text-xs text-muted-foreground" title={data.localHost.id}>
            Local host: {data.localHost.label}
          </p>
        )}
        {query.error && <p role="alert">{query.error.message}</p>}
        {!draft && !query.error && <p role="status">Loading assignment…</p>}
        {draft && data && (
          <>
            <label className="block space-y-1">
              <span>Assigned role</span>
              <select
                className="h-8 w-full rounded-md border bg-background px-2"
                value={draft.assignedRole ?? ""}
                onChange={(event) => changeRole(event.target.value)}
                disabled={busy}
              >
                <option value="">Unassigned</option>
                {CHAT_ASSIGNED_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {draft.assignedRole === "worker" && (
              <label className="block space-y-1">
                <span>Lead chat</span>
                <select
                  className="h-8 w-full rounded-md border bg-background px-2"
                  value={draft.leadChatId ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, leadChatId: event.target.value || null })
                  }
                  disabled={busy || !data.projectId}
                >
                  <option value="">No lead linked</option>
                  {data.choices
                    .filter((chat) => chat.assignedRole === "lead" || chat.id === draft.leadChatId)
                    .map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.name || chat.id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(draft.assignedRole === "worker" || draft.assignedRole === "lead") && (
              <label className="block space-y-1">
                <span>Discussion chat</span>
                <select
                  className="h-8 w-full rounded-md border bg-background px-2"
                  value={draft.discussionChatId ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, discussionChatId: event.target.value || null })
                  }
                  disabled={busy || !data.projectId}
                >
                  <option value="">No discussion linked</option>
                  {data.choices
                    .filter(
                      (chat) =>
                        chat.assignedRole === "discussion" || chat.id === draft.discussionChatId,
                    )
                    .map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.name || chat.id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {!data.projectId && (
              <p className="text-xs text-muted-foreground">
                Links require chats in the same project.
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={busy || unchanged}>
                {busy ? "Saving…" : "Save assignment"}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
