import { parsePermissionMode } from "../permissions"
import {
  capabilityLevelsNarrow,
  parseStoredCustomPermissionCapabilities,
  parseCustomPermissionCapabilities,
  permissionCapabilityLevels,
} from "../../../shared/permission-capabilities"
import type { McpCallerIdentity } from "./types"

export function mcpTargetPermissionAllowed(
  caller: McpCallerIdentity,
  targetMode: unknown,
  targetCustom: unknown,
): boolean {
  const from = parsePermissionMode(caller.permissionMode)
  const to = parsePermissionMode(targetMode)
  if (!from || !to) return false
  const parent = permissionCapabilityLevels(from, caller.customPermissions ?? null)
  const custom =
    typeof targetCustom === "string"
      ? parseStoredCustomPermissionCapabilities(targetCustom)
      : parseCustomPermissionCapabilities(targetCustom)
  const target = permissionCapabilityLevels(to, custom)
  return Boolean(parent && target && capabilityLevelsNarrow(parent, target))
}
