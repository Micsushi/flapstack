export const DETACHED_CHAT_CHECKOUTS_DIRECTORY = "detached-chat-checkouts"

export function isInternalDetachedChatCheckoutPath(path?: string | null): boolean {
  if (!path) return false

  return path.trim().replace(/\\/g, "/").split("/").includes(DETACHED_CHAT_CHECKOUTS_DIRECTORY)
}
