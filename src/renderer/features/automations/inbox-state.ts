import type { AutomationInboxItem } from "../../../main/lib/automation/ui-service"

type Focusable = { focus: () => void }
type NotificationItem = Pick<
  AutomationInboxItem,
  "id" | "unread" | "title" | "body" | "automationName" | "kind" | "chatId"
>

export function moveAutomationInboxFocus(input: {
  direction: "next" | "previous"
  currentIndex: number
  itemIds: string[]
  elements: ReadonlyMap<string, Focusable>
}): number {
  if (input.itemIds.length === 0) return 0
  const offset = input.direction === "next" ? 1 : -1
  const nextIndex = Math.max(0, Math.min(input.itemIds.length - 1, input.currentIndex + offset))
  input.elements.get(input.itemIds[nextIndex]!)?.focus()
  return nextIndex
}

export function collectNewAutomationInboxNotifications(
  items: NotificationItem[],
  previousIds: ReadonlySet<string> | null,
): { currentIds: Set<string>; notifications: NotificationItem[] } {
  const currentIds = new Set(items.map((item) => item.id))
  if (previousIds === null) return { currentIds, notifications: [] }
  return {
    currentIds,
    notifications: items.filter((item) => item.unread && !previousIds.has(item.id)),
  }
}
