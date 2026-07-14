const MCP_AMBIENT_SECRET =
  /(?:API_?KEY|AUTH(?:ORIZATION|_?TOKEN)?|BEARER|COOKIE|CREDENTIAL|PASS(?:WORD)?|PRIVATE_?KEY|SECRET|SESSION_?TOKEN|TOKEN)/i
const MCP_AMBIENT_SECRET_NAMES = new Set([
  "AWS_ACCESS_KEY_ID",
  "DOCKER_AUTH_CONFIG",
  "GPG_AGENT_INFO",
  "KRB5CCNAME",
  "KUBECONFIG",
  "NETRC",
  "PGPASSFILE",
  "SSH_AUTH_SOCK",
  "SSL_KEY_FILE",
])
const FLAPSTACK_CONTROL_ENV = /^FLAPSTACK_/i

/** Keep unrelated app, cloud, provider, and agent credentials out of third-party MCP children. */
export function sanitizeMcpAmbientEnvironment(
  environment: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !FLAPSTACK_CONTROL_ENV.test(name) &&
        !MCP_AMBIENT_SECRET.test(name) &&
        !MCP_AMBIENT_SECRET_NAMES.has(name),
    ),
  )
}
