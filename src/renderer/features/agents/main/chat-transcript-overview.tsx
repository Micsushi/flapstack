import type { TranscriptMarker } from "./chat-transcript-overview-model"

export function ChatTranscriptOverview({
  markers,
  onJump,
}: {
  markers: readonly TranscriptMarker[]
  onJump: (marker: TranscriptMarker) => void
}) {
  if (markers.length === 0) return null

  return (
    <nav
      aria-label="Transcript timeline"
      className="absolute bottom-24 left-1.5 top-16 z-20 hidden w-7 items-center justify-center sm:flex"
    >
      <span className="sr-only">Private reasoning is never summarized here.</span>
      <ol className="relative flex max-h-full flex-col justify-center">
        {markers.map((marker) => (
          <li key={marker.id} className="relative flex justify-center">
            <button
              type="button"
              className="group/marker relative flex min-h-10 w-7 touch-manipulation items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={`Go to prompt ${marker.ordinal} of ${marker.total}: ${marker.promptPreview}`}
              onClick={() => onJump(marker)}
            >
              <span className="block h-px w-2 bg-muted-foreground/50 transition-[width,background-color] group-hover/marker:w-5 group-hover/marker:bg-foreground group-focus-visible/marker:w-5 group-focus-visible/marker:bg-foreground" />
              <span className="pointer-events-none absolute left-7 top-1/2 hidden w-80 -translate-y-1/2 rounded-xl border border-border bg-popover px-3 py-2.5 text-left text-popover-foreground shadow-lg group-hover/marker:block group-focus-visible/marker:block">
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
  )
}
