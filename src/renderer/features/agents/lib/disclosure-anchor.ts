/** Keep the activated disclosure in the same place while its virtual row is remeasured. */
export function preserveDisclosurePosition(
  viewport: HTMLElement,
  disclosure: HTMLElement,
): () => void {
  const initialTop = disclosure.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  let frame: number | undefined
  const row = disclosure.closest("[aria-posinset]") ?? disclosure.parentElement ?? disclosure
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer?.disconnect()
    clearTimeout(timeout)
    viewport.removeEventListener("wheel", stop)
    viewport.removeEventListener("touchstart", stop)
    viewport.removeEventListener("pointerdown", stop)
    viewport.removeEventListener("keydown", stop)
  }
  function restore() {
    frame = undefined
    if (!viewport.contains(disclosure)) {
      stop()
      return
    }
    const position = disclosure.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    if (Math.abs(position - initialTop) > 1) viewport.scrollTop += position - initialTop
  }
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(restore)
  }
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
  const timeout = setTimeout(stop, 500)
  observer?.observe(row)
  viewport.addEventListener("wheel", stop, { passive: true })
  viewport.addEventListener("touchstart", stop, { passive: true })
  viewport.addEventListener("pointerdown", stop)
  viewport.addEventListener("keydown", stop)
  schedule()
  return stop
}
