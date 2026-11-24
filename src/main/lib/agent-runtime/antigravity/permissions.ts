import type { RequestPermissionRequest } from "@agentclientprotocol/sdk"
import { lstatSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import type { RuntimePermissionSnapshot } from "../../../../shared/agent-runtime"
import { parseCustomPermissionCapabilities } from "../../../../shared/permission-capabilities"
import { resolveProviderMcpPermission } from "../../mcp-control/provider-permissions"
import { FLAPSTACK_MCP_SERVER_NAME } from "../../mcp-control/registration"
import { eventRecord } from "../event-values"

const readKinds = new Set(["read", "search", "think"])
const writeKinds = new Set(["edit", "delete", "move"])
const targetFields = [
  "Path",
  "path",
  "AbsolutePath",
  "FilePath",
  "file_path",
  "SourcePath",
  "DestinationPath",
  "TargetPath",
  "OldPath",
  "NewPath",
]

function checkedWorkspaceTarget(root: string, target: string) {
  if (!target.trim() || target.includes("\0") || target.split(/[\\/]/).includes("..")) return false
  // Win32 device namespaces and alternate data streams are not ACP file targets.
  if (
    process.platform === "win32" &&
    (/^\\\\[?.]\\/.test(target) || target.replace(/^[a-z]:[\\/]/i, "").includes(":"))
  )
    return false
  try {
    const realRoot = realpathSync.native(root)
    const inside = (candidate: string) => {
      const suffix = relative(realRoot, candidate)
      return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix)
    }
    let current = resolve(realRoot, target)
    if (!inside(current) || relative(realRoot, current) === "") return false
    for (;;) {
      try {
        return inside(realpathSync.native(current))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
      }
      // A dangling link is an existing name and must not inherit its parent's permission.
      try {
        lstatSync(current)
        return false
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
      }
      const parent = dirname(current)
      if (parent === current || !inside(parent)) return false
      current = parent
    }
  } catch {
    return false
  }
}

function identifiesProductTool(
  fields: Record<string, unknown>,
  serverName: string,
  tool: string,
  metadata = false,
): boolean {
  const serverNames = ["ServerName", "serverName", "server_name", "server"]
  const toolNames = ["ToolName", "toolName", "tool_name", ...(metadata ? ["tool"] : [])]
  return (
    serverNames.every((key) => !Object.hasOwn(fields, key) || fields[key] === serverName) &&
    toolNames.every((key) => !Object.hasOwn(fields, key) || fields[key] === tool)
  )
}

export function antigravityPermissionDecision(
  permission: RuntimePermissionSnapshot,
  toolCall: RequestPermissionRequest["toolCall"],
  cwd: string,
  productMcpName: string | null,
): "allow" | "ask" | "deny" {
  const custom = parseCustomPermissionCapabilities(permission.customPermissions)
  const input = eventRecord(toolCall.rawInput)
  const title = toolCall.title?.trim() ?? ""
  const proxyTool = /^MCP Tool ([A-Za-z0-9_]+)\??$/.exec(title)?.[1]
  const titlePrefix = productMcpName ? `Run mcp_${productMcpName}_` : null
  const namedTool =
    titlePrefix && title.startsWith(titlePrefix)
      ? /^([A-Za-z0-9_]+)\??$/.exec(title.slice(titlePrefix.length))?.[1]
      : undefined
  const hasCommand = Object.keys(input).some((key) => /^(?:command(?:line)?|cmd)$/i.test(key))
  const tool = proxyTool ?? namedTool
  const matchesExplicitIdentity =
    productMcpName &&
    tool &&
    identifiesProductTool(input, productMcpName, tool) &&
    identifiesProductTool(eventRecord(toolCall._meta), productMcpName, tool, true)
  const nativeProductRequest = proxyTool
    ? input.ServerName === productMcpName && input.ToolName === proxyTool
    : Boolean(namedTool)
  const mcp =
    toolCall.kind === "other" && !hasCommand && matchesExplicitIdentity && nativeProductRequest
      ? resolveProviderMcpPermission({
          permissionMode: permission.mode,
          correlationId: toolCall.toolCallId,
          serverName: FLAPSTACK_MCP_SERVER_NAME,
          toolName: tool,
          customPermissions: custom,
          trustedProductServerName: FLAPSTACK_MCP_SERVER_NAME,
        })
      : null
  if (mcp?.source === "product" || mcp?.source === "unknown-product")
    return mcp.decision === "allow" ? "allow" : "deny"
  if (permission.mode === "full-access") return "allow"
  if (!hasCommand && toolCall.kind && readKinds.has(toolCall.kind)) return "allow"
  if (permission.mode === "ask-before-edits") return "ask"
  if (permission.mode === "read-only") return "deny"
  if (hasCommand || !toolCall.kind || !writeKinds.has(toolCall.kind)) return "deny"
  if (
    permission.mode === "custom"
      ? !custom?.projectWrite
      : permission.mode !== "auto-edit-project-only"
  )
    return "deny"

  const paths = (toolCall.locations ?? []).map(({ path }) => path)
  const addedPaths = targetFields.flatMap((key) => {
    const value = input[key]
    return typeof value === "string" ? [value] : []
  })
  // A move must identify both endpoints, even if the provider repeats one path in its arguments.
  if (toolCall.kind === "move") {
    const source = input.SourcePath ?? input.OldPath
    const destination = input.DestinationPath ?? input.NewPath
    if (new Set(paths).size < 2 && (typeof source !== "string" || typeof destination !== "string"))
      return "deny"
  }
  const targets = [...new Set([...paths, ...addedPaths])]
  if (!targets.length) return "deny"
  return targets.every((path) => checkedWorkspaceTarget(cwd, path)) ? "allow" : "deny"
}
