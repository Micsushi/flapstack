import { useState } from "react"
import type { DiscussionScope, DiscussionTopic } from "../../../shared/discussions"
import { Button } from "../../components/ui/button"
import { trpcClient } from "../../lib/trpc"
import { recordAppAction } from "../../lib/app-action-history"

export function DiscussionAssist({
  topic,
  scope,
  annotationId,
  question,
  onSaved,
  refresh,
  disabled,
}: {
  topic: DiscussionTopic
  scope: DiscussionScope
  annotationId?: string
  question?: string
  onSaved?: () => void
  refresh: () => Promise<unknown>
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const ask = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await trpcClient.discussions.assist.mutate({
        scope,
        id: topic.id,
        expectedRevision: topic.revision,
        annotationId,
        question,
      })
      let revision = result.topic.revision
      const restore = async (targetRevision: number) => {
        const next = await trpcClient.discussions.restore.mutate({
          scope,
          id: topic.id,
          expectedRevision: revision,
          targetRevision,
        })
        revision = next.revision
        await refresh()
      }
      recordAppAction({
        label: annotationId ? "Ask about annotation" : "Refresh topic summary",
        undo: () => restore(topic.revision),
        redo: () => restore(result.topic.revision),
      })
      await refresh()
      onSaved?.()
      setMessage(`Reply from ${result.model} via Ollama. Discussion only; no worker launched.`)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Reply unavailable. Your draft is retained.",
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy || disabled || (Boolean(annotationId) && !question?.trim())}
        onClick={() => void ask()}
      >
        {busy ? "Requesting reply…" : annotationId ? "Ask assistant here" : "Refresh summary"}
      </Button>
      {message && (
        <p role="status" className="text-xs text-muted-foreground discussion-copy">
          {message}
        </p>
      )}
    </div>
  )
}
