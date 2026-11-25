import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAtomValue } from "jotai"
import {
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircleQuestion,
  type LucideIcon,
} from "lucide-react"
import { trpc } from "../../../lib/trpc"
import {
  agentsUnseenChangesAtom,
  loadingSubChatsAtom,
  pendingPlanApprovalsAtom,
  pendingUserQuestionsAtom,
} from "../atoms"
import { resolveCanonicalConversationId } from "../lib/canonical-conversation"
import {
  chatStatusPriority,
  resolveChatStatus,
  type ChatStatus,
  type ChatStatusKind,
} from "../lib/chat-status"

const appearance = {
  "needs-input": {
    Icon: MessageCircleQuestion,
    color: "text-amber-700 dark:text-amber-400",
    label: "Needs your input",
  },
  "dependency-wait-failed": {
    Icon: CircleX,
    color: "text-red-700 dark:text-red-400",
    label: "Dependency wait failed",
  },
  failed: {
    Icon: CircleX,
    color: "text-red-700 dark:text-red-400",
    label: "Run failed",
  },
  blocked: {
    Icon: LockKeyhole,
    color: "text-violet-700 dark:text-violet-400",
    label: "Blocked",
  },
  running: {
    Icon: LoaderCircle,
    color: "text-cyan-700 dark:text-cyan-400 motion-safe:animate-spin",
    label: "In progress",
  },
  stopped: {
    Icon: CirclePause,
    color: "text-orange-700 dark:text-orange-400",
    label: "Stopped before completion",
  },
  unread: {
    Icon: Mail,
    color: "text-blue-700 dark:text-blue-400",
    label: "Unread reply",
  },
  complete: {
    Icon: CircleCheck,
    color: "text-sky-700 dark:text-sky-400",
    label: "Run completed, reply read",
  },
  unknown: {
    Icon: CircleHelp,
    color: "text-slate-600 dark:text-slate-400",
    label: "Run status unknown",
  },
} satisfies Record<ChatStatusKind, { Icon: LucideIcon; color: string; label: string }>

const StatusContext = createContext<ReadonlyMap<string, ChatStatus>>(new Map())

export function ChatStatusProvider({ children }: { children: ReactNode }) {
  const unread = useAtomValue(agentsUnseenChangesAtom)
  const loading = useAtomValue(loadingSubChatsAtom)
  const questions = useAtomValue(pendingUserQuestionsAtom)
  const plans = useAtomValue(pendingPlanApprovalsAtom)
  const { data } = trpc.chats.listAgentMetadata.useQuery(undefined, { refetchInterval: 2_000 })
  const statuses = useMemo(() => {
    const runs = new Map<string, NonNullable<typeof data>["runStatuses"]>()
    for (const run of data?.runStatuses ?? []) {
      const entries = runs.get(run.chatId) ?? []
      entries.push(run)
      runs.set(run.chatId, entries)
    }
    const running = new Set(loading.values())
    const needsInput = new Set([
      ...plans.values(),
      ...[...questions.values()].map((question) => question.parentChatId),
    ])
    const blocked = new Set<string>()
    const dependencyWaitFailed = new Set<string>()
    for (const wait of data?.waits ?? []) {
      if (wait.status === "failed") dependencyWaitFailed.add(wait.chatId)
      else if (wait.status === "waiting") blocked.add(wait.chatId)
      else if (wait.status === "resuming") running.add(wait.chatId)
    }
    const ids = new Set([
      ...runs.keys(),
      ...unread,
      ...running,
      ...needsInput,
      ...blocked,
      ...dependencyWaitFailed,
    ])
    const statuses = new Map<string, ChatStatus>()
    for (const chatId of ids) {
      const conversations = runs.get(chatId) ?? []
      const canonicalId = resolveCanonicalConversationId(conversations)
      const hasUnread = unread.has(chatId)
      const kind = resolveChatStatus({
        unread: hasUnread,
        running: running.has(chatId),
        needsInput: needsInput.has(chatId),
        blocked: blocked.has(chatId),
        dependencyWaitFailed: dependencyWaitFailed.has(chatId),
        runStatus: conversations.find((run) => run.id === canonicalId)?.runStatus,
      })
      if (kind) statuses.set(chatId, { kind, unread: hasUnread })
    }
    return statuses
  }, [data?.runStatuses, data?.waits, unread, loading, questions, plans])
  return <StatusContext.Provider value={statuses}>{children}</StatusContext.Provider>
}

export function ChatStatusIndicator({ chatIds }: { chatIds: string[] }) {
  const statuses = useContext(StatusContext)
  const entries = [...new Set(chatIds)].flatMap((id) => statuses.get(id) ?? [])
  return <ChatStatusSummary statuses={entries} />
}

export function ChatStatusSummary({ statuses }: { statuses: readonly ChatStatus[] }) {
  const counts = new Map<ChatStatusKind, number>()
  for (const { kind } of statuses) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  const kinds = chatStatusPriority.filter((kind) => counts.has(kind))
  const primary = kinds[0]
  if (!primary) return null

  const { Icon, color } = appearance[primary]
  const labels = kinds.map((kind) => {
    const count = counts.get(kind) ?? 0
    const { label } = appearance[kind]
    return count > 1 ? `${label} (${count})` : label
  })
  if (statuses.some(({ kind, unread }) => unread && kind !== "unread")) {
    labels.push("Also has unread replies")
  }
  const label = labels.join(" · ")
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 align-middle"
      data-chat-status
    >
      <Icon aria-hidden className={`h-3 w-3 ${color}`} />
    </span>
  )
}
