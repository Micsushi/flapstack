import { isAbsolute, resolve } from "node:path"

type CodexStdioTransport = {
  command?: string | null
  args?: string[] | null
  cwd?: string | null
}

export type ResolvedCodexStdioLaunch = {
  command: string | undefined
  args: string[]
  cwd: string | undefined
}

function isExplicitRelativePath(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../")
}

/**
 * Preserve Codex MCP working-directory semantics when Flapstack probes the
 * server itself or forwards the launch through ACP, whose stdio schema has no
 * cwd field. Explicit relative executable/argument paths become absolute for
 * ACP; the original cwd is also returned for the direct MCP SDK probe.
 */
export function resolveCodexStdioLaunch(transport: CodexStdioTransport): ResolvedCodexStdioLaunch {
  const configuredCwd = transport.cwd?.trim() || undefined
  const absoluteCwd = configuredCwd && isAbsolute(configuredCwd) ? configuredCwd : undefined
  const configuredCommand = transport.command?.trim() || undefined

  return {
    command:
      configuredCommand && absoluteCwd && isExplicitRelativePath(configuredCommand)
        ? resolve(absoluteCwd, configuredCommand)
        : configuredCommand,
    args: (transport.args || []).map((argument) =>
      absoluteCwd && isExplicitRelativePath(argument) ? resolve(absoluteCwd, argument) : argument,
    ),
    cwd: absoluteCwd,
  }
}
