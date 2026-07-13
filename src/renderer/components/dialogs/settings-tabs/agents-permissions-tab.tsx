import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { toast } from "sonner"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import {
  isSelectableRunPermissionMode,
  RUN_PERMISSION_MODE_LABELS,
  RUN_PERMISSION_MODE_OPTIONS,
} from "../../../features/agents/constants"
import { trpc } from "../../../lib/trpc"
import { Input } from "../../ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../ui/select"

type PermissionChangeBehavior = "ask" | "all-chats" | "current-chat"

const BEHAVIOR_LABELS: Record<PermissionChangeBehavior, string> = {
  ask: "Ask every time",
  "all-chats": "Always all chats",
  "current-chat": "Always this chat",
}

export function AgentsPermissionsTab() {
  const trpcUtils = trpc.useUtils()
  const [chatFilter, setChatFilter] = useState("")
  const { data: preferences } = trpc.permissions.getPreferences.useQuery()
  const { data: chats = [], isLoading: chatsLoading } = trpc.permissions.listChatModes.useQuery()

  const setGlobalDefault = trpc.permissions.setGlobalDefault.useMutation({
    onSuccess: () => {
      trpcUtils.permissions.getPreferences.invalidate()
      trpcUtils.permissions.getGlobalDefault.invalidate()
      toast.success("Default permission updated")
    },
    onError: (error) => toast.error(`Failed to update default: ${error.message}`),
  })
  const setChangeBehavior = trpc.permissions.setChangeBehavior.useMutation({
    onSuccess: () => {
      trpcUtils.permissions.getPreferences.invalidate()
      toast.success("Permission change behavior updated")
    },
    onError: (error) => toast.error(`Failed to update behavior: ${error.message}`),
  })
  const setChatMode = trpc.permissions.setChatMode.useMutation({
    onSuccess: (_result, variables) => {
      trpcUtils.permissions.listChatModes.invalidate()
      trpcUtils.permissions.resolveForChat.invalidate({ chatId: variables.chatId })
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.listArchived.invalidate()
      toast.success("Chat permission updated")
    },
    onError: (error) => toast.error(`Failed to update chat: ${error.message}`),
  })

  const filteredChats = useMemo(() => {
    const query = normalizeSearch(chatFilter)
    if (!query) return chats

    return chats.filter((chat) =>
      normalizeSearch(
        [chat.name, chat.projectName, chat.taskName, chat.archivedAt ? "archived" : "active"]
          .filter(Boolean)
          .join(" "),
      ).includes(query),
    )
  }, [chatFilter, chats])

  const behavior = preferences?.changeBehavior ?? "ask"
  const globalDefault = preferences?.globalDefault ?? "ask-before-edits"

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Permissions</h3>
        <p className="text-xs text-muted-foreground">
          Control permission-change prompts, new-chat defaults, and individual chats.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div
          data-settings-id="permissions-change-behavior"
          tabIndex={-1}
          className="flex items-center justify-between gap-6 p-4 outline-none"
        >
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">
              When changing permission in a chat
            </div>
            <div className="text-xs text-muted-foreground">
              Ask each time, or reuse a remembered all-chat or current-chat choice.
            </div>
          </div>
          <Select
            value={behavior}
            onValueChange={(value: PermissionChangeBehavior) =>
              setChangeBehavior.mutate({ behavior: value })
            }
            disabled={setChangeBehavior.isPending}
          >
            <SelectTrigger className="w-[165px] shrink-0 px-2 text-xs">
              {BEHAVIOR_LABELS[behavior]}
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BEHAVIOR_LABELS) as PermissionChangeBehavior[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {BEHAVIOR_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          data-settings-id="permissions-default"
          tabIndex={-1}
          className="flex items-center justify-between gap-6 border-t border-border p-4 outline-none"
        >
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">Default permission</div>
            <div className="text-xs text-muted-foreground">
              Used for Global chats and when no project or task default overrides it. Existing chats
              keep their stored permission.
            </div>
          </div>
          <Select
            value={globalDefault}
            onValueChange={(mode: RunPermissionMode) => setGlobalDefault.mutate({ mode })}
            disabled={setGlobalDefault.isPending}
          >
            <SelectTrigger className="w-[165px] shrink-0 px-2 text-xs">
              {isSelectableRunPermissionMode(globalDefault)
                ? RUN_PERMISSION_MODE_LABELS[globalDefault]
                : "Legacy mode - change required"}
            </SelectTrigger>
            <SelectContent>
              {RUN_PERMISSION_MODE_OPTIONS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {RUN_PERMISSION_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        data-settings-id="permissions-chat-list"
        tabIndex={-1}
        className="space-y-3 outline-none"
      >
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Chat permissions</div>
          <div className="text-xs text-muted-foreground">
            These selectors always update only the named chat.
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={chatFilter}
            onChange={(event) => setChatFilter(event.target.value)}
            placeholder="Filter chats, projects, or tasks"
            className="h-8 pl-9 text-xs"
          />
        </div>

        <div className="max-h-[440px] overflow-y-auto rounded-lg border border-border bg-background">
          {chatsLoading ? (
            <div className="p-4 text-xs text-muted-foreground">Loading chats…</div>
          ) : filteredChats.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">No matching chats.</div>
          ) : (
            filteredChats.map((chat, index) => (
              <div
                key={chat.id}
                className={`flex items-center justify-between gap-4 p-3 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {chat.name?.trim() || "Untitled chat"}
                    </span>
                    <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {chat.archivedAt ? "Archived" : "Active"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[chat.projectName, chat.taskName].filter(Boolean).join(" / ") || "Global chat"}
                  </div>
                </div>
                <Select
                  value={chat.permissionMode}
                  onValueChange={(mode: RunPermissionMode) =>
                    setChatMode.mutate({ chatId: chat.id, mode, scope: "current-chat" })
                  }
                  disabled={setChatMode.isPending}
                >
                  <SelectTrigger className="w-[155px] shrink-0 px-2 text-xs">
                    {isSelectableRunPermissionMode(chat.permissionMode)
                      ? RUN_PERMISSION_MODE_LABELS[chat.permissionMode]
                      : "Legacy mode - change required"}
                  </SelectTrigger>
                  <SelectContent>
                    {RUN_PERMISSION_MODE_OPTIONS.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {RUN_PERMISSION_MODE_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}
