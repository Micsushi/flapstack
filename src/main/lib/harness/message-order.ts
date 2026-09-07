import { serializePromptParts } from "../../../shared/prompt-serialization"

/** Explicit durable identity takes precedence over text-based legacy retries. */
export function findPromptById(messages: any[], id: string, prompt: string): any | undefined {
  const message = messages.find((message) => message?.id === id)
  if (message && (message.role !== "user" || serializePromptParts(message.parts) !== prompt))
    throw new Error("Prompt message identity was reused with different content")
  return message
}

/** A completed reply belongs before later queued user turns, not at the transcript tail. */
export function insertAssistantForPrompt(
  messages: any[],
  assistant: any,
  promptId?: string | null,
): any[] {
  const promptIndex = promptId ? messages.findIndex((message) => message?.id === promptId) : -1
  const nextUser =
    promptIndex < 0
      ? -1
      : messages.findIndex((message, index) => index > promptIndex && message?.role === "user")
  const result = [...messages]
  result.splice(nextUser < 0 ? result.length : nextUser, 0, assistant)
  return result
}
