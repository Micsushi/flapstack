import { describe, expect, it, vi } from "vitest"
import { subscribeNotificationNavigation } from "../src/renderer/lib/notification-navigation"
import type { NotificationNavigationPayload } from "../src/renderer/lib/notification-navigation"

function harness() {
  let click!: (target: NotificationNavigationPayload) => void
  const requests = new Map<string, (chat: { id: string } | null) => void>()
  const navigate = vi.fn()
  const unsubscribe = vi.fn()
  const cleanup = subscribeNotificationNavigation(
    (listener) => {
      click = listener
      return unsubscribe
    },
    (id) => new Promise<{ id: string } | null>((resolve) => requests.set(id, resolve)),
    navigate,
  )
  return { click, requests, navigate, unsubscribe, cleanup }
}

describe("notification navigation ordering", () => {
  it("keeps the most recently clicked exact task when metadata arrives out of order", async () => {
    const h = harness()
    h.click({ chatId: "old", subChatId: "old-task" })
    h.click({ chatId: "new", subChatId: "new-task" })
    h.requests.get("new")!({ id: "new" })
    await Promise.resolve()
    h.requests.get("old")!({ id: "old" })
    await Promise.resolve()
    expect(h.navigate.mock.calls).toEqual([
      [{ id: "new" }, { chatId: "new", subChatId: "new-task" }],
    ])
    h.cleanup()
  })

  it("does not navigate after teardown or fall back to an older deleted task", async () => {
    const h = harness()
    h.click({ chatId: "old" })
    h.click({ chatId: "deleted" })
    h.requests.get("deleted")!(null)
    h.requests.get("old")!({ id: "old" })
    await Promise.resolve()
    expect(h.navigate).not.toHaveBeenCalled()
    h.click({ chatId: "later" })
    h.cleanup()
    h.requests.get("later")!({ id: "later" })
    await Promise.resolve()
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })
})
