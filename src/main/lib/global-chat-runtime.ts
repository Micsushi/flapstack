import { mkdir } from "node:fs/promises"
import { join } from "node:path"

export function getGlobalChatRuntimePath(userDataPath: string, chatId: string): string {
  const directoryName = encodeURIComponent(chatId).replaceAll(".", "%2E")
  return join(userDataPath, "data", "global-chats", directoryName)
}

export async function ensureGlobalChatRuntimePath(
  userDataPath: string,
  chatId: string,
): Promise<string> {
  const runtimePath = getGlobalChatRuntimePath(userDataPath, chatId)
  await mkdir(runtimePath, { recursive: true })
  return runtimePath
}
