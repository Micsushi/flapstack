export { isOwnerRegistration } from "./codex-mcp-policy.mjs"

export function childHarnessEnvironment<T extends string | undefined>(
  environment: Record<string, T>,
): Record<string, T> {
  const env = { ...environment }
  for (const key of Object.keys(env)) {
    if (
      /^(?:FLAPSTACK_MCP_(?:OWNER_TOKEN(?:_FILE)?|CALLER_MODE)|(?:FLAPSTACK_)?PROJECT_RECORDS_TOKEN(?:_FILE)?)$/i.test(
        key,
      )
    )
      delete env[key]
  }
  return env
}
