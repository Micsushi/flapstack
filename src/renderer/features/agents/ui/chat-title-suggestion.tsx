import { useAtomValue } from "jotai"
import { X } from "lucide-react"
import { useRef, useState } from "react"
import { isUntitledChatName } from "../../../../shared/chat-title"
import { Button } from "../../../components/ui/button"
import {
  chatSourceModeAtom,
  chatTitleGenerationEnabledAtom,
  chatTitleStyleAtom,
  selectedOllamaModelAtom,
} from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import type { TranscriptMarker } from "../main/chat-transcript-overview-model"

const REVIEW_INTERVAL = 4

export function ChatTitleSuggestion({
  chatId,
  name,
  turns,
  ready,
  onApply,
  onClose,
}: {
  chatId: string
  name: string
  turns: readonly TranscriptMarker[]
  ready: boolean
  onApply: (name: string, expectedName: string) => Promise<void>
  onClose: () => void
}) {
  const enabled = useAtomValue(chatTitleGenerationEnabledAtom)
  const source = useAtomValue(chatSourceModeAtom)
  const titleStyle = useAtomValue(chatTitleStyleAtom)
  const ollamaModel = useAtomValue(selectedOllamaModelAtom)
  const rowRef = useRef<HTMLDivElement>(null)
  const storageKey = "flapstack:chat-title-suggestion-dismissed:" + chatId
  const [dismissedTurn, setDismissedTurn] = useState(() => localStorage.getItem(storageKey))
  const [applying, setApplying] = useState(false)
  const [failedTurn, setFailedTurn] = useState<string | null>(null)
  const latest = turns.at(-1)
  const eligible =
    enabled &&
    source === "local" &&
    ready &&
    !isUntitledChatName(name) &&
    name.length <= 200 &&
    Boolean(latest?.responsePreview) &&
    latest?.id !== dismissedTurn &&
    turns.length >= REVIEW_INTERVAL &&
    turns.length % REVIEW_INTERVAL === 0
  const { data: suggestion } = trpc.chats.suggestTitle.useQuery(
    {
      chatId,
      promptId: latest?.id ?? "",
      currentTitle: name,
      titleStyle,
      ollamaModel,
      recentTurns: eligible
        ? turns
            .slice(-3)
            .map(({ promptPreview, responsePreview }) => ({ promptPreview, responsePreview }))
        : [],
    },
    { enabled: eligible, staleTime: Infinity, retry: false },
  )
  if (!eligible || !suggestion || !latest) return null

  const dismiss = () => {
    if (rowRef.current?.contains(document.activeElement)) onClose()
    setDismissedTurn(latest.id)
    try {
      localStorage.setItem(storageKey, latest.id)
    } catch {
      // Dismissal still applies to the current view if browser storage is full.
    }
  }
  const apply = async () => {
    if (applying) return
    setApplying(true)
    setFailedTurn(null)
    try {
      await onApply(suggestion, name)
      dismiss()
    } catch {
      setFailedTurn(latest.id)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      ref={rowRef}
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-xs"
    >
      <span role="status" className="min-w-0 break-words text-muted-foreground">
        {failedTurn === latest.id ? (
          "Couldn’t rename chat. Try again."
        ) : (
          <>
            Suggested title <span className="font-medium text-foreground">{suggestion}</span>
          </>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          aria-disabled={applying}
          onClick={() => void apply()}
        >
          {applying ? "Renaming…" : "Use title"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Dismiss title suggestion"
          aria-disabled={applying}
          onClick={() => {
            if (!applying) dismiss()
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
