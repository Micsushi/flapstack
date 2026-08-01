import { ListTree } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import type { ChatProgressSummary, TranscriptMarker } from "./chat-transcript-overview-model"

export function ProgressCapsule({ summary }: { summary: ChatProgressSummary }) {
  const details = [
    summary.currentStep,
    summary.plan ? `${summary.plan.completed} / ${summary.plan.total} plan items` : null,
    summary.changeCount == null
      ? null
      : `${summary.changeCount} change${summary.changeCount === 1 ? "" : "s"}`,
    summary.messageCount == null
      ? null
      : `${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"}`,
  ].filter((value): value is string => Boolean(value))
  return (
    <div
      className="inline-flex min-h-8 min-w-0 items-center gap-2 rounded-full border border-border bg-muted/35 px-3 text-xs tabular-nums"
      aria-label={[summary.state, ...details].join(". ")}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          summary.state === "Working"
            ? "bg-blue-600"
            : summary.state === "Compacting"
              ? "bg-amber-500"
              : "bg-muted-foreground/60"
        }`}
        aria-hidden="true"
      />
      <span className="shrink-0 font-medium">{summary.state}</span>
      {details.length > 0 && (
        <span className="truncate text-muted-foreground">{details.join(" · ")}</span>
      )}
    </div>
  )
}

export function ChatTranscriptOverview({
  summary,
  markers,
  onJump,
}: {
  summary: ChatProgressSummary
  markers: readonly TranscriptMarker[]
  onJump: (marker: TranscriptMarker) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-3 py-2">
      <ProgressCapsule summary={summary} />
      {markers.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
              Timeline
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            forceDark={false}
            className="w-[min(18rem,calc(100vw-2rem))] p-3"
            aria-label="Transcript timeline"
          >
            <p className="text-sm font-semibold">Transcript timeline</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Jump between visible messages. Private reasoning is never summarized here.
            </p>
            <ol className="relative mt-3 max-h-64 space-y-1 overflow-y-auto before:absolute before:bottom-5 before:left-[0.6875rem] before:top-5 before:w-px before:bg-border">
              {markers.map((marker) => (
                <li key={marker.id} className="relative">
                  <button
                    type="button"
                    className="flex min-h-10 w-full touch-manipulation items-center gap-3 rounded-md px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onJump(marker)}
                  >
                    <span className="z-10 h-2 w-2 shrink-0 rounded-full bg-blue-600 ring-4 ring-popover" />
                    <span className="min-w-0 truncate capitalize">
                      {marker.role} message {marker.ordinal} of {marker.total}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
