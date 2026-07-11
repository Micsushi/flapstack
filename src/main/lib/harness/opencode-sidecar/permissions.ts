/**
 * Permission mapping + approval bridge for OpenCode-backed harnesses
 * (Track E — E5).
 *
 * Two responsibilities, both pure and testable:
 *  1. `buildOpencodePermissionConfig` — map a Flapstack permission mode into
 *     OpenCode agent permission rules (edit/bash/webfetch = ask|allow|deny).
 *  2. `decideAutoApproval` — for permission requests OpenCode raises at runtime,
 *     decide allow/ask/deny for the current mode without a UI round-trip where
 *     the mode is unambiguous (read-only always denies mutations; full-access
 *     always allows).
 *
 * Anything OpenCode cannot enforce exactly is reported as a
 * `HarnessPermissionLimitation` via `buildOpencodePermissionApplication`, mirroring
 * the Codex/Claude honesty pattern — never claim enforcement we don't have.
 */

import type {
  HarnessPermissionApplication,
  HarnessPermissionLimitation,
} from "../../../../shared/harness-types"
import type { PermissionMode } from "../../permissions"
import type { SidecarApprovalDecision } from "./contract"

/** OpenCode per-tool permission verb. */
export type OpencodePermissionRule = "allow" | "ask" | "deny"

/** The coarse controls shown in Flapstack's permission preview. */
export type OpencodePermissionConfig = {
  edit: OpencodePermissionRule
  bash: OpencodePermissionRule
  webfetch: OpencodePermissionRule
}

/**
 * OpenCode's HTTP API accepts permissions as an ordered ruleset. Keep this
 * conversion at the boundary so Flapstack's coarse UI modes never get written
 * as an invalid OpenCode config object.
 */
export type OpencodeSessionPermission = {
  permission:
    | "edit"
    | "write"
    | "apply_patch"
    | "bash"
    | "webfetch"
    | "websearch"
    | "external_directory"
    | "task"
  pattern: "*"
  action: OpencodePermissionRule
}

export function buildOpencodePermissionConfig(mode: PermissionMode): OpencodePermissionConfig {
  switch (mode) {
    case "read-only":
      return { edit: "deny", bash: "deny", webfetch: "deny" }
    case "ask-before-edits":
      return { edit: "ask", bash: "ask", webfetch: "ask" }
    case "auto-edit-project-only":
      // Scoped edits auto-allowed; risky shell/network still asks.
      return { edit: "allow", bash: "ask", webfetch: "ask" }
    case "full-access":
      return { edit: "allow", bash: "allow", webfetch: "allow" }
    case "custom":
    default:
      // Conservative default until custom toggles are wired to the config.
      return { edit: "ask", bash: "ask", webfetch: "ask" }
  }
}

export function buildOpencodeSessionPermissions(mode: PermissionMode): OpencodeSessionPermission[] {
  const rules = buildOpencodePermissionConfig(mode)
  const externalDirectory: OpencodePermissionRule =
    mode === "read-only" ? "deny" : mode === "full-access" ? "allow" : "ask"
  return [
    { permission: "edit", pattern: "*", action: rules.edit },
    { permission: "write", pattern: "*", action: rules.edit },
    { permission: "apply_patch", pattern: "*", action: rules.edit },
    // OpenCode exposes git through bash, so this rule also gates git mutation.
    { permission: "bash", pattern: "*", action: rules.bash },
    { permission: "webfetch", pattern: "*", action: rules.webfetch },
    { permission: "websearch", pattern: "*", action: rules.webfetch },
    { permission: "external_directory", pattern: "*", action: externalDirectory },
    // A subagent can escape a narrow permission mode through its own tools.
    { permission: "task", pattern: "*", action: externalDirectory },
  ]
}

/** Classify an OpenCode permission string into a coarse capability bucket. */
export function classifyPermission(
  permission: string,
): "read" | "edit" | "bash" | "webfetch" | "other" {
  const p = permission.toLowerCase()
  if (p.includes("edit") || p.includes("write") || p.includes("patch")) return "edit"
  if (p.includes("bash") || p.includes("shell") || p.includes("run")) return "bash"
  if (p.includes("webfetch") || p.includes("websearch") || p.includes("network")) return "webfetch"
  if (
    p.includes("read") ||
    p.includes("glob") ||
    p.includes("grep") ||
    p.includes("list") ||
    p.includes("lsp")
  )
    return "read"
  return "other"
}

/**
 * Decide how to answer a runtime permission request without prompting when the
 * mode is unambiguous. Returns `null` when the decision genuinely belongs to the
 * user (ask-before-edits / custom on a mutating tool) so the caller routes it to
 * the approval UI.
 */
export function decideAutoApproval(
  mode: PermissionMode,
  permission: string,
): SidecarApprovalDecision | null {
  const bucket = classifyPermission(permission)
  // Read/search tools never mutate the workspace. OpenCode normally allows
  // them without prompting, but preserve that behavior if a request is raised.
  if (bucket === "read") return { reply: "once" }
  // Unknown tools are treated like shell (most conservative mutation bucket).
  const key: keyof OpencodePermissionConfig = bucket === "other" ? "bash" : bucket
  const rule = buildOpencodePermissionConfig(mode)[key]
  if (rule === "allow") return { reply: "once" }
  if (rule === "deny") {
    return { reply: "reject", message: `Blocked by Flapstack "${mode}" permission mode.` }
  }
  return null // ask — route to the user
}

function limitation(
  control: HarnessPermissionLimitation["control"],
  requested: string,
  reason: string,
): HarnessPermissionLimitation {
  return { control, requested, reason }
}

function getLimitations(mode: PermissionMode): HarnessPermissionLimitation[] {
  switch (mode) {
    case "read-only":
      // OpenCode denies edit/bash/webfetch, but MCP side effects can't be proven
      // from a permission name alone.
      return [
        limitation(
          "mcp",
          "deny mutating MCP tools",
          "Read-only relies on OpenCode's per-tool deny rules; MCP server side effects cannot be proven from the tool name alone.",
        ),
      ]
    case "auto-edit-project-only":
      return [
        limitation(
          "filesystem-write-scope",
          "writes limited to the selected project/worktree",
          "OpenCode edits are allowed but not filesystem-sandboxed to the project directory by Flapstack.",
        ),
      ]
    case "custom":
      return [
        limitation(
          "mcp",
          "custom per-tool toggles",
          "Custom mode currently maps to a conservative ask-everything OpenCode rule set; fine-grained toggles are not wired yet.",
        ),
      ]
    default:
      return []
  }
}

export function buildOpencodePermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const rules = buildOpencodePermissionConfig(params.permissionMode)
  const limitations = getLimitations(params.permissionMode)
  const enforced = [
    {
      control: "process-cwd" as const,
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The OpenCode sidecar operates in this directory."
        : "No cwd was provided for this launch.",
    },
    {
      control: "filesystem-write-scope" as const,
      applied: rules.edit !== "allow" || params.permissionMode === "auto-edit-project-only",
      value: `edit=${rules.edit}, bash=${rules.bash}, webfetch=${rules.webfetch}`,
      reason: "Flapstack sends these OpenCode per-tool permission rules with the session request.",
    },
  ]

  return {
    requested: params.permissionMode,
    applied: limitations.length === 0,
    degraded: limitations.length > 0,
    enforced,
    limitations,
    warnings: Array.from(
      new Set([
        `OpenCode permission rules: edit=${rules.edit}, bash=${rules.bash}, webfetch=${rules.webfetch}.`,
        ...limitations.map((l) => l.reason),
      ]),
    ),
    reason:
      limitations.length > 0
        ? "Flapstack maps the permission mode into OpenCode session rules and bridges approvals, but some controls (MCP side effects, filesystem sandboxing) are delegated to OpenCode."
        : "Flapstack maps the permission mode into OpenCode session rules and bridges approvals for this run.",
  }
}
