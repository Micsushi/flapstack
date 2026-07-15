"use client"

import "./inbox-styles.css"
import { useEffect, useRef, useState } from "react"
import { useSetAtom } from "jotai"
import { ArrowLeft, CheckCheck, ExternalLink, Inbox, Mail, MailOpen } from "lucide-react"
import { trpc } from "../../lib/trpc"
import { chatSourceModeAtom } from "../../lib/atoms"
import {
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
} from "../agents/atoms"
import { detailsSidebarOpenAtom, detailsSidebarTabAtom } from "../details-sidebar/atoms"
import { AUTOMATION_A11Y, formatAutomationError } from "./automation-ui-model"
import { moveAutomationInboxFocus } from "./inbox-state"
import { automationEvidenceRunIdAtom } from "./state"

export function InboxView() {
  const setView = useSetAtom(desktopViewAtom)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const utils = trpc.useUtils()
  const inbox = trpc.automations.inbox.useQuery(
    { unreadOnly, limit: 200 },
    { refetchInterval: 5_000 },
  )
  const projects = trpc.projects.list.useQuery()
  const tasks = trpc.tasks.list.useQuery({ includeArchived: false })
  const markRead = trpc.automations.markInboxRead.useMutation()
  const markAll = trpc.automations.markAllInboxRead.useMutation()
  const navigate = useEvidenceNavigation(projects.data ?? [], tasks.data ?? [])
  const items = inbox.data?.items ?? []

  useEffect(() => {
    if (selectedIndex >= items.length) setSelectedIndex(Math.max(0, items.length - 1))
  }, [items.length, selectedIndex])

  const selected = items[selectedIndex] ?? null
  const openItem = async (item: (typeof items)[number]) => {
    try {
      if (item.unread) {
        await markRead.mutateAsync({ ids: [item.id], unread: false })
        await utils.automations.inbox.invalidate()
      }
      navigate(item)
    } catch (error) {
      setMessage(formatAutomationError(error))
    }
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelectedIndex(
        moveAutomationInboxFocus({
          direction: "next",
          currentIndex: selectedIndex,
          itemIds: items.map((item) => item.id),
          elements: itemRefs.current,
        }),
      )
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelectedIndex(
        moveAutomationInboxFocus({
          direction: "previous",
          currentIndex: selectedIndex,
          itemIds: items.map((item) => item.id),
          elements: itemRefs.current,
        }),
      )
    } else if (event.key === "Enter" && selected) {
      event.preventDefault()
      void openItem(selected)
    } else if (event.key === "Escape") setView("automations")
  }

  const markEverythingRead = async () => {
    try {
      const result = await markAll.mutateAsync()
      setMessage(`${result.changed} inbox items marked read.`)
      await utils.automations.inbox.invalidate()
    } catch (error) {
      setMessage(formatAutomationError(error))
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-background" aria-labelledby="automation-inbox-title">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => setView("automations")}
              className="rounded-md p-1.5 hover:bg-muted"
              aria-label="Back to local automations"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1
                id="automation-inbox-title"
                className="flex items-center gap-2 text-lg font-semibold"
              >
                <Inbox className="h-5 w-5" />
                Automation inbox
              </h1>
              <p className="text-sm text-muted-foreground">
                Local execution results. Open items to reach their real task, chat, and run
                evidence.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void markEverythingRead()}
            disabled={(inbox.data?.unreadCount ?? 0) === 0 || markAll.isPending}
            className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              aria-label={AUTOMATION_A11Y.unreadFilter}
            />
            Unread only
          </label>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {inbox.data?.unreadCount ?? 0} unread
          </span>
        </div>
        {message && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            {message}
          </p>
        )}

        {inbox.isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading local inbox…</p>
        ) : inbox.error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300"
          >
            {inbox.error.message}
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <MailOpen className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No automation inbox items</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed, failed, denied, budget-exhausted, and cancelled executions appear here.
            </p>
          </div>
        ) : (
          <ul
            aria-label={AUTOMATION_A11Y.inbox}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="space-y-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  ref={(element) => {
                    if (element) itemRefs.current.set(item.id, element)
                    else itemRefs.current.delete(item.id)
                  }}
                  type="button"
                  aria-current={index === selectedIndex ? "true" : undefined}
                  onFocus={() => setSelectedIndex(index)}
                  onClick={() => void openItem(item)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 ${index === selectedIndex ? "border-ring/50 bg-muted/30" : "bg-card"}`}
                >
                  <div className="flex items-start gap-3">
                    {item.unread ? (
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-label="Unread" />
                    ) : (
                      <MailOpen
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-label="Read"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.automationName} · <span className="capitalize">{item.kind}</span>
                      </p>
                      {item.body && <p className="mt-2 text-sm">{item.body}</p>}
                      <span className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600">
                        <ExternalLink className="h-3 w-3" />
                        Open real evidence
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function useEvidenceNavigation(
  projects: Array<{ id: string; name: string }>,
  tasks: Array<{ id: string; name: string; projectId: string }>,
) {
  const setChat = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChats = useSetAtom(openAgentChatIdsAtom)
  const setRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setScope = useSetAtom(selectedChatScopeAtom)
  const setSource = useSetAtom(chatSourceModeAtom)
  const setView = useSetAtom(desktopViewAtom)
  const setDetailsOpen = useSetAtom(detailsSidebarOpenAtom)
  const setDetailsTab = useSetAtom(detailsSidebarTabAtom)
  const setRun = useSetAtom(automationEvidenceRunIdAtom)
  return (item: {
    chatId: string | null
    taskId: string | null
    projectId: string | null
    runId: string | null
  }) => {
    if (item.taskId) {
      const task = tasks.find((candidate) => candidate.id === item.taskId)
      const projectId = item.projectId ?? task?.projectId ?? ""
      const project = projects.find((candidate) => candidate.id === projectId)
      setScope({
        type: "task",
        id: item.taskId,
        name: task?.name ?? "Task",
        projectId,
        projectName: project?.name ?? null,
      })
    } else if (item.projectId) {
      const project = projects.find((candidate) => candidate.id === item.projectId)
      setScope({ type: "project", id: item.projectId, name: project?.name ?? "Project" })
    }
    if (item.chatId) {
      setChat(item.chatId)
      setOpenChats((current) =>
        current.includes(item.chatId!) ? current : [...current, item.chatId!],
      )
      setRemote(false)
      setSource("local")
      setDetailsOpen(true)
      setDetailsTab("details")
      setRun(item.runId)
    }
    setView(null)
  }
}
