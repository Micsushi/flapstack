export const FLAPSTACK_MCP_INSTRUCTIONS = [
  "Use create_chat for a new ordinary chat or thread for the user. For a named project, pass projectName as given, such as Flapstack, even when the current chat is Global. If the name is missing from the workspace or matches multiple projects, ask which destination to use before creating. Omit the destination only when the user wants the current location or has not named one. Pass the requested title or a short title based on a stated purpose.",
  "When the user only asks to create a chat, leave it empty and briefly confirm its actual location in this conversation. If they also want a first message and its content is unclear, ask what to send. A short greeting is enough when they request a greeting or leave the wording to you.",
  "To create a chat and send a first message, set the requested or current harness in create_chat and use launch_run with the returned chat ID and the requested message. Report the launch state returned by the tool.",
  "When the user asks to delegate, coordinate, or run work in a subagent, use these tools without requiring the user to say MCP.",
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
