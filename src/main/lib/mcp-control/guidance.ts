export const FLAPSTACK_MCP_INSTRUCTIONS = [
  "Flapstack app-control tools can create and launch child agent chats across supported providers.",
  "When the user asks to create, delegate to, coordinate, or run work in a subagent, use these tools without requiring the user to say MCP.",
  "Use spawn_thread for one codex, claude-code, cursor-agent, openrouter, or nanogpt child. Coordinated services are available only when their tools are exposed.",
  "OpenRouter and NanoGPT targets require an explicit model.",
].join(" ")

export function prependFlapstackMcpGuidance(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt
  return `[FLAPSTACK PRODUCT MCP]\n${FLAPSTACK_MCP_INSTRUCTIONS}\n[/FLAPSTACK PRODUCT MCP]\n\n${prompt}`
}
