import { useState } from "react"
import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import type { AgentProviderId } from "./agent-model-selector"

export type HandoffSource = { chatId: string; subChatId: string }
export type ContinueWithProvider = (
  provider: AgentProviderId,
  model: string,
  confirmation: { requestId: string; digest: string },
) => Promise<void>

export default function CompactHandoffAction({
  source,
  provider,
  model,
  modelLabel,
  onContinue,
  onCreated,
}: {
  source: HandoffSource
  provider: AgentProviderId
  model: string
  modelLabel: string
  onContinue: ContinueWithProvider
  onCreated: () => void
}) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const preview = trpc.chats.previewRuntimeContinuation.useQuery(
    {
      requestId,
      sourceChatId: source.chatId,
      compactSourceSubChatId: source.subChatId,
      fullHistory: true,
      targetHarness: provider,
      targetModel: model,
      preference:
        provider === "codex"
          ? "codex"
          : provider === "claude-code"
            ? "claude-code"
            : "flapstack-native",
    },
    { retry: false, refetchOnWindowFocus: false },
  )
  const snapshot = preview.data
  const problem = error || preview.error?.message || snapshot?.availability.reason
  return (
    <div className="space-y-2 px-6 pb-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-muted-foreground">{modelLabel}</span>
        <Button
          size="sm"
          disabled={
            busy ||
            !snapshot ||
            snapshot.availability.state !== "available" ||
            preview.isError ||
            Boolean(error)
          }
          onClick={async () => {
            if (!snapshot || busy) return
            setBusy(true)
            try {
              await onContinue(provider, model, { requestId, digest: snapshot.digest })
              onCreated()
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Could not create the chat.")
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Creating chat…" : "Continue in new chat"}
        </Button>
      </div>
      {snapshot?.contextBudgetWarning && (
        <p role="status" className="text-amber-700 dark:text-amber-300">
          {snapshot.contextBudgetWarning}
        </p>
      )}
      {problem && (
        <div role="alert" className="text-destructive">
          {problem}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setError("")
              void preview.refetch()
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
