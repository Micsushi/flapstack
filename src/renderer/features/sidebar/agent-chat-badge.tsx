import {
  BadgeCheck,
  Bot,
  Clock3,
  Hammer,
  ListChecks,
  Network,
  SearchCheck,
  Telescope,
  type LucideIcon,
} from "lucide-react"
import type { AgentChatLabelKey } from "../../../shared/chat-metadata"
import { cn } from "../../lib/utils"

export type AgentChatLabelView = {
  chatId: string
  key: AgentChatLabelKey
  confidence: number
}

export type AgentChatWaitView = {
  id: string
  chatId: string
  targetChatIds: string[]
  targetNames: string[]
  status: "waiting" | "resuming"
  createdAt: number
}

const LABELS: Record<AgentChatLabelKey, { label: string; icon: LucideIcon }> = {
  coordinator: { label: "Coordinator", icon: Network },
  reviewer: { label: "Reviewer", icon: SearchCheck },
  worker: { label: "Worker", icon: Hammer },
  researcher: { label: "Researcher", icon: Telescope },
  planner: { label: "Planner", icon: ListChecks },
  verifier: { label: "Verifier", icon: BadgeCheck },
}

export function AgentChatLabelBadge({
  label,
  compact = false,
  header = false,
}: {
  label: AgentChatLabelView
  compact?: boolean
  header?: boolean
}) {
  const definition = LABELS[label.key]
  const Icon = definition.icon
  const title = `Agent role · ${definition.label}`
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-violet-500/35 bg-violet-500/8 font-medium text-violet-700 dark:text-violet-300",
        header ? "h-7 text-[13px]" : "h-4 text-[10px]",
        compact ? (header ? "w-7 p-0" : "w-4 p-0") : header ? "gap-1.5 px-2.5" : "gap-1 px-1.5",
      )}
    >
      <Icon className={header ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} aria-hidden="true" />
      {!compact && <span>{definition.label}</span>}
    </span>
  )
}

export function AgentChatWaitBadge({
  wait,
  compact = false,
  header = false,
}: {
  wait: AgentChatWaitView
  compact?: boolean
  header?: boolean
}) {
  const targets = wait.targetNames.join(", ")
  const title = `Agent waiting for ${targets}`
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-amber-500/45 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300",
        header ? "h-7 text-[13px]" : "h-4 text-[10px]",
        compact ? (header ? "w-7 p-0" : "w-4 p-0") : header ? "gap-1.5 px-2.5" : "gap-1 px-1.5",
      )}
    >
      <Bot className={header ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} aria-hidden="true" />
      <Clock3 className={header ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} aria-hidden="true" />
      {!compact && <span>{wait.status === "resuming" ? "Resuming" : "Waiting"}</span>}
    </span>
  )
}
