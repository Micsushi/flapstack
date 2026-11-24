import type { HarnessPermissionApplication, RunPermissionMode } from "./harness-types"

export function antigravityPermissions(mode: RunPermissionMode): HarnessPermissionApplication {
  const reasons: Record<RunPermissionMode, string> = {
    "read-only": "Flapstack blocks writes and command execution requested through Antigravity.",
    "ask-before-edits": "Antigravity asks Flapstack before making changes or running commands.",
    "auto-edit-project-only":
      "Antigravity can edit inside the selected checkout. Commands are blocked.",
    "full-access": "Flapstack allows Antigravity's native tool requests.",
    custom: "Antigravity applies workspace-scoped file edits and the configured Flapstack tools.",
  }
  const applied = Object.hasOwn(reasons, mode)
  const reason = applied ? reasons[mode] : "Choose an Antigravity permission mode."
  return {
    requested: mode,
    applied,
    degraded: !applied,
    reason,
    enforced: [{ control: "filesystem-write-scope", applied, value: mode }],
    warnings: [
      "This policy controls Antigravity's ACP tool requests. It does not sandbox the CLI process.",
    ],
    limitations:
      mode === "custom"
        ? [
            {
              control: "shell",
              requested: "custom",
              reason:
                "Antigravity does not offer an isolated command sandbox. Workspace-scoped modes block command execution.",
            },
          ]
        : [],
  }
}
