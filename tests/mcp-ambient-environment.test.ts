import { describe, expect, it } from "vitest"
import { sanitizeMcpAmbientEnvironment } from "../src/main/lib/mcp-environment"

describe("third-party MCP ambient environment", () => {
  it("removes provider, cloud, repository, and agent credentials", () => {
    const sanitized = sanitizeMcpAmbientEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "en_US.UTF-8",
      ANTHROPIC_AUTH_TOKEN: "anthropic-secret",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-secret",
      CODEX_API_KEY: "codex-secret",
      CURSOR_API_KEY: "cursor-secret",
      FLAPSTACK_OPENROUTER_API_KEY: "openrouter-secret",
      FLAPSTACK_NANOGPT_API_KEY: "nanogpt-secret",
      GITHUB_TOKEN: "github-secret",
      AWS_ACCESS_KEY_ID: "aws-id",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      KRB5CCNAME: "/tmp/krb-cache",
      KUBECONFIG: "/tmp/kubeconfig",
      PGPASSFILE: "/tmp/pgpass",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/google.json",
      FLAPSTACK_MCP_CHAT_ID: "trusted-chat",
      FLAPSTACK_MCP_RUN_ID: "trusted-run",
      FLAPSTACK_DB_PATH: "/tmp/agents.db",
      FLAPSTACK_PRODUCT_MCP_INVALIDATION_ENDPOINT: "/tmp/control.sock",
    })

    expect(sanitized).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "en_US.UTF-8",
    })
    expect(JSON.stringify(sanitized)).not.toMatch(
      /secret|agent\.sock|google\.json|aws-id|krb-cache|kubeconfig|pgpass|trusted-|agents\.db|control\.sock/,
    )
  })
})
