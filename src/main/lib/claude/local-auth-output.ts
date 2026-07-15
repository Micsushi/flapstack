const CLAUDE_AUTH_HOSTS = new Set([
  "anthropic.com",
  "claude.ai",
  "console.anthropic.com",
  "platform.claude.com",
])

export type ClaudeAuthOutputState = {
  oauthUrl: string | null
  waitingForCode: boolean
  verifying: boolean
}

function isClaudeAuthHost(hostname: string): boolean {
  return [...CLAUDE_AUTH_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

export function parseClaudeAuthOutput(output: string): ClaudeAuthOutputState {
  let oauthUrl: string | null = null
  for (const match of output.matchAll(/https?:\/\/[^\s\u0000-\u001f\u007f<>"']+/g)) {
    const candidate = match[0].replace(/[),.;]+$/, "")
    try {
      const url = new URL(candidate)
      if (isClaudeAuthHost(url.hostname)) {
        oauthUrl = url.toString()
        break
      }
    } catch {
      // Ignore malformed terminal output.
    }
  }

  return {
    oauthUrl,
    waitingForCode: /(?:paste|enter).{0,40}(?:authorization\s+)?code/i.test(output),
    verifying: /verifying|exchanging|finishing sign.?in/i.test(output),
  }
}
