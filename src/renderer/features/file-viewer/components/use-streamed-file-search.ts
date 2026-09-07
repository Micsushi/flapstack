import { useEffect, useState } from "react"
import { trpcClient } from "../../../lib/trpc"
import type { WorkspaceFileResult } from "../../../../shared/workspace-search"

export function useStreamedFileSearch(projectPath: string, query: string, enabled: boolean) {
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify([projectPath, query, retry])
  const [state, setState] = useState<{
    key: string
    data: WorkspaceFileResult[]
    isFetching: boolean
    error?: { message: string }
  } | null>(null)
  useEffect(() => {
    if (!enabled) {
      setState(null)
      return
    }
    const requestId = crypto.randomUUID()
    let active = true
    let terminal = false
    setState({ key, data: [], isFetching: true })
    const fail = (message: string) => {
      if (!active || terminal) return
      terminal = true
      setState((current) => ({
        key,
        data: current?.key === key ? current.data : [],
        isFetching: false,
        error: { message },
      }))
    }
    const subscription = trpcClient.files.searchStream.subscribe(
      { projectPath, query, requestId, limit: 50, typeFilter: "file" },
      {
        onData: (event) => {
          if (!active || terminal || event.requestId !== requestId) return
          if (event.status === "error") return fail(event.message)
          terminal = event.status === "complete"
          setState({ key, data: event.results, isFetching: !terminal })
        },
        onError: (error) => fail(error.message),
        onComplete: () => {
          if (!terminal) fail("File discovery ended before completion. Retry.")
        },
      },
    )
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [projectPath, query, enabled, key])
  const current = enabled && state?.key === key ? state : null
  return {
    data: current?.data,
    error: current?.error,
    isFetching: enabled && (current?.isFetching ?? true),
    refetch: () => setRetry((value) => value + 1),
  }
}
