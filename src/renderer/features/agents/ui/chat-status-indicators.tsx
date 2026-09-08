import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAtomValue } from "jotai"
import { CheckCircle2, CircleHelp, CirclePause, CircleX, LoaderCircle, LockKeyhole, Mail, MessageCircleQuestion } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { agentsUnseenChangesAtom, loadingSubChatsAtom, pendingPlanApprovalsAtom, pendingUserQuestionsAtom } from "../atoms"
import { outcomeLabels, resolveChatStatus, summarizeChatStatuses, type ChatStatus, type WorkOutcome } from "../lib/chat-status"

const outcomes = {
  "verified-complete": { Icon: CheckCircle2, color: "text-green-700 dark:text-green-400" },
  "stopped-incomplete": { Icon: CirclePause, color: "text-orange-700 dark:text-orange-400" },
  blocked: { Icon: LockKeyhole, color: "text-violet-700 dark:text-violet-400" },
  failed: { Icon: CircleX, color: "text-red-700 dark:text-red-400" },
  unknown: { Icon: CircleHelp, color: "text-slate-600 dark:text-slate-400" },
} satisfies Record<WorkOutcome, { Icon: typeof CircleHelp; color: string }>

const StatusContext = createContext<ReadonlyMap<string, ChatStatus>>(new Map())

/** One shared snapshot per surface, indexed once instead of scanning history per row. */
export function ChatStatusProvider({ children }: { children: ReactNode }) {
  const unread = useAtomValue(agentsUnseenChangesAtom)
  const loading = useAtomValue(loadingSubChatsAtom)
  const questions = useAtomValue(pendingUserQuestionsAtom)
  const plans = useAtomValue(pendingPlanApprovalsAtom)
  const { data } = trpc.chats.listAgentMetadata.useQuery(undefined, { refetchInterval: 2_000 })
  const statuses = useMemo(() => {
    const runs = new Map<string, (string | null)[]>()
    for (const run of data?.runStatuses ?? []) {
      const entries = runs.get(run.chatId) ?? []
      entries.push(run.runStatus)
      runs.set(run.chatId, entries)
    }
    const running = new Set(loading.values())
    const needsHelp = new Set([...plans.values(), ...[...questions.values()].map((question) => question.parentChatId)])
    const ids = new Set([...runs.keys(), ...unread, ...running, ...needsHelp])
    return new Map([...ids].map((chatId) => [chatId, resolveChatStatus({
      unread: unread.has(chatId), running: running.has(chatId), needsHelp: needsHelp.has(chatId), runStatuses: runs.get(chatId),
    })]))
  }, [data?.runStatuses, unread, loading, questions, plans])
  return <StatusContext.Provider value={statuses}>{children}</StatusContext.Provider>
}

export function ChatStatusIndicators({ chatIds }: { chatIds: string[] }) {
  const statuses = useContext(StatusContext)
  return <ChatStatusSummary statuses={[...new Set(chatIds)].map((id) => statuses.get(id) ?? resolveChatStatus({}))} />
}

export function ChatStatusSummary({ statuses }: { statuses: readonly ChatStatus[] }) {
  const summary = summarizeChatStatuses(statuses)
  const label = [
    summary.unread ? `${summary.unread} unread` : "Read",
    summary.running ? `${summary.running} running` : "No known running agent",
    ...(summary.needsHelp ? [`${summary.needsHelp} needs help or input`] : []),
    ...summary.outcomes.map((outcome) => outcomeLabels[outcome]),
  ].join("; ")
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center gap-1 align-middle" data-chat-status>
      {summary.unread > 0 && <Mail aria-hidden className="h-3 w-3 text-blue-700 dark:text-blue-400" />}
      {summary.running > 0 && <LoaderCircle aria-hidden className="h-3 w-3 text-cyan-700 dark:text-cyan-400 motion-safe:animate-spin" />}
      {summary.needsHelp > 0 && <MessageCircleQuestion aria-hidden className="h-3 w-3 text-amber-700 dark:text-amber-400" />}
      {summary.outcomes.map((outcome) => {
        const { Icon, color } = outcomes[outcome]
        return <Icon key={outcome} aria-hidden className={`h-3 w-3 ${color}`} />
      })}
    </span>
  )
}
