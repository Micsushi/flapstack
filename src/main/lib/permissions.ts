import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type {
  HarnessPermissionApplication,
  HarnessPermissionLimitation,
} from "../../shared/harness-types"

const require = createRequire(import.meta.url)

export const permissionModes = [
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
] as const

export type PermissionMode = (typeof permissionModes)[number]

export type ClaudeSdkPermissionMode =
  "default" | "acceptEdits" | "bypassPermissions" | "plan" | "delegate" | "dontAsk"

export type ClaudeSdkPermissionApplication = {
  sdkPermissionMode: ClaudeSdkPermissionMode
  allowDangerouslySkipPermissions: boolean
}

export type CustomPermissionToggles = {
  fileWrite: boolean
  shell: boolean
  network: boolean
  git: boolean
  browser: boolean
  mcp: boolean
  secrets: boolean
}

export const customPermissionKeys = [
  "fileWrite",
  "shell",
  "network",
  "git",
  "browser",
  "mcp",
  "secrets",
] as const satisfies readonly (keyof CustomPermissionToggles)[]

export function parseCustomPermissionToggles(value: unknown): CustomPermissionToggles | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== customPermissionKeys.length) return null
  if (!customPermissionKeys.every((key) => typeof record[key] === "boolean")) return null
  return Object.fromEntries(
    customPermissionKeys.map((key) => [key, record[key]]),
  ) as CustomPermissionToggles
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

type PermissionConfig = {
  globalDefault?: PermissionMode
}

export const defaultPermissionMode: PermissionMode = "ask-before-edits"

const permissionModeSet = new Set<string>(permissionModes)
const configFileName = "permissions.json"

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && permissionModeSet.has(value)
}

export function parsePermissionMode(value: unknown): PermissionMode | null {
  return isPermissionMode(value) ? value : null
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

export function setGlobalDefault(mode: PermissionMode): PermissionMode {
  const parsedMode = parsePermissionMode(mode)

  if (!parsedMode) {
    throw new Error(`Invalid permission mode: ${String(mode)}`)
  }

  writePermissionConfig({ ...readPermissionConfig(), globalDefault: parsedMode })
  return parsedMode
}

export function buildCodexPermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
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
  ]

  const limitations = getCodexPermissionLimitations(params.permissionMode)
  const warnings = [
    "Codex ACP launch currently exposes cwd and MCP server configuration, not Codex sandbox or approval-policy knobs.",
    ...limitations.map((limitation) => limitation.reason),
  ]

  return {
    requested: params.permissionMode,
    applied: false,
    degraded: true,
    enforced,
    limitations,
    warnings: Array.from(new Set(warnings)),
    reason:
      "Flapstack records the requested permission mode, but this Codex ACP launch path can only apply cwd placement. Sandbox and tool-approval behavior are not app-enforced.",
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
      return { sandbox: "enabled", autoReview: true, force: false }
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
          "shell",
          "custom shell toggle",
          "Shell access cannot be individually controlled through cursor-agent flags.",
        ),
        limitation("network", "custom network toggle", "Network access cannot be controlled here."),
        limitation("git", "custom git toggle", "Git access cannot be controlled here."),
        limitation("browser", "custom browser toggle", "Browser access cannot be controlled here."),
        limitation(
          "mcp",
          "custom MCP toggle",
          "MCP servers are managed via `cursor-agent mcp`, not custom mode.",
        ),
        limitation("secrets", "custom secrets toggle", "Secret access cannot be controlled here."),
      ]
  }
}

export function mapClaudeSdkPermissionMode(
  appPermissionMode: PermissionMode,
  chatMode: "plan" | "agent",
): ClaudeSdkPermissionApplication {
  if (chatMode === "plan") {
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

export function buildClaudePermissionApplication(params: {
  permissionMode: PermissionMode
  cwd?: string | null
  sdkPermissionMode: ClaudeSdkPermissionMode
  canUseToolReadOnlyGuard: boolean
}): HarnessPermissionApplication {
  const cwd = params.cwd?.trim() || null
  const limitations = getClaudePermissionLimitations(params.permissionMode)
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
      applied: params.canUseToolReadOnlyGuard,
      reason: params.canUseToolReadOnlyGuard
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
    applied: params.permissionMode === "read-only" || params.permissionMode === "full-access",
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

function getCodexPermissionLimitations(mode: PermissionMode): HarnessPermissionLimitation[] {
  switch (mode) {
    case "read-only":
      return [
        limitation(
          "codex-sandbox",
          "read-only filesystem sandbox",
          "Read-only mode cannot be enforced because Codex ACP does not accept a read-only sandbox setting here.",
        ),
        limitation(
          "codex-approval-policy",
          "deny edits and mutating tools",
          "Read-only mode cannot force-deny Codex tool calls through the current ACP provider.",
        ),
        limitation(
          "filesystem-write-scope",
          "no writes",
          "The app cannot restrict Codex writes to read-only through this launch path.",
        ),
        limitation(
          "shell",
          "no shell mutations",
          "Shell/tool mutation policy is not exposed here.",
        ),
      ]
    case "ask-before-edits":
      return [
        limitation(
          "codex-approval-policy",
          "ask before edits",
          "The current ACP provider does not expose a Flapstack-controlled ask-before-edit policy.",
        ),
        limitation(
          "filesystem-write-scope",
          "writes require approval",
          "Write approval is adapter/runtime behavior, not enforced by Flapstack in this path.",
        ),
      ]
    case "auto-edit-project-only":
      return [
        limitation(
          "codex-sandbox",
          "workspace-write sandbox",
          "Project-only editing cannot be enforced because Codex ACP does not accept a workspace-write sandbox setting here.",
        ),
        limitation(
          "filesystem-write-scope",
          "writes limited to the selected project/worktree",
          "The cwd is set, but the process is not sandboxed to that directory by Flapstack.",
        ),
      ]
    case "full-access":
      return [
        limitation(
          "codex-sandbox",
          "full-access sandbox mode",
          "Full-access/danger mode cannot be explicitly selected because Codex ACP does not expose a sandbox mode setting here.",
        ),
        limitation(
          "codex-approval-policy",
          "auto-approve tool calls",
          "Flapstack cannot force Codex ACP to bypass permission prompts in this launch path.",
        ),
      ]
    case "custom":
      return [
        limitation(
          "codex-sandbox",
          "custom sandbox toggles",
          "Custom sandbox settings are not mapped because Codex ACP does not expose sandbox controls here.",
        ),
        limitation(
          "codex-approval-policy",
          "custom approval toggles",
          "Custom approval policy is not mapped because the current ACP provider has no policy hook for it.",
        ),
        limitation("network", "custom network toggle", "Network access cannot be controlled here."),
        limitation("git", "custom git toggle", "Git access cannot be controlled here."),
        limitation("browser", "custom browser toggle", "Browser access cannot be controlled here."),
        limitation(
          "mcp",
          "custom MCP toggle",
          "MCP servers are configured separately, not by custom mode.",
        ),
        limitation("secrets", "custom secrets toggle", "Secret access cannot be controlled here."),
      ]
  }
}

function getClaudePermissionLimitations(mode: PermissionMode): HarnessPermissionLimitation[] {
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
          "custom filesystem write toggle",
          "Custom filesystem settings are not mapped to Claude Code SDK controls yet.",
        ),
        limitation("shell", "custom shell toggle", "Custom shell settings are not mapped yet."),
        limitation("network", "custom network toggle", "Network access cannot be controlled here."),
        limitation("git", "custom git toggle", "Git access cannot be controlled here."),
        limitation("browser", "custom browser toggle", "Browser access cannot be controlled here."),
        limitation("mcp", "custom MCP toggle", "MCP access cannot be controlled here."),
        limitation("secrets", "custom secrets toggle", "Secret access cannot be controlled here."),
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
    }
  } catch (error) {
    console.warn("[Permissions] Failed to read permission config:", error)
    return {}
  }
}

function writePermissionConfig(config: PermissionConfig): void {
  const configPath = getPermissionConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))
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
