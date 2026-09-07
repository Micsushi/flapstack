import { toast } from "sonner"
import { insertTextAtCursor } from "./paste-text"

/** Explicit menu action; desktop clipboard access is never used in the background. */
export async function pasteFromContextMenu(editor: HTMLElement, savedRange: Range | null) {
  if (!editor.isConnected || editor.getAttribute("contenteditable") !== "true") return
  try {
    const text = window.desktopApi?.clipboardRead
      ? await window.desktopApi.clipboardRead()
      : await navigator.clipboard.readText()
    if (!text || !editor.isConnected || editor.getAttribute("contenteditable") !== "true") return
    editor.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range =
      savedRange &&
      editor.contains(savedRange.startContainer) &&
      editor.contains(savedRange.endContainer)
        ? savedRange
        : document.createRange()
    if (range !== savedRange) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    selection.removeAllRanges()
    selection.addRange(range)

    // Reuse keyboard paste, including undo snapshots and large-text attachments.
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", text)
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData })
    if (editor.dispatchEvent(event)) insertTextAtCursor(text, editor)
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }))
  } catch {
    if (!editor.isConnected) return
    toast.error("Could not read clipboard", {
      description: "Try the keyboard paste shortcut or copy the text again.",
    })
  }
}
