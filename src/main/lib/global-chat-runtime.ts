import { mkdir, realpath } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

export function getGlobalChatRuntimePath(userDataPath: string, chatId: string): string {
  const directoryName = encodeURIComponent(chatId).replaceAll(".", "%2E")
  return join(userDataPath, "data", "global-chats", directoryName)
}

export async function ensureGlobalChatRuntimePath(
  userDataPath: string,
  chatId: string,
): Promise<string> {
  const runtimePath = getGlobalChatRuntimePath(userDataPath, chatId)
  const profile = await realpath(userDataPath)
  for (const path of [join(userDataPath, "data"), dirname(runtimePath), runtimePath]) {
    await mkdir(path, { recursive: true })
    const expected = join(profile, relative(userDataPath, path))
    if (relative(expected, await realpath(path)) !== "") {
      throw new Error("Global chat directory is outside its assigned location.")
    }
  }
  return runtimePath
}
