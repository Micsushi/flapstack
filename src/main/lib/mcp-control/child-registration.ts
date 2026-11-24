import { isProtectedChildCredentialName } from "./codex-mcp-policy.mjs"

export { isOwnerRegistration } from "./codex-mcp-policy.mjs"

export function childHarnessEnvironment<T extends string | undefined>(
  environment: Record<string, T>,
): Record<string, T> {
  const env = { ...environment }
  for (const key of Object.keys(env)) {
    if (isProtectedChildCredentialName(key) || key.toUpperCase() === "FLAPSTACK_MCP_CALLER_MODE") {
      delete env[key]
    }
  }
  return env
}
