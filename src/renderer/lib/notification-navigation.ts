export type NotificationNavigationPayload = { chatId?: string; subChatId?: string }

/** Keep slow metadata responses from reopening an earlier notification target. */
export function subscribeNotificationNavigation<T>(
  subscribe: (listener: (target: NotificationNavigationPayload) => void) => () => void,
  load: (chatId: string) => Promise<T>,
  navigate: (chat: NonNullable<T>, target: NotificationNavigationPayload) => void,
) {
  let generation = 0
  let disposed = false
  const unsubscribe = subscribe((target) => {
    if (!target.chatId) return
    const request = ++generation
    void load(target.chatId)
      .then((chat) => {
        if (!disposed && request === generation && chat) navigate(chat, target)
      })
      .catch((error) => {
        if (!disposed && request === generation) {
          console.warn("[Notification] Failed to open chat:", error)
        }
      })
  })
  return () => {
    disposed = true
    unsubscribe()
  }
}
