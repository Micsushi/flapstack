export type StoredCursorMessage = {
  id?: unknown
  role?: unknown
  parts?: unknown
}

function promptText(message: StoredCursorMessage): string {
  return serializePromptParts(message.parts)
}

/** Reuse the existing logical user turn during auth recovery. */
export function findReusableCursorPromptMessage(
  messages: StoredCursorMessage[],
  prompt: string,
  authRetry: boolean,
): StoredCursorMessage | undefined {
  const candidates = authRetry
    ? [...messages].reverse().filter((message) => message.role === "user")
    : [messages.at(-1)]
  return candidates.find((message): message is StoredCursorMessage => {
    if (!message) return false
    return message.role === "user" && promptText(message) === prompt
  })
}
import { serializePromptParts } from "../../../shared/prompt-serialization"
