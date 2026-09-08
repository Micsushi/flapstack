/** Find only the requested desktop group or the explicitly mounted mobile chat surface. */
export function findDevVisibleTranscript(input: {
  document: Document
  chatId: string
  subChatId?: string
  selectedChatId: string | null
  mountedState?: { chatId: string | null; activeSubChatId: string | null }
}): HTMLElement | null {
  const groups = Array.from(
    input.document.querySelectorAll<HTMLElement>("[data-chat-group][data-active-chat-id]"),
  )
  const group = groups.find((element) => element.dataset.activeChatId === input.chatId)
  if (group)
    return group.querySelector<HTMLElement>("[data-chat-container][data-active-sub-chat-id]")

  const paneId = input.subChatId ?? input.mountedState?.activeSubChatId
  if (
    input.selectedChatId !== input.chatId ||
    input.mountedState?.chatId !== input.chatId ||
    !paneId ||
    input.mountedState.activeSubChatId !== paneId
  )
    return null
  const candidates = Array.from(
    input.document.querySelectorAll<HTMLElement>(
      "[data-mobile-chat-mode] [data-chat-container][data-active-sub-chat-id]",
    ),
  ).filter(
    (element) =>
      element.dataset.activeSubChatId === paneId &&
      !element.closest("[data-chat-group]") &&
      element.getClientRects().length > 0 &&
      input.document.defaultView?.getComputedStyle(element).visibility !== "hidden",
  )
  return candidates.length === 1 ? candidates[0]! : null
}
