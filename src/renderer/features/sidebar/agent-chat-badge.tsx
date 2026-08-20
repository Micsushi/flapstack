import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  Clock3,
  Hammer,
  ListChecks,
  Network,
  SearchCheck,
  Telescope,
  X,
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
  status: "waiting" | "resuming" | "failed"
  error?: string | null
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

/**
 * A failed wait never resumes its chat, so it has to read differently from a
 * pending one. `onDismiss` clears the durable failure the user acknowledged.
 */
export function AgentChatWaitBadge({
  wait,
  compact = false,
  header = false,
  onDismiss,
}: {
  wait: AgentChatWaitView
  compact?: boolean
  header?: boolean
  onDismiss?: () => void
}) {
  const targets = wait.targetNames.join(", ")
  const failed = wait.status === "failed"
  const title = failed
    ? `Agent wait for ${targets} failed${wait.error ? `: ${wait.error}` : ""}`
    : `Agent waiting for ${targets}`
  const iconSize = header ? "h-3.5 w-3.5" : "h-2.5 w-2.5"
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-dashed font-medium",
        failed
          ? "border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        header ? "h-7 text-[13px]" : "h-4 text-[10px]",
        compact ? (header ? "w-7 p-0" : "w-4 p-0") : header ? "gap-1.5 px-2.5" : "gap-1 px-1.5",
      )}
    >
      <Bot className={iconSize} aria-hidden="true" />
      {failed ? (
        <AlertTriangle className={iconSize} aria-hidden="true" />
      ) : (
        <Clock3 className={iconSize} aria-hidden="true" />
      )}
      {!compact && (
        <span>{failed ? "Wait failed" : wait.status === "resuming" ? "Resuming" : "Waiting"}</span>
      )}
      {failed && !compact && onDismiss && (
        <button
          type="button"
          aria-label="Dismiss failed wait"
          title="Dismiss failed wait"
          className="-mr-1 inline-flex items-center rounded-sm p-0.5 hover:bg-rose-500/20"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss()
          }}
        >
          <X className={iconSize} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
