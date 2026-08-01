import type { KeyboardEvent } from "react"

const LISTBOX_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"])

export function handleListboxKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || !LISTBOX_KEYS.has(event.key)) return
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="option"]:not([aria-disabled="true"]):not(:disabled)',
    ),
  )
  if (options.length === 0) return
  event.preventDefault()
  const focusedIndex = options.findIndex((option) => option === document.activeElement)
  const selectedIndex = options.findIndex(
    (option) => option.getAttribute("aria-selected") === "true",
  )
  const currentIndex = focusedIndex >= 0 ? focusedIndex : Math.max(selectedIndex, 0)
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length
  options[nextIndex]?.focus()
}
