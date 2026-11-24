export const FLAPSTACK_MCP_INSTRUCTIONS = [
  "Flapstack app-control tools can create and launch child agent chats across supported providers.",
  "When the user asks to create, delegate to, coordinate, or run work in a subagent, use these tools without requiring the user to say MCP.",
  "Use spawn_thread for a child on the same or another harness. Call list_models for available providers, models and reasoning efforts.",
  "Coordinated services are available only when their tools are exposed.",
  "If a tool is not listed, call tool_search with its name or purpose, then refresh the tool list to get its schema.",
  "If read_git_diff returns a pending handle, poll dispatch_status to collect it.",
  "Use launch_run to send a turn, read_run to check its outcome, and read_chat to read the conversation. Change model or reasoning effort between turns with update_chat_settings.",
  "External callers poll read_run or read_chat. When the user explicitly asks this chat to wait for other chats, use wait_for_chats and then stop the turn. Flapstack will monitor durable queued and running work and resume this same chat without cross-chat completion messages.",
  "OpenRouter and NanoGPT targets require an explicit model.",
].join(" ")

export function prependFlapstackMcpGuidance(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt
  return `[FLAPSTACK PRODUCT MCP]\n${FLAPSTACK_MCP_INSTRUCTIONS}\n[/FLAPSTACK PRODUCT MCP]\n\n${prompt}`
}
