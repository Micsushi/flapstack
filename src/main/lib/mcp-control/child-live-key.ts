import { createHmac, randomBytes } from "node:crypto"

const desktopKey = randomBytes(32)
export const CHILD_LIVE_KEY = "FLAPSTACK_MCP_CHILD_LIVE_KEY"

export function childLiveKey(chatId: string, runId: string) {
  return createHmac("sha256", desktopKey)
    .update(JSON.stringify([chatId, runId]))
    .digest("base64url")
}
