import { useEffect, useRef, useState, type ReactNode } from "react"
import { MessageCircleQuestion, X } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Textarea } from "../../../components/ui/textarea"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { trpc, trpcClient } from "../../../lib/trpc"
import { appStore } from "../../../lib/jotai-store"
import { openAgentChatIdsAtom, selectedAgentChatIdAtom } from "../atoms"
import type { AskSideQuestion, SideQuestionMessage } from "../../../../shared/side-questions"

export function sideQuestionSnapshot(
  messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>,
): SideQuestionMessage[] {
  let remaining = 120_000
  const snapshot: SideQuestionMessage[] = []
  for (const message of messages.slice(-100).reverse()) {
    if (message.role !== "user" && message.role !== "assistant") continue
    const text = (message.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .slice(-Math.min(24_000, remaining))
    if (text && remaining > 0) {
      snapshot.unshift({ id: message.id, role: message.role, text })
      remaining -= text.length
    }
  }
  return snapshot
}

export function SideQuestionWorkspace({
  subChatId,
  messages,
  children,
}: {
  subChatId: string
  messages: Parameters<typeof sideQuestionSnapshot>[0]
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className={`${open ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
        <div className="flex shrink-0 justify-end px-3 py-1">
          <Button
            ref={trigger}
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <MessageCircleQuestion className="mr-2 size-4" />
            Side question
          </Button>
        </div>
        {children}
      </div>
      {open && (
        <SideQuestionPanel
          key={subChatId}
          subChatId={subChatId}
          messages={messages}
          onClose={() => {
            setOpen(false)
            requestAnimationFrame(() => trigger.current?.focus())
          }}
        />
      )}
    </div>
  )
}

function readDraft(key: string): { text: string; request?: AskSideQuestion } {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? { text: "" }
  } catch {
    return { text: "" }
  }
}

export function SideQuestionPanel({
  subChatId,
  messages,
  onClose,
}: {
  subChatId: string
  messages: Parameters<typeof sideQuestionSnapshot>[0]
  onClose: () => void
}) {
  const key = `flapstack:side-question:${subChatId}`
  const [draft, setDraft] = useState(() => readDraft(key))
  const draftRef = useRef(draft)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const utils = trpc.useUtils()
  const list = trpc.sideQuestions.list.useQuery({ subChatId }, { refetchInterval: 1_000 })
  const entries = list.data ?? []
  const running = entries.find((entry) => entry.status === "running")
  const latest = entries.at(-1)
  useEffect(() => {
    if (followLatest.current && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight
  }, [entries.length, latest?.answer, latest?.status])
  useEffect(() => {
    input.current?.focus()
  }, [])
  const saveDraft = (next: typeof draft) => {
    // Save before changing the composer so a storage error cannot discard a draft.
    try {
      localStorage.setItem(key, JSON.stringify(next))
      draftRef.current = next
      setDraft(next)
    } catch {
      setError("Could not save this draft. Keep this panel open and try again.")
    }
  }
  const refresh = () => utils.sideQuestions.list.invalidate({ subChatId })
  const action = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not complete this action. Try again.",
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const send = () =>
    action(async () => {
      const current = draftRef.current
      if (!current.text.trim() || running) return
      const refreshed = await trpcClient.sideQuestions.list.query({ subChatId })
      const accepted =
        current.request && refreshed.some((entry) => entry.id === current.request!.requestId)
      const currentThread = refreshed.at(-1)
      const request: AskSideQuestion = accepted
        ? current.request!
        : {
            subChatId,
            requestId: current.request?.requestId ?? crypto.randomUUID(),
            question: current.text.trim(),
            ...(currentThread && !currentThread.promotedChatId
              ? { threadId: currentThread.threadId }
              : {}),
            visibleMessages: sideQuestionSnapshot(messages),
            visibleContextTruncated:
              messages.length > 100 ||
              messages.some(
                (message) =>
                  (message.parts ?? [])
                    .filter((part) => part.type === "text")
                    .reduce((total, part) => total + (part.text?.length ?? 0), 0) > 24_000,
              ) ||
              messages.reduce(
                (total, message) =>
                  total +
                  (message.parts ?? [])
                    .filter((part) => part.type === "text")
                    .reduce((n, part) => n + (part.text?.length ?? 0), 0),
                0,
              ) > 120_000,
          }
      localStorage.setItem(key, JSON.stringify({ ...current, request }))
      draftRef.current = { ...current, request }
      await trpcClient.sideQuestions.ask.mutate(request)
      // A delayed acknowledgement must not erase newer typing or a reopened panel's draft.
      const stored = readDraft(key)
      if (stored.text === current.text && stored.request?.requestId === request.requestId) {
        localStorage.setItem(key, JSON.stringify({ text: "" }))
        if (draftRef.current.text === current.text) {
          draftRef.current = { text: "" }
          setDraft({ text: "" })
        }
      }
    })
  const openChat = async (id: string) => {
    const result = await trpcClient.sideQuestions.promote.mutate({ subChatId, id })
    await utils.chats.list.invalidate()
    appStore.set(openAgentChatIdsAtom, (current) =>
      current.includes(result.chatId) ? current : [...current, result.chatId],
    )
    appStore.set(selectedAgentChatIdAtom, result.chatId)
  }
  return (
    <aside
      aria-label="Side question"
      className="absolute inset-0 z-20 flex min-h-0 flex-col border-l border-border bg-background md:static md:w-[360px] md:max-w-[45%] md:shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">Side question</h2>
        <Button variant="ghost" size="icon" aria-label="Close side question" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-label="Side conversation">
        {list.isLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {list.error && (
          <div role="alert" className="text-sm">
            <p>{list.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {entries.map((entry) => (
          <article key={entry.id} className="mb-6 space-y-3">
            <p className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">
              {entry.question}
            </p>
            {entry.answer && <ChatMarkdownRenderer content={entry.answer} size="sm" />}
            {entry.status === "running" && (
              <div className="flex items-center justify-between">
                <span role="status" className="text-sm text-muted-foreground">
                  Answering…
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      trpcClient.sideQuestions.cancel.mutate({ subChatId, id: entry.id }),
                    )
                  }
                >
                  Stop
                </Button>
              </div>
            )}
            {(entry.status === "failed" || entry.status === "cancelled") && (
              <div className="space-y-2">
                <p role="status" className="text-sm text-muted-foreground">
                  {entry.error || "Stopped"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !!running}
                  onClick={() =>
                    void action(() =>
                      trpcClient.sideQuestions.retry.mutate({ subChatId, id: entry.id }),
                    )
                  }
                >
                  Retry
                </Button>
              </div>
            )}
            {entry.status === "completed" && entry.id === latest?.id && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void action(() => openChat(entry.id))}
              >
                {entry.promotedChatId ? "Open chat" : "Continue in new chat"}
              </Button>
            )}
          </article>
        ))}
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Textarea
          ref={input}
          aria-label="Ask a side question"
          placeholder="Ask a question…"
          maxLength={12_000}
          value={draft.text}
          onChange={(event) => saveDraft({ text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void send()
            }
          }}
          className="max-h-40 resize-y"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            type="submit"
            disabled={busy || !!running || !draft.text.trim() || list.isLoading || !!list.error}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  )
}
