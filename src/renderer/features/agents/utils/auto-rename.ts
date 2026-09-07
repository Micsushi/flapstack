import { sleep } from "../../../../shared/sleep"

interface AutoRenameParams {
  subChatId: string
  parentChatId: string
  userMessage: string
  generateName: (userMessage: string) => Promise<{ name: string | null }>
  applyName: (input: { subChatId: string; parentChatId: string; name: string }) => Promise<{
    subChatApplied: boolean
    parentChatApplied: boolean
  }>
  updateSubChatName: (subChatId: string, name: string) => void
  updateChatName: (chatId: string, name: string) => void
}

/**
 * Auto-rename a sub-chat (and optionally parent chat) based on the user's first message.
 * Generates a name via LLM, then retries renaming until the chat exists in DB.
 * Fire-and-forget - doesn't block chat streaming.
 */
export async function autoRenameAgentChat({
  subChatId,
  parentChatId,
  userMessage,
  generateName,
  applyName,
  updateSubChatName,
  updateChatName,
}: AutoRenameParams) {
  try {
    // 1. Generate name from LLM via tRPC
    const { name } = await generateName(userMessage)

    if (!name || name.toLocaleLowerCase() === "new chat") {
      return // Don't rename if we got a generic name
    }

    // 2. Retry loop with delays [0, 3000, 5000, 5000]ms
    const delays = [0, 3_000, 5_000, 5_000]

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (attempt > 0) {
        await sleep(delays[attempt])
      }

      try {
        const result = await applyName({ subChatId, parentChatId, name })
        if (result.subChatApplied) updateSubChatName(subChatId, name)
        if (result.parentChatApplied) updateChatName(parentChatId, name)

        return // Success!
      } catch {
        // NOT_FOUND or other error - retry
        if (attempt === delays.length - 1) {
          console.error(`[auto-rename] Failed to rename after ${delays.length} attempts`)
        }
      }
    }
  } catch {
    console.error("[auto-rename] Auto-rename failed")
  }
}
