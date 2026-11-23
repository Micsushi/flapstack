import { getLocalToolOutcome } from "../../../../shared/local-tool-outcome"

export function LocalToolOutcome({
  part,
  streamState,
}: {
  part: Record<string, unknown>
  streamState?: unknown
}) {
  const outcome = getLocalToolOutcome(part, streamState)
  if (!outcome) return null
  return (
    <div className="px-2 py-0.5 text-xs" data-local-tool-outcome={outcome.state}>
      <div className="text-foreground">{outcome.label}</div>
      {outcome.reason && <div className="mt-1 break-words text-foreground">{outcome.reason}</div>}
    </div>
  )
}
