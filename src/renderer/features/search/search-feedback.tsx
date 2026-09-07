import React from "react"
import { Button } from "../../components/ui/button"

export function SearchFeedback({
  error,
  busy,
  onRetry,
  loadingLabel = "Searching…",
}: {
  error?: string | null
  busy: boolean
  onRetry: () => void
  loadingLabel?: string
}) {
  if (error) {
    return (
      <div className="mx-2 my-2 space-y-2 text-sm">
        <div role="alert" className="break-words text-foreground">
          <p>Could not search this workspace.</p>
          <p className="text-muted-foreground">{error}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={onRetry}
        >
          {busy ? "Retrying…" : "Retry search"}
        </Button>
      </div>
    )
  }
  return busy ? (
    <p role="status" className="mx-2 my-2 text-sm text-muted-foreground">
      {loadingLabel}
    </p>
  ) : null
}
