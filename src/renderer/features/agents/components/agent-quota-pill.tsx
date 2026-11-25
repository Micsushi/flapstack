import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import { quotaSeverityClass, useRemainingQuota } from "../lib/remaining-quota"

export function AgentQuotaPill({
  provider,
  modelId,
  onOpenUsage,
}: {
  provider: string
  modelId?: string | null
  onOpenUsage: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectQuota = useRemainingQuota(
    ["codex", "claude-code", "cursor-agent", "openrouter"].includes(provider),
  )
  const quota = selectQuota(provider, modelId)
  if (!quota) return null
  const { effective, windows } = quota
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            "Remaining quota, " + effective.displayValue + (effective.stale ? ", last known" : "")
          }
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md border border-border px-1.5 py-0.5 text-xs tabular-nums hover:bg-accent focus-visible:outline focus-visible:outline-ring",
            quotaSeverityClass[effective.severity],
          )}
        >
          {effective.stale && <span aria-hidden>~</span>}
          {effective.displayValue}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        forceDark={false}
        aria-label="Remaining quota"
        className="w-64 max-w-[calc(100vw-1rem)] p-3 text-xs"
      >
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {windows.map((window) => (
            <li key={window.key} className="grid grid-cols-[1fr_auto] gap-x-2">
              <span className="font-medium">{window.windowLabel}</span>
              <span className={cn("tabular-nums", quotaSeverityClass[window.severity])}>
                {window.displayValue}
              </span>
              <span className="text-muted-foreground">
                {window.scope === "model-specific" ? "Model limit" : "Shared provider limit"}
              </span>
              {window.resetAt && (
                <span className="whitespace-nowrap text-muted-foreground">
                  Resets in {formatReset(+window.resetAt - Date.now())}
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <span className="text-muted-foreground">
            {effective.stale ? "Last known · " : "Updated "}
            <time
              dateTime={effective.capturedAt.toISOString()}
              title={effective.capturedAt.toLocaleString()}
            >
              {effective.capturedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </time>
          </span>
          <button
            type="button"
            className="rounded-sm font-medium hover:underline focus-visible:outline focus-visible:outline-ring"
            onClick={() => {
              setOpen(false)
              onOpenUsage()
            }}
          >
            Usage settings
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatReset(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return minutes + "m"
  if (minutes < 1_440) return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m"
  return Math.floor(minutes / 1_440) + "d " + Math.floor((minutes % 1_440) / 60) + "h"
}
