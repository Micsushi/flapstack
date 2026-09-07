import React from "react"
import { SearchFeedback } from "../../search/search-feedback"

export function FileSearchFeedback(props: {
  error?: string | null
  busy: boolean
  onRetry: () => void
}) {
  return <SearchFeedback {...props} loadingLabel="Searching files…" />
}
