import { useState } from "react"
import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import { formatPermissionMode, getHarnessChipMeta } from "../constants"
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
  const name = getHarnessChipMeta(provider).name
  const problem = error || preview.error?.message || snapshot?.availability.reason
  return (
    <div className="space-y-2 px-2 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words text-muted-foreground">
          {modelLabel}
          {snapshot && " · " + formatPermissionMode(snapshot.authorityCeiling.permissionMode)}
        </span>
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
          Continue in {name}
        </Button>
      </div>
      {snapshot && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Handoff summary</summary>
          <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words font-sans">
            {snapshot.contextText}
          </pre>
        </details>
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
