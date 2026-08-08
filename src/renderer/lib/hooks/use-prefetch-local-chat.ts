import { useCallback } from "react"
import { trpc } from "../trpc"

export function usePrefetchLocalChat() {
  const utils = trpc.useUtils()

  return useCallback(
    (chatId: string) => {
      void utils.chats.getMetadata
        .fetch({ id: chatId }, { staleTime: 30_000 })
        .then((chat) => {
          const visibleSubChat = chat?.subChats[0]
          if (!visibleSubChat) return
          return utils.chats.getTranscript.prefetch(
            { chatId, subChatId: visibleSubChat.id },
            { staleTime: 30_000 },
          )
        })
        .catch(() => undefined)
    },
    [utils],
  )
}
