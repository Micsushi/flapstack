import type { HarnessPermissionApplication, RunPermissionMode } from "./harness-types"

export function antigravityPermissions(mode: RunPermissionMode): HarnessPermissionApplication {
  const applied = mode === "full-access"
  const reason = applied
    ? "Antigravity uses your local account with Full access."
    : "Antigravity ACP cannot enforce this permission profile. Choose another harness or explicitly select Full access."
  return {
    requested: mode,
    applied,
    degraded: !applied,
    reason,
    enforced: [],
    warnings: [],
    limitations: applied ? [] : [{ control: "filesystem-write-scope", requested: mode, reason }],
  }
}
