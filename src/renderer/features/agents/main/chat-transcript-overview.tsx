import { useEffect, useState, type RefObject } from "react"
import { cn } from "../../../lib/utils"
import type { TranscriptMarker } from "./chat-transcript-overview-model"

export function ChatTranscriptOverview({
  markers,
  onJump,
  scrollElementRef,
}: {
  markers: readonly TranscriptMarker[]
  onJump: (marker: TranscriptMarker) => void
  scrollElementRef?: RefObject<HTMLElement | null>
}) {
  const totalTurns = markers[0]?.total ?? 0
  const [visibleTurn, setVisibleTurn] = useState<number>()
  useEffect(() => {
    const viewport = scrollElementRef?.current
    if (!viewport || totalTurns <= 3) return
    const feed = viewport.querySelector("[data-total-message-groups]")
    if (!feed) return
    let frame = 0
    const update = () => {
      frame = 0
      const rect = viewport.getBoundingClientRect()
      const middle = rect.top + rect.height / 2
      const groups = feed.querySelectorAll<HTMLElement>(":scope > [aria-posinset]")
      let closest: number | undefined
      let distance = Infinity
      for (const group of Array.from(groups)) {
        const bounds = group.getBoundingClientRect()
        if (bounds.bottom <= rect.top || bounds.top >= rect.bottom) continue
        const nextDistance = Math.max(bounds.top - middle, middle - bounds.bottom, 0)
        if (nextDistance >= distance) continue
        closest = Number(group.getAttribute("aria-posinset"))
        distance = nextDistance
      }
      if (closest !== undefined) setVisibleTurn(closest)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)
    resize.observe(feed)
    viewport.addEventListener("scroll", schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      viewport.removeEventListener("scroll", schedule)
    }
  }, [scrollElementRef, totalTurns])
  if (totalTurns <= 3) return null
  const active =
    visibleTurn === undefined
      ? undefined
      : markers.reduce((closest, next) =>
          Math.abs(next.ordinal - visibleTurn) < Math.abs(closest.ordinal - visibleTurn)
            ? next
            : closest,
        )

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
                    "block h-px w-2 bg-muted-foreground transition-[width,background-color] group-hover/marker:w-5 group-hover/marker:bg-foreground group-focus-visible/marker:w-5 group-focus-visible/marker:bg-foreground",
                    active?.id === marker.id && "h-0.5 w-4 bg-foreground",
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
            {visibleTurn ? `Turn ${visibleTurn} of ${totalTurns}` : "Jump to a turn"}
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
