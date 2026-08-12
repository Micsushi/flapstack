"use client"

import { useEffect, useState } from "react"

function readVisibility(): boolean {
  if (typeof document === "undefined") return true
  return document.visibilityState === "visible"
}

/**
 * Tracks whether this window is currently visible.
 *
 * Used to suspend always-on polling while a workbench window is hidden. Gate on
 * visibility rather than focus: a background but visible window still needs to
 * show latency-sensitive prompts, and a hidden window has nothing to paint.
 * Callers that suspend a poll should also refetch on the transition back to
 * visible, since `refetchOnWindowFocus` is disabled globally.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(readVisibility)

  useEffect(() => {
    if (typeof document === "undefined") return

    const onVisibilityChange = () => setVisible(readVisibility())

    // Resync on mount in case visibility changed before the listener attached.
    onVisibilityChange()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  return visible
}
