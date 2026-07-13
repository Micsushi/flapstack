export type StoredCursorMessage = {
  id?: unknown
  role?: unknown
  parts?: unknown
}

function promptText(message: StoredCursorMessage): string {
  if (!Array.isArray(message.parts)) return ""
  return message.parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      const value = part as Record<string, unknown>
      if (value.type === "text" && typeof value.text === "string") return [value.text]
      if (value.type === "file-content" && typeof value.content === "string") {
        const filePath = typeof value.filePath === "string" ? value.filePath : "file"
        const fileName = filePath.split("/").pop() || filePath
        return [`\n--- ${fileName} ---\n${value.content}`]
      }
      return []
    })
    .join("\n")
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
