import { toast } from "sonner"
import { trpcClient } from "./trpc"
import { isProgressText } from "../features/agents/lib/assistant-text-phase"

export function prepareReplyAudio(
  chatId: string,
  subChatId: string,
  message:
    { id?: string; role?: string; parts?: Array<{ type: string; text?: string }> } | undefined,
) {
  if (message?.role !== "assistant" || !message.id) return
  const text = message.parts
    ?.filter((part) => part.type === "text" && !isProgressText(part, false))
    .map((part) => part.text ?? "")
    .join("\n")
  if (!text?.trim()) return
  void trpcClient.speech.prepareReply
    .mutate({ chatId, subChatId, messageId: message.id, text })
    .catch((error) =>
      toast.error("Reply audio could not be prepared", {
        id: "reply-audio-error",
        description: error instanceof Error ? error.message : String(error),
      }),
    )
}
