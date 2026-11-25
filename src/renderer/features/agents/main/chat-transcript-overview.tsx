import { useEffect, useState, type RefObject } from "react"
import { cn } from "../../../lib/utils"
import { selectTranscriptMarkers, type TranscriptMarker } from "./chat-transcript-overview-model"

export function ChatTranscriptOverview({
  turns,
  onJump,
  scrollElementRef,
}: {
  turns: readonly TranscriptMarker[]
  onJump: (marker: TranscriptMarker) => void
  scrollElementRef?: RefObject<HTMLElement | null>
}) {
  const totalTurns = turns.length
  const [reachedTurn, setReachedTurn] = useState<number>()
  useEffect(() => {
    const viewport = scrollElementRef?.current
    if (!viewport || totalTurns <= 3) return
    const feed = viewport.querySelector("[data-total-message-groups]")
    if (!feed) return
    let frame = 0
    const update = () => {
      frame = 0
      const bottom =
        viewport.getBoundingClientRect().top + viewport.clientTop + viewport.clientHeight
      const groups = feed.querySelectorAll<HTMLElement>(":scope > [aria-posinset]")
      // Each group starts with its prompt. A reply can extend beyond the viewport.
      for (let index = groups.length - 1; index >= 0; index--) {
        const group = groups[index]!
        const bounds = group.getBoundingClientRect()
        if (bounds.height > 0 && bounds.top < bottom) {
          setReachedTurn(Number(group.getAttribute("aria-posinset")))
          return
        }
      }
      if (feed.getBoundingClientRect().top >= bottom) setReachedTurn(undefined)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)
    resize.observe(feed)
    // The virtualizer can swap mounted groups without changing the feed's height.
    const groups = new MutationObserver(schedule)
    groups.observe(feed, { childList: true })
    viewport.addEventListener("scroll", schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      groups.disconnect()
      viewport.removeEventListener("scroll", schedule)
    }
  }, [scrollElementRef, totalTurns])
  if (totalTurns <= 3) return null
  const active = turns[(reachedTurn ?? 0) - 1]
  const markers = selectTranscriptMarkers(turns, active)

  return (
    <>
      <nav
        aria-label="Transcript timeline"
        className="group/timeline absolute bottom-24 left-0 top-16 z-20 hidden w-10 items-center justify-center rounded-r-lg border-r border-transparent bg-transparent transition-[background-color,border-color,box-shadow] duration-150 hover:border-border hover:bg-popover hover:shadow-lg focus-within:border-border focus-within:bg-popover focus-within:shadow-lg motion-reduce:transition-none sm:flex"
      >
        <span className="sr-only">Private reasoning is never summarized here.</span>
        <ol className="relative flex max-h-full flex-col justify-center">
          {markers.map((marker) => (
            <li key={marker.id} className="relative flex justify-center">
              <button
                type="button"
                className="group/marker relative flex h-4 w-7 touch-manipulation items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-current={active?.id === marker.id || undefined}
                aria-label={`Go to prompt ${marker.ordinal} of ${marker.total}: ${marker.promptPreview}`}
                onClick={() => onJump(marker)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block transition-[width,background-color]",
                    active?.id === marker.id
                      ? "h-0.5 w-4 bg-foreground"
                      : "h-px w-2 bg-muted-foreground group-hover/marker:w-3 group-hover/marker:bg-foreground group-focus-visible/marker:w-3 group-focus-visible/marker:bg-foreground",
                  )}
                />
                <span className="pointer-events-none absolute left-9 top-1/2 hidden w-80 -translate-y-1/2 rounded-xl border border-border bg-popover px-3 py-2.5 text-left text-popover-foreground shadow-lg group-hover/marker:block group-focus-visible/marker:block">
                  <span className="line-clamp-2 block text-sm font-medium leading-5">
                    {marker.promptPreview}
                  </span>
                  {marker.responsePreview && (
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                      {marker.responsePreview}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex justify-end px-3 pt-1 sm:hidden">
        <select
          aria-label="Jump to a turn"
          className="max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          value=""
          onChange={(event) => {
            const marker = markers.find((candidate) => candidate.id === event.currentTarget.value)
            if (marker) onJump(marker)
          }}
        >
          <option value="" disabled>
            {active ? `Turn ${active.ordinal} of ${totalTurns}` : "Jump to a turn"}
          </option>
          {markers.map((marker) => (
            <option key={marker.id} value={marker.id}>
              {marker.ordinal}. {marker.promptPreview}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
