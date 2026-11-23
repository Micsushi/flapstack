type TurnMessage = { id: string; role: string; metadata?: Record<string, unknown> }

/** Attach a terminal state to the actual turn, including turns with no assistant output. */
export function markStoppedChatTurns<T extends TurnMessage>(
  messages: T[],
  stoppedPrompts: ReadonlySet<string>,
  stoppedByUser = false,
): T[] {
  let result = messages
  for (let index = 0; index < messages.length; index++) {
    const prompt = messages[index]
    if (prompt.role !== "user" || !stoppedPrompts.has(prompt.id)) continue
    let target = index
    for (let next = index + 1; next < messages.length && messages[next].role !== "user"; next++) {
      if (messages[next].role === "assistant") target = next
    }
    // An older cancelled run does not tell us who stopped a partial reply.
    if (target !== index && !stoppedByUser) continue
    const message = messages[target]
    const key = target === index ? "responseStopped" : "stoppedByUser"
    if (message.metadata?.[key] === true) continue
    if (result === messages) result = messages.slice()
    result[target] = { ...message, metadata: { ...message.metadata, [key]: true } }
  }
  return result
}
