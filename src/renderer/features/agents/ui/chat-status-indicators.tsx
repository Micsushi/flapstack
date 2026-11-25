import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import {
  CircleHelp,
  LoaderCircle,
  LockKeyhole,
  Mail,
  TriangleAlert,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import {
  agentsUnseenChangesAtom,
  loadingSubChatsAtom,
  pendingPlanApprovalsAtom,
  pendingUserQuestionsAtom,
  seenChatAttentionAtom,
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
    Icon: CircleHelp,
    color: "text-amber-700 dark:text-amber-400",
    label: "Needs your input",
  },
  "dependency-wait-failed": {
    Icon: TriangleAlert,
    color: "text-red-700 dark:text-red-400",
    label: "Dependency wait failed",
  },
  failed: {
    Icon: TriangleAlert,
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
  unread: {
    Icon: Mail,
    color: "text-blue-700 dark:text-blue-400",
    label: "Unread reply",
  },
} satisfies Record<ChatStatusKind, { Icon: LucideIcon; color: string; label: string }>

const StatusContext = createContext<ReadonlyMap<string, ChatStatus>>(new Map())
const statusSlot = "inline-flex size-4 shrink-0 items-center justify-center"
const FilledLockKeyhole = createLucideIcon("FilledLockKeyhole", [
  ["path", { d: "M7 10V7a5 5 0 0 1 10 0v3", key: "shackle" }],
  [
    "path",
    {
      d: "M5 9h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3ZM12 14a2 2 0 1 0 0 4 2 2 0 1 0 0-4Z",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "body",
    },
  ],
])

export function useAcknowledgeChatAttention(chatId: string, visible: boolean) {
  const keys = useContext(StatusContext).get(chatId)?.unseenAttentionKeys
  const setSeen = useSetAtom(seenChatAttentionAtom)
  useEffect(() => {
    if (!visible || !keys?.length) return
    const acknowledge = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return
      setSeen((previous) => {
        const newKeys = keys.filter((key) => !previous.includes(key))
        return newKeys.length ? [...previous, ...newKeys].slice(-256) : previous
      })
    }
    acknowledge()
    window.addEventListener("focus", acknowledge)
    document.addEventListener("visibilitychange", acknowledge)
    return () => {
      window.removeEventListener("focus", acknowledge)
      document.removeEventListener("visibilitychange", acknowledge)
    }
  }, [keys, setSeen, visible])
}

export function ChatStatusProvider({ children }: { children: ReactNode }) {
  const unread = useAtomValue(agentsUnseenChangesAtom)
  const loading = useAtomValue(loadingSubChatsAtom)
  const questions = useAtomValue(pendingUserQuestionsAtom)
  const plans = useAtomValue(pendingPlanApprovalsAtom)
  const seen = useAtomValue(seenChatAttentionAtom)
  const { data } = trpc.chats.listAgentMetadata.useQuery(undefined, { refetchInterval: 2_000 })
  const statuses = useMemo(() => {
    const runs = new Map<string, NonNullable<typeof data>["runStatuses"]>()
    for (const run of data?.runStatuses ?? []) {
      const entries = runs.get(run.chatId) ?? []
      entries.push(run)
      runs.set(run.chatId, entries)
    }
    const running = new Set(loading.values())
    const needsInput = new Map<string, string[]>()
    const collect = (map: Map<string, string[]>, chatId: string, key: string) => {
      const keys = map.get(chatId) ?? []
      keys.push(key)
      map.set(chatId, keys)
    }
    for (const [subChatId, question] of questions) {
      collect(needsInput, question.parentChatId, `question:${subChatId}:${question.toolUseId}`)
    }
    for (const [subChatId, plan] of plans) {
      collect(needsInput, plan.parentChatId, `plan:${subChatId}:${plan.planId}`)
    }
    const blocked = new Map<string, string[]>()
    const dependencyWaitFailed = new Map<string, string[]>()
    for (const wait of data?.waits ?? []) {
      if (wait.status === "failed") collect(dependencyWaitFailed, wait.chatId, `wait:${wait.id}`)
      else if (wait.status === "waiting") collect(blocked, wait.chatId, `blocked-wait:${wait.id}`)
      else if (wait.status === "resuming") running.add(wait.chatId)
    }
    const ids = new Set([
      ...runs.keys(),
      ...unread,
      ...running,
      ...needsInput.keys(),
      ...blocked.keys(),
      ...dependencyWaitFailed.keys(),
    ])
    const statuses = new Map<string, ChatStatus>()
    const seenKeys = new Set(seen)
    for (const chatId of ids) {
      const conversations = runs.get(chatId) ?? []
      const canonicalId = resolveCanonicalConversationId(conversations)
      const run = conversations.find((entry) => entry.id === canonicalId)
      const hasUnread = unread.has(chatId)
      const inputKeys = needsInput.get(chatId)
      const waitKeys = dependencyWaitFailed.get(chatId)
      const blockKeys = blocked.get(chatId)
      const kind = resolveChatStatus({
        unread: hasUnread,
        running: running.has(chatId),
        needsInput: Boolean(inputKeys),
        blocked: Boolean(blockKeys),
        dependencyWaitFailed: Boolean(waitKeys),
        runStatus: run?.runStatus,
      })
      if (!kind) continue
      const runKey = `run:${kind}:${run?.attentionRunId ?? canonicalId ?? chatId}`
      const attentionKeys =
        kind === "running" || kind === "unread"
          ? undefined
          : ({
              "needs-input": inputKeys,
              "dependency-wait-failed": waitKeys,
              blocked: blockKeys,
              failed: undefined,
            }[kind] ?? [runKey])
      statuses.set(chatId, {
        kind,
        unread: hasUnread,
        unseenAttentionKeys: attentionKeys?.filter((key) => !seenKeys.has(key)),
      })
    }
    return statuses
  }, [data?.runStatuses, data?.waits, unread, loading, questions, plans, seen])
  return <StatusContext.Provider value={statuses}>{children}</StatusContext.Provider>
}

export function ChatStatusIndicator({ chatIds }: { chatIds: string[] }) {
  const statuses = useContext(StatusContext)
  const entries = [...new Set(chatIds)].flatMap((id) => statuses.get(id) ?? [])
  return <ChatStatusSummary statuses={entries} />
}

export function ChatStatusSummary({ statuses }: { statuses: readonly ChatStatus[] }) {
  const kinds = chatStatusPriority.filter((kind) => statuses.some((status) => status.kind === kind))
  const primary = kinds[0]
  if (!primary) return <span aria-hidden className={statusSlot} />

  const { Icon, color } = appearance[primary]
  const attention = (entries: readonly ChatStatus[]) =>
    entries.some(({ unseenAttentionKeys }) => unseenAttentionKeys?.length)
      ? "new"
      : entries.some(({ unseenAttentionKeys }) => unseenAttentionKeys)
        ? "seen"
        : undefined
  const primaryAttention = attention(statuses.filter((status) => status.kind === primary))
  const filledLock = primary === "blocked" && primaryAttention === "new"
  const StatusIcon = filledLock ? FilledLockKeyhole : Icon
  const labels = kinds.map((kind) => {
    const entries = statuses.filter((status) => status.kind === kind)
    const { label } = appearance[kind]
    const state = attention(entries)
    const count = entries.length > 1 ? ` (${entries.length})` : ""
    return state ? `${label}${count} (${state})` : `${label}${count}`
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
      className={statusSlot}
      data-chat-status={primary}
      data-attention={primaryAttention}
    >
      <StatusIcon
        aria-hidden
        className={cn(
          "size-4",
          color,
          primaryAttention === "new" &&
            !filledLock &&
            "[&>:first-child]:fill-current [&>:not(:first-child)]:stroke-background",
        )}
      />
    </span>
  )
}
