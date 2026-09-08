export function quoteOccurrences(text: string, quote: string): number[] {
  if (!quote) return []
  const starts: number[] = []
  let start = text.indexOf(quote)
  while (start !== -1) {
    starts.push(start)
    start = text.indexOf(quote, start + 1)
  }
  return starts
}
export function selectedMessageQuote(messageId: string): string | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const element =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  const message = element?.closest("[data-assistant-message-id], [data-user-message-id]")
  if (
    message?.getAttribute("data-assistant-message-id") !== messageId &&
    message?.getAttribute("data-user-message-id") !== messageId
  )
    return undefined
  return selection.toString().trim() || undefined
}
