import { useState } from "react"
import {
  Ban,
  Bookmark,
  Check,
  CircleAlert,
  Clock3,
  Eye,
  Flag,
  Minus,
  Plus,
  Reply,
  Star,
  Tag,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "../../components/ui/button"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../components/ui/dropdown-menu"
import { Input } from "../../components/ui/input"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"

export type ChatTagView = { id: string; name: string; color: string; icon?: string | null }

export const CHAT_TAG_ICONS = {
  alert: CircleAlert,
  ban: Ban,
  reply: Reply,
  eye: Eye,
  clock: Clock3,
  star: Star,
  flag: Flag,
  bookmark: Bookmark,
} satisfies Record<string, LucideIcon>

type ChatTagIconName = keyof typeof CHAT_TAG_ICONS

const tagStyles: Record<string, string> = {
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
}

export function ChatTagIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = icon ? CHAT_TAG_ICONS[icon as ChatTagIconName] : null
  return Icon ? <Icon className={className} aria-hidden="true" /> : null
}

export function ChatTagChip({ tag, compact = false }: { tag: ChatTagView; compact?: boolean }) {
  return (
    <span
      title={tag.name}
      className={cn(
        "inline-flex max-w-24 shrink-0 items-center truncate rounded border font-medium",
        compact ? "h-4 px-1 text-[9px]" : "h-5 px-1.5 text-[10px]",
        tagStyles[tag.color] ?? tagStyles.slate,
      )}
    >
      <ChatTagIcon icon={tag.icon} className="h-2.5 w-2.5 shrink-0" />
      <span className={cn(tag.icon && "ml-1")}>{tag.name}</span>
    </span>
  )
}

export function ChatTagSubmenu({
  chatId,
  assignedTags,
}: {
  chatId: string
  assignedTags: ChatTagView[]
}) {
  const utils = trpc.useUtils()
  const { data: tags = [] } = trpc.chats.listTags.useQuery()
  const [name, setName] = useState("")
  const [color, setColor] = useState<
    "slate" | "blue" | "cyan" | "green" | "amber" | "orange" | "rose" | "violet"
  >("violet")
  const [icon, setIcon] = useState<ChatTagIconName | null>(null)
  const assignedIds = new Set(assignedTags.map((tag) => tag.id))
  const refresh = async () => {
    await Promise.all([
      utils.chats.listTagAssignments.invalidate(),
      utils.chats.listTags.invalidate(),
    ])
  }
  const assign = trpc.chats.assignTag.useMutation({ onSuccess: refresh })
  const unassign = trpc.chats.unassignTag.useMutation({ onSuccess: refresh })
  const create = trpc.chats.createTag.useMutation({
    onSuccess: async (tag) => {
      await assign.mutateAsync({ chatId, tagId: tag.id })
      setName("")
      setIcon(null)
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        Tags
        {assignedTags.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{assignedTags.length}</span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64" sideOffset={6} alignOffset={-4}>
        <div className="max-h-52 overflow-y-auto py-1">
          {tags.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">No tags yet</div>
          )}
          {tags.map((tag) => {
            const checked = assignedIds.has(tag.id)
            return (
              <DropdownMenuItem
                key={tag.id}
                onSelect={(event) => {
                  event.preventDefault()
                  if (checked) unassign.mutate({ chatId, tagId: tag.id })
                  else assign.mutate({ chatId, tagId: tag.id })
                }}
                className="gap-2"
              >
                {tag.icon ? (
                  <ChatTagIcon icon={tag.icon} className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      tagStyles[tag.color]?.split(" ")[1] ?? "bg-slate-500/20",
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                {checked && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            )
          })}
        </div>
        <DropdownMenuSeparator />
        <div
          className="space-y-2 p-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Create and assign</div>
          <div className="flex gap-1.5">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tag name"
              maxLength={32}
              className="h-7 text-xs"
            />
            <Button
              type="button"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate({ name, color, icon })}
              aria-label="Create tag"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex gap-1.5" aria-label="Tag color">
            {Object.keys(tagStyles).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-label={`${candidate} tag color`}
                aria-pressed={candidate === color}
                className={cn(
                  "h-4 w-4 rounded-full border transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  tagStyles[candidate],
                  candidate === color &&
                    "ring-2 ring-foreground/60 ring-offset-1 ring-offset-popover",
                )}
                onClick={() => setColor(candidate as typeof color)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Tag icon">
            <button
              type="button"
              aria-label="No tag icon"
              aria-pressed={icon === null}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                icon === null && "border-foreground/50 bg-accent text-foreground",
              )}
              onClick={() => setIcon(null)}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {Object.entries(CHAT_TAG_ICONS).map(([candidate, Icon]) => (
              <button
                key={candidate}
                type="button"
                aria-label={`${candidate} tag icon`}
                aria-pressed={candidate === icon}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  candidate === icon && "border-foreground/50 bg-accent text-foreground",
                )}
                onClick={() => setIcon(candidate as ChatTagIconName)}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
