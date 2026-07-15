import { useEffect, useRef } from "react"
import { trpc } from "../../lib/trpc"
import { useDesktopNotifications } from "../agents/hooks/use-desktop-notifications"
import { collectNewAutomationInboxNotifications } from "./inbox-state"

/** Runs with the main agent workspace, independent of whether the Inbox view is open. */
export function useAutomationInboxNotifications() {
  const initializedIds = useRef<Set<string> | null>(null)
  const { showNotification } = useDesktopNotifications()
  const inbox = trpc.automations.inbox.useQuery(
    { unreadOnly: true, limit: 200 },
    { refetchInterval: 5_000 },
  )

  useEffect(() => {
    if (!inbox.data) return
    const result = collectNewAutomationInboxNotifications(inbox.data.items, initializedIds.current)
    initializedIds.current = result.currentIds
    for (const item of result.notifications) {
      showNotification(item.title, item.body ?? item.automationName, {
        priority: item.kind === "completed" ? "complete" : "error",
        chatId: item.chatId ?? undefined,
      })
    }
  }, [inbox.data, showNotification])
}
