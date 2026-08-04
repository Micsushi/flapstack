import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type {
  HarnessPermissionApplication,
  HarnessPermissionLimitation,
} from "../../shared/harness-types"
import {
  CUSTOM_PERMISSION_SCHEMA_VERSION,
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
  parseCustomPermissionCapabilities,
  type CustomPermissionCapabilities,
} from "../../shared/permission-capabilities"
import { nowEpochSeconds } from "./db/timestamps"
import { toProviderChatMode, type ChatMode } from "../../shared/chat-mode"
import { isWithinProjectBoundary } from "./permission-boundary"

const require = createRequire(import.meta.url)

export const permissionModes = [
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
] as const

export type PermissionMode = (typeof permissionModes)[number]

export const permissionChangeBehaviors = ["ask", "all-chats", "current-chat"] as const
export type PermissionChangeBehavior = (typeof permissionChangeBehaviors)[number]

export type PermissionPreferences = {
  globalDefault: PermissionMode
  changeBehavior: PermissionChangeBehavior
  globalCustomPermissions?: CustomPermissionCapabilities | null
}

export type ClaudeSdkPermissionMode =
  "default" | "acceptEdits" | "bypassPermissions" | "plan" | "delegate" | "dontAsk"

export type ClaudeSdkPermissionApplication = {
  sdkPermissionMode: ClaudeSdkPermissionMode
  allowDangerouslySkipPermissions: boolean
}

export type CustomPermissionToggles = CustomPermissionCapabilities
export const customPermissionKeys = customPermissionCapabilityKeys
export { CUSTOM_PERMISSION_SCHEMA_VERSION, disabledCustomPermissions }

export function parseCustomPermissionToggles(value: unknown): CustomPermissionToggles | null {
  return parseCustomPermissionCapabilities(value)
}

export type PermissionSource = "chat" | "task" | "project" | "global" | "fallback"

export type PermissionResolutionInput = {
  chatMode?: PermissionMode | null
  taskMode?: PermissionMode | null
  projectMode?: PermissionMode | null
  globalMode?: PermissionMode | null
}

export type PermissionResolution = {
  mode: PermissionMode
  source: PermissionSource
}

export type CodexAcpModeId = "read-only" | "agent" | "agent-full-access"

type PermissionConfig = {
  globalDefault?: PermissionMode
  changeBehavior?: PermissionChangeBehavior
  globalCustomPermissions?: CustomPermissionCapabilities | null
  pendingAllChatsSync?: boolean
}

export const defaultPermissionMode: PermissionMode = "ask-before-edits"

const permissionModeSet = new Set<string>(permissionModes)
const permissionChangeBehaviorSet = new Set<string>(permissionChangeBehaviors)
const configFileName = "permissions.json"

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && permissionModeSet.has(value)
}

export function parsePermissionMode(value: unknown): PermissionMode | null {
  return isPermissionMode(value) ? value : null
}

export function parsePermissionChangeBehavior(value: unknown): PermissionChangeBehavior | null {
  return typeof value === "string" && permissionChangeBehaviorSet.has(value)
    ? (value as PermissionChangeBehavior)
    : null
}

export function copyOnCreate(
  parentMode: PermissionMode | null | undefined,
  fallbackMode: PermissionMode = defaultPermissionMode,
): PermissionMode {
  return parentMode ?? fallbackMode
}

export function resolvePermission(input: PermissionResolutionInput): PermissionResolution {
  const chatMode = parsePermissionMode(input.chatMode)
  if (chatMode) return { mode: chatMode, source: "chat" }

  const taskMode = parsePermissionMode(input.taskMode)
  if (taskMode) return { mode: taskMode, source: "task" }

  const projectMode = parsePermissionMode(input.projectMode)
  if (projectMode) return { mode: projectMode, source: "project" }

  const globalMode = parsePermissionMode(input.globalMode)
  if (globalMode) return { mode: globalMode, source: "global" }

  return { mode: defaultPermissionMode, source: "fallback" }
}

export function resolveForRun(input: PermissionResolutionInput): PermissionResolution {
  return resolvePermission(input)
}

export function getGlobalDefault(): PermissionMode {
  return readPermissionConfig().globalDefault ?? defaultPermissionMode
}

export function getPermissionChangeBehavior(): PermissionChangeBehavior {
  return readPermissionConfig().changeBehavior ?? "ask"
}

export function getPermissionPreferences(): PermissionPreferences {
  const config = readPermissionConfig()
  const preferences: PermissionPreferences = {
    globalDefault: config.globalDefault ?? defaultPermissionMode,
    changeBehavior: config.changeBehavior ?? "ask",
  }
  if (preferences.globalDefault === "custom") {
    preferences.globalCustomPermissions = config.globalCustomPermissions ?? null
  }
  return preferences
}

export function setGlobalDefault(mode: PermissionMode): PermissionMode {
  const parsedMode = parsePermissionMode(mode)

  if (!parsedMode) {
    throw new Error(`Invalid permission mode: ${String(mode)}`)
  }
  if (parsedMode === "custom") {
    throw new Error("Custom global defaults require explicit capability toggles.")
  }

  writePermissionConfig({
    ...readPermissionConfig(),
    globalDefault: parsedMode,
    globalCustomPermissions: null,
  })
  return parsedMode
}

export function setPermissionChangeBehavior(
  behavior: PermissionChangeBehavior,
): PermissionChangeBehavior {
  const parsedBehavior = parsePermissionChangeBehavior(behavior)

  if (!parsedBehavior) {
    throw new Error(`Invalid permission change behavior: ${String(behavior)}`)
  }

  writePermissionConfig({ ...readPermissionConfig(), changeBehavior: parsedBehavior })
  return parsedBehavior
}

export function replacePermissionPreferences(preferences: PermissionPreferences): void {
  writePermissionConfig(normalizePermissionPreferences(preferences))
}

export function stageAllChatPermissionPreferences(preferences: PermissionPreferences): void {
  writePermissionConfig({
    ...normalizePermissionPreferences(preferences),
    pendingAllChatsSync: true,
  })
}

function normalizePermissionPreferences(preferences: PermissionPreferences): PermissionConfig {
  const globalDefault = parsePermissionMode(preferences.globalDefault)
  const changeBehavior = parsePermissionChangeBehavior(preferences.changeBehavior)

  if (!globalDefault || !changeBehavior) {
    throw new Error("Invalid permission preferences")
  }

  const globalCustomPermissions =
    globalDefault === "custom"
      ? parseCustomPermissionToggles(preferences.globalCustomPermissions)
      : null
  if (globalDefault === "custom" && !globalCustomPermissions) {
    throw new Error("Custom global permission requires a complete versioned capability set")
  }

  return { globalDefault, changeBehavior, globalCustomPermissions }
}

type PermissionRecoveryDatabase = {
  transaction<T>(operation: () => T): () => T
  prepare(sql: string): { run(...params: unknown[]): unknown }
}

/** Complete an interrupted all-chat promotion before the app creates new rows. */
export function recoverPendingAllChatPermissionChange(sqlite: PermissionRecoveryDatabase): boolean {
  const config = readPermissionConfig()
  if (!config.pendingAllChatsSync) return false
  const preferences = normalizePermissionPreferences({
    globalDefault: config.globalDefault ?? defaultPermissionMode,
    changeBehavior: config.changeBehavior ?? "ask",
    globalCustomPermissions: config.globalCustomPermissions ?? null,
  })
  const customPermissions =
    preferences.globalDefault === "custom"
      ? JSON.stringify(preferences.globalCustomPermissions)
      : null
  const now = nowEpochSeconds()
  sqlite.transaction(() => {
    sqlite
      .prepare(
        "UPDATE projects SET default_permission_mode = ?, default_custom_permissions = ?, updated_at = ?",
      )
      .run(preferences.globalDefault, customPermissions, now)
    sqlite
      .prepare(
        "UPDATE tasks SET default_permission_mode = ?, default_custom_permissions = ?, updated_at = ?",
      )
      .run(preferences.globalDefault, customPermissions, now)
    sqlite
      .prepare("UPDATE chats SET permission_mode = ?, custom_permissions = ?, updated_at = ?")
      .run(preferences.globalDefault, customPermissions, now)
    sqlite
      .prepare("UPDATE sub_chats SET permission_mode = ?, updated_at = ?")
      .run(preferences.globalDefault, now)
  })()
  writePermissionConfig(preferences)
  return true
}

export function buildCodexPermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
  customPermissions?: CustomPermissionToggles | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const modeId = mapCodexAcpModeId(params.permissionMode)
  const approvalBehavior =
    params.permissionMode === "read-only"
      ? "reject"
      : params.permissionMode === "full-access"
        ? "allow-once"
        : "flapstack-bridge"
  const enforced = [
    {
      control: "process-cwd" as const,
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The Codex ACP adapter process is spawned with this cwd."
        : "No cwd was provided for this launch.",
    },
    {
      control: "acp-session-cwd" as const,
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The ACP new/load session request includes this cwd."
        : "No cwd was provided for this launch.",
    },
    {
      control: "codex-sandbox" as const,
      applied: true,
      value: modeId,
      reason: `Codex ACP session mode is set to "${modeId}".`,
    },
    {
      control: "codex-approval-policy" as const,
      applied: true,
      value: approvalBehavior,
      reason:
        approvalBehavior === "reject"
          ? "Flapstack rejects every Codex escalation request in read-only mode."
          : approvalBehavior === "allow-once"
            ? "Flapstack explicitly allows unexpected Codex escalation requests once in full-access mode."
            : "Codex permission requests are routed through the fail-closed Flapstack approval bridge.",
    },
  ]

  const limitations = getCodexPermissionLimitations(params.permissionMode, params.customPermissions)
  const warnings = [
    `Codex ACP mode "${modeId}" is selected.`,
    ...limitations.map((limitation) => limitation.reason),
  ]

  return {
    requested: params.permissionMode,
    applied: limitations.length === 0,
    degraded: limitations.length > 0,
    enforced,
    limitations,
    warnings: Array.from(new Set(warnings)),
    reason:
      limitations.length > 0
        ? "Flapstack selects the closest conservative Codex ACP mode and approval behavior, but does not claim native parity for every custom capability."
        : "Flapstack selects the Codex ACP mode and fail-closed approval behavior for this permission mode.",
  }
}

export function mapCodexAcpModeId(mode: PermissionMode): CodexAcpModeId {
  switch (mode) {
    case "auto-edit-project-only":
      return "agent"
    case "full-access":
      return "agent-full-access"
    case "read-only":
    case "ask-before-edits":
    case "custom":
    default:
      return "read-only"
  }
}

/**
 * Cursor (`cursor-agent`) permission flags, resolved from a Flapstack mode.
 * Verified CLI surface (Stage 2 D0):
 *   --mode plan | ask   (read-only / planning / Q&A)
 *   --sandbox enabled | disabled
 *   --auto-review       (approve safe edits, prompt on the rest)
 *   -f / --force / --yolo (auto-approve everything)
 * Cursor maps more cleanly than Codex, but the app still records honest
 * limitations for controls the CLI does not enforce (network, git, secrets...).
 */
export type CursorPermissionFlags = {
  mode?: "plan" | "ask"
  sandbox?: "enabled" | "disabled"
  autoReview: boolean
  force: boolean
}

export function mapCursorPermissionFlags(mode: PermissionMode): CursorPermissionFlags {
  switch (mode) {
    case "read-only":
      return { mode: "plan", sandbox: "enabled", autoReview: false, force: false }
    case "ask-before-edits":
      return { sandbox: "enabled", autoReview: true, force: false }
    case "auto-edit-project-only":
      // No Cursor flag scopes writes to the project dir; cwd placement + sandbox
      // is the closest honest approximation. Limitation recorded below.
      return { sandbox: "enabled", autoReview: true, force: false }
    case "full-access":
      return { sandbox: "disabled", autoReview: false, force: true }
    case "custom":
    default:
      return { mode: "plan", sandbox: "enabled", autoReview: false, force: false }
  }
}

export function buildCursorPermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const flags = mapCursorPermissionFlags(params.permissionMode)

  const enforced: HarnessPermissionApplication["enforced"] = [
    {
      control: "process-cwd" as const,
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The cursor-agent child process is spawned with this cwd / --workspace."
        : "No cwd was provided for this launch.",
    },
    {
      control: "cursor-mode" as const,
      applied: Boolean(flags.mode),
      ...(flags.mode ? { value: flags.mode } : {}),
      reason: flags.mode
        ? `cursor-agent is launched with --mode ${flags.mode}.`
        : "No read-only/plan mode flag is set for this permission mode.",
    },
    {
      control: "cursor-sandbox" as const,
      applied: Boolean(flags.sandbox),
      ...(flags.sandbox ? { value: flags.sandbox } : {}),
      reason: flags.sandbox
        ? `cursor-agent is launched with --sandbox ${flags.sandbox}.`
        : "No sandbox flag is set for this permission mode.",
    },
    {
      control: "cursor-approval" as const,
      applied: flags.autoReview || flags.force,
      value: flags.force ? "force" : flags.autoReview ? "auto-review" : "prompt",
      reason: flags.force
        ? "cursor-agent runs with --force (auto-approve all tool calls)."
        : flags.autoReview
          ? "cursor-agent runs with --auto-review (approve safe edits, prompt on the rest)."
          : "Approval is left to cursor-agent defaults for this mode.",
    },
  ]

  const limitations = getCursorPermissionLimitations(params.permissionMode)
  const warnings = [
    `cursor-agent permission flags applied: ${describeCursorFlags(flags)}.`,
    ...limitations.map((limitation) => limitation.reason),
  ]

  const applied = params.permissionMode === "read-only" || params.permissionMode === "full-access"

  return {
    requested: params.permissionMode,
    applied,
    degraded: limitations.length > 0,
    enforced,
    limitations,
    warnings: Array.from(new Set(warnings)),
    reason:
      limitations.length > 0
        ? "Flapstack records the requested permission mode and applies the cursor-agent mode/sandbox/approval flags it exposes, but some controls (network, git, secrets, project-only write scope) are not enforceable through the CLI."
        : "Flapstack applies the available cursor-agent mode/sandbox/approval flags for this permission mode.",
  }
}

function describeCursorFlags(flags: CursorPermissionFlags): string {
  const parts: string[] = []
  if (flags.mode) parts.push(`--mode ${flags.mode}`)
  if (flags.sandbox) parts.push(`--sandbox ${flags.sandbox}`)
  if (flags.autoReview) parts.push("--auto-review")
  if (flags.force) parts.push("--force")
  return parts.length > 0 ? parts.join(" ") : "(defaults)"
}

function getCursorPermissionLimitations(mode: PermissionMode): HarnessPermissionLimitation[] {
  switch (mode) {
    case "read-only":
      return [
        limitation(
          "cursor-approval",
          "deny all mutating tools",
          "Plan mode strongly discourages edits, but Flapstack cannot prove cursor-agent will refuse every mutating tool for every model/version.",
        ),
      ]
    case "ask-before-edits":
      return [
        limitation(
          "filesystem-write-scope",
          "ask before edits",
          "Ask-before-edits maps to cursor-agent --auto-review; the approval prompt is cursor-agent's, not a Flapstack-owned edit gate.",
        ),
      ]
    case "auto-edit-project-only":
      return [
        limitation(
          "filesystem-write-scope",
          "writes limited to the selected project/worktree",
          "cwd/--workspace is set, but cursor-agent is not sandboxed to that directory by Flapstack.",
        ),
      ]
    case "full-access":
      return []
    case "custom":
      return [
        limitation(
          "filesystem-write-scope",
          "enabled custom capabilities",
          "Cursor has no per-capability callback, so custom mode fails closed to sandboxed plan mode instead of honoring enabled mutations.",
        ),
      ]
  }
}

export function mapClaudeSdkPermissionMode(
  appPermissionMode: PermissionMode,
  chatMode: ChatMode,
): ClaudeSdkPermissionApplication {
  if (toProviderChatMode(chatMode) === "plan") {
    return { sdkPermissionMode: "plan", allowDangerouslySkipPermissions: false }
  }

  switch (appPermissionMode) {
    case "full-access":
      return { sdkPermissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true }
    case "auto-edit-project-only":
      return { sdkPermissionMode: "acceptEdits", allowDangerouslySkipPermissions: false }
    case "read-only":
      return { sdkPermissionMode: "dontAsk", allowDangerouslySkipPermissions: false }
    case "ask-before-edits":
    case "custom":
    default:
      return { sdkPermissionMode: "default", allowDangerouslySkipPermissions: false }
  }
}

export function buildLocalModelPermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
  customPermissions?: CustomPermissionToggles | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const custom = params.customPermissions
  const customMissing = params.permissionMode === "custom" && !custom
  const policy = (capability: "projectWrite" | "shell" | "git" | "network") => {
    switch (params.permissionMode) {
      case "read-only":
        return "deny"
      case "ask-before-edits":
        return "ask"
      case "auto-edit-project-only":
        return capability === "projectWrite" ? "project-only" : "deny"
      case "full-access":
        return "allow"
      case "custom":
        return custom?.[capability] ? "allow" : "deny"
    }
  }
  const limitations: HarnessPermissionLimitation[] = customMissing
    ? [
        {
          control: "filesystem-write-scope",
          requested: "custom",
          reason:
            "The stored custom permission snapshot is missing or invalid; all local mutation tiers fail closed.",
        },
      ]
    : []
  const enforced: HarnessPermissionApplication["enforced"] = [
    {
      control: "process-cwd",
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The local tool loop is rooted at this registered worktree."
        : "No registered worktree was provided for this launch.",
    },
    {
      control: "filesystem-write-scope",
      applied: true,
      value: policy("projectWrite"),
      reason:
        "The Flapstack local tool loop revalidates project writes and fails closed outside the registered root.",
    },
    ...(["shell", "git", "network"] as const).map((control) => ({
      control,
      applied: true,
      value: policy(control),
      reason: `The Flapstack local tool loop applies the ${control} policy before execution.`,
    })),
  ]

  return {
    requested: params.permissionMode,
    applied: !customMissing,
    degraded: customMissing,
    enforced,
    limitations,
    warnings: limitations.map((limitation) => limitation.reason),
    reason: customMissing
      ? "Local custom permissions fail closed because no valid stored snapshot is available."
      : "Flapstack applies local tool-tier policies before exposing any tool to Ollama.",
  }
}

export function buildClaudePermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
  sdkPermissionMode: ClaudeSdkPermissionMode
  canUseToolReadOnlyGuard: boolean
  customPermissions?: CustomPermissionToggles | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const limitations = getClaudePermissionLimitations(
    params.permissionMode,
    params.customPermissions,
  )
  const enforced = [
    {
      control: "process-cwd" as const,
      applied: Boolean(cwd),
      ...(cwd ? { value: cwd } : {}),
      reason: cwd
        ? "The Claude Code SDK query is launched with this cwd."
        : "No cwd was provided for this launch.",
    },
    {
      control: "filesystem-write-scope" as const,
      applied: params.canUseToolReadOnlyGuard || Boolean(params.customPermissions),
      reason: params.customPermissions
        ? "Flapstack maps every tool request through the stored custom capability set."
        : params.canUseToolReadOnlyGuard
          ? "Flapstack denies known mutating Claude tools before they execute."
          : "Write scope is delegated to Claude Code SDK permission behavior.",
    },
  ]
  const warnings = [
    `Claude Code SDK permissionMode is set to "${params.sdkPermissionMode}".`,
    ...limitations.map((limitation) => limitation.reason),
  ]

  return {
    requested: params.permissionMode,
    applied:
      params.permissionMode === "read-only" ||
      params.permissionMode === "full-access" ||
      (params.permissionMode === "custom" && Boolean(params.customPermissions)),
    degraded: limitations.length > 0,
    enforced,
    limitations,
    warnings: Array.from(new Set(warnings)),
    reason:
      limitations.length > 0
        ? "Flapstack records the requested permission mode and applies available Claude SDK/tool gates, but some controls are delegated to Claude Code or are not implemented in-app yet."
        : "Flapstack applies the available Claude SDK/tool gates for this permission mode.",
  }
}

export function isClaudeMutatingTool(toolName: string): boolean {
  if (CLAUDE_MUTATING_TOOLS.has(toolName)) return true
  if (!toolName.startsWith("mcp__")) return false

  const normalized = toolName.toLowerCase()
  return CLAUDE_MUTATING_MCP_PATTERNS.some((pattern) => normalized.includes(pattern))
}

export function isClaudeReadOnlyToolAllowed(toolName: string): boolean {
  return CLAUDE_READ_ONLY_TOOLS.has(toolName)
}

export function customCapabilityForToolName(
  toolName: string,
): Exclude<keyof CustomPermissionToggles, "schemaVersion"> | "unknown" | null {
  const normalized = toolName.toLowerCase()
  if (normalized.startsWith("mcp__")) return "thirdPartyMcp"
  if (/^(edit|multiedit|write|notebookedit|apply_patch)$/.test(normalized)) {
    return "projectWrite"
  }
  if (/^(bash|shell|execute|exec|run)$/.test(normalized)) return "shell"
  if (/git/.test(normalized)) return "git"
  if (/^(webfetch|websearch)$/.test(normalized) || /network|http|fetch/.test(normalized)) {
    return "network"
  }
  if (/browser|playwright|chrome/.test(normalized)) return "browser"
  if (/^(task|agent|subagent)$/.test(normalized)) return "subagents"
  if (/secret|credential|keychain|password|token|environment|env/.test(normalized)) return "secrets"
  if ([...CLAUDE_READ_ONLY_TOOLS].some((name) => name.toLowerCase() === normalized)) return null
  return "unknown"
}

export function isCustomToolAllowed(
  permissions: CustomPermissionToggles | null | undefined,
  toolName: string,
): boolean {
  if (!permissions) return false
  const capability = customCapabilityForToolName(toolName)
  if (capability === "unknown") return false
  return capability === null || permissions[capability]
}

export type ClaudeRuntimeToolDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }

/** Returns null when Claude must ask through Flapstack's permission bridge. */
export async function resolveClaudeRuntimeToolPermission(input: {
  mode: PermissionMode
  customPermissions?: CustomPermissionToggles | null
  cwd: string
  toolName: string
  toolInput: Record<string, unknown>
}): Promise<ClaudeRuntimeToolDecision | null> {
  const allow = { behavior: "allow" as const, updatedInput: input.toolInput }
  if (input.mode === "full-access") return allow
  if (input.mode === "read-only") {
    return isClaudeReadOnlyToolAllowed(input.toolName)
      ? allow
      : {
          behavior: "deny",
          message: `Tool "${input.toolName}" blocked by read-only permission mode.`,
        }
  }

  const capability = customCapabilityForToolName(input.toolName)
  if (input.mode === "custom") {
    if (!isCustomToolAllowed(input.customPermissions, input.toolName)) {
      return {
        behavior: "deny",
        message: `Tool "${input.toolName}" is disabled by custom permissions.`,
      }
    }
    if (capability !== "projectWrite") return allow
  } else if (input.mode === "auto-edit-project-only") {
    if (isClaudeReadOnlyToolAllowed(input.toolName)) return allow
    if (capability !== "projectWrite") return null
  } else if (input.mode === "ask-before-edits") {
    return isClaudeReadOnlyToolAllowed(input.toolName) ? allow : null
  }

  const requestedPath = claudeWritePath(input.toolInput)
  if (!requestedPath || !(await isWithinProjectBoundary(input.cwd, requestedPath))) {
    return {
      behavior: "deny",
      message: "Project edits cannot leave the selected worktree boundary.",
    }
  }
  return allow
}

export async function resolveClaudeRuntimeToolPermissionWithoutBridge(
  input: Parameters<typeof resolveClaudeRuntimeToolPermission>[0],
): Promise<ClaudeRuntimeToolDecision> {
  return (
    (await resolveClaudeRuntimeToolPermission(input)) ?? {
      behavior: "deny",
      message: "Tool requires approval, but this Claude path has no Flapstack approval bridge.",
    }
  )
}

function claudeWritePath(toolInput: Record<string, unknown>): string {
  for (const key of ["file_path", "notebook_path", "path"] as const) {
    const value = toolInput[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function getCodexPermissionLimitations(
  mode: PermissionMode,
  customPermissions?: CustomPermissionToggles | null,
): HarnessPermissionLimitation[] {
  switch (mode) {
    case "read-only":
      return []
    case "ask-before-edits":
      return []
    case "auto-edit-project-only":
      return []
    case "full-access":
      return []
    case "custom":
      return [
        limitation(
          customPermissions ? "codex-sandbox" : "codex-approval-policy",
          "versioned custom capabilities",
          customPermissions
            ? "Disabled capabilities fail closed through Flapstack, but Codex custom mode keeps a read-only ACP sandbox floor and does not claim enabled-mutation parity."
            : "Missing or invalid custom capability state fails closed to read-only.",
        ),
      ]
  }
}

function getClaudePermissionLimitations(
  mode: PermissionMode,
  customPermissions?: CustomPermissionToggles | null,
): HarnessPermissionLimitation[] {
  switch (mode) {
    case "read-only":
      return [
        limitation(
          "mcp",
          "deny mutating MCP tools",
          "Read-only mode uses a conservative MCP tool-name deny heuristic; server-specific side effects cannot be proven from the name alone.",
        ),
      ]
    case "ask-before-edits":
      return [
        limitation(
          "filesystem-write-scope",
          "ask before edits",
          "Ask-before-edits is delegated to Claude Code SDK behavior; Flapstack does not present its own edit approval UI yet.",
        ),
        limitation(
          "mcp",
          "ask before mutating MCP tools",
          "MCP approval is not wired to the chat permission selector yet.",
        ),
      ]
    case "auto-edit-project-only":
      return [
        limitation(
          "filesystem-write-scope",
          "writes limited to the selected project/worktree",
          "The cwd is set, but Flapstack does not sandbox Claude Code to that directory.",
        ),
        limitation(
          "mcp",
          "project-scoped MCP writes",
          "MCP writes are not scoped by Flapstack's project boundary yet.",
        ),
      ]
    case "full-access":
      return []
    case "custom":
      return [
        limitation(
          "filesystem-write-scope",
          "versioned custom capabilities",
          customPermissions
            ? "Flapstack enforces disabled tool classes and edit boundaries, but Claude tool-name classification cannot prove independent shell/git or browser/secret parity."
            : "Missing or invalid custom capability state fails closed.",
        ),
      ]
  }
}

const CLAUDE_MUTATING_TOOLS = new Set([
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
])

const CLAUDE_READ_ONLY_TOOLS = new Set([
  "AskUserQuestion",
  "Glob",
  "Grep",
  "Read",
  "Skill",
  "TaskOutput",
  "TodoRead",
  "WebSearch",
])

const CLAUDE_MUTATING_MCP_PATTERNS = [
  "write",
  "edit",
  "create",
  "update",
  "delete",
  "remove",
  "move",
  "rename",
  "copy",
  "patch",
  "apply",
  "commit",
  "push",
  "merge",
  "rebase",
  "run",
  "execute",
  "exec",
  "shell",
  "send",
  "post",
  "put",
  "mutate",
]

function limitation(
  control: HarnessPermissionLimitation["control"],
  requested: string,
  reason: string,
): HarnessPermissionLimitation {
  return { control, requested, reason }
}

function readPermissionConfig(): PermissionConfig {
  const configPath = getPermissionConfigPath()

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const data = JSON.parse(readFileSync(configPath, "utf8")) as PermissionConfig
    return {
      ...data,
      globalDefault: parsePermissionMode(data.globalDefault) ?? undefined,
      changeBehavior: parsePermissionChangeBehavior(data.changeBehavior) ?? undefined,
      globalCustomPermissions: parseCustomPermissionToggles(data.globalCustomPermissions),
      pendingAllChatsSync: data.pendingAllChatsSync === true,
    }
  } catch (error) {
    console.warn("[Permissions] Failed to read permission config:", error)
    return {}
  }
}

function writePermissionConfig(config: PermissionConfig): void {
  const configPath = getPermissionConfigPath()
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, configPath)
    chmodSync(configPath, 0o600)
  } finally {
    rmSync(tempPath, { force: true })
  }
}

function getPermissionConfigPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) {
    return join(overrideDir, configFileName)
  }

  return join(getElectronUserDataPath(), "data", configFileName)
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")

    if (userDataPath) {
      return userDataPath
    }
  } catch {
    // Unit tests can import the pure helpers outside Electron.
  }

  return join(process.cwd(), ".flapstack")
}
