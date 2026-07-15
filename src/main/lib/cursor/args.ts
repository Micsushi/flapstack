import { mapCursorPermissionFlags, type PermissionMode } from "../permissions"

/** Build a non-interactive cursor-agent invocation for one Flapstack run. */
export function buildCursorArgs(params: {
  model: string
  cwd: string
  permissionMode: PermissionMode
  sessionId?: string
  forceNewSession?: boolean
  productMcpPluginDir?: string
}): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--model",
    params.model,
    "--workspace",
    params.cwd,
    // Headless cursor-agent otherwise waits for an interactive workspace-trust
    // prompt that this child process cannot answer. This only trusts the
    // selected workspace; permission mode still controls plan/sandbox/approval.
    "--trust",
  ]

  const flags = mapCursorPermissionFlags(params.permissionMode)
  if (flags.mode) args.push("--mode", flags.mode)
  if (flags.sandbox) args.push("--sandbox", flags.sandbox)
  if (flags.autoReview) args.push("--auto-review")
  if (flags.force) args.push("--force")

  if (params.productMcpPluginDir) {
    args.push("--plugin-dir", params.productMcpPluginDir, "--approve-mcps")
  }

  if (params.sessionId && !params.forceNewSession) {
    args.push("--resume", params.sessionId)
  }

  return args
}
