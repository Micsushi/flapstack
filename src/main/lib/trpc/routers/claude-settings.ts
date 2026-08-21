import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { createHash } from "node:crypto"
import { Mutex } from "async-mutex"
import { z } from "zod"
import { router, publicProcedure } from "../index"
import { readProjectMcpJson, type McpServerConfig } from "../../claude-config"
import { writeJsonRecoveryAtomic } from "../../portability/io"

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json")

// Cache for enabled plugins to avoid repeated filesystem reads
let enabledPluginsCache: { plugins: string[]; timestamp: number } | null = null
const ENABLED_PLUGINS_CACHE_TTL_MS = 5000 // 5 seconds

// Cache for approved plugin MCP servers
let approvedMcpCache: { servers: string[]; timestamp: number } | null = null
let approvedProjectMcpCache: { configs: string[]; timestamp: number } | null = null
const APPROVED_MCP_CACHE_TTL_MS = 5000 // 5 seconds
const settingsMutex = new Mutex()

/**
 * Invalidate the enabled plugins cache
 * Call this when enabledPlugins setting changes
 */
export function invalidateEnabledPluginsCache(): void {
  enabledPluginsCache = null
}

/**
 * Invalidate the approved MCP servers cache
 * Call this when approvedPluginMcpServers setting changes
 */
export function invalidateApprovedMcpCache(): void {
  approvedMcpCache = null
  approvedProjectMcpCache = null
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function getProjectMcpConfigApprovalId(
  projectPath: string,
  servers: Record<string, McpServerConfig>,
): string {
  return createHash("sha256")
    .update(`${path.resolve(projectPath)}\0${canonicalJson(servers)}`)
    .digest("hex")
}

export function isProjectMcpConfigApproved(
  projectPath: string,
  servers: Record<string, McpServerConfig>,
  approvedIds: ReadonlySet<string>,
): boolean {
  return (
    Object.keys(servers).length === 0 ||
    approvedIds.has(getProjectMcpConfigApprovalId(projectPath, servers))
  )
}

export async function getApprovedProjectMcpConfigs(): Promise<string[]> {
  if (
    approvedProjectMcpCache &&
    Date.now() - approvedProjectMcpCache.timestamp < APPROVED_MCP_CACHE_TTL_MS
  ) {
    return approvedProjectMcpCache.configs
  }
  const settings = await readClaudeSettings()
  const configs = Array.isArray(settings.approvedProjectMcpConfigs)
    ? (settings.approvedProjectMcpConfigs as string[]).filter((value) =>
        /^[a-f0-9]{64}$/.test(value),
      )
    : []
  approvedProjectMcpCache = { configs, timestamp: Date.now() }
  return configs
}

/**
 * Read Claude settings.json file
 * Returns empty object if file doesn't exist
 */
async function readClaudeSettings(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    // File doesn't exist or is invalid JSON
    return {}
  }
}

/**
 * Get list of enabled plugin identifiers from settings.json
 * Plugins are DISABLED by default - only plugins explicitly in this list are active.
 * Returns empty array if no plugins have been enabled.
 * Results are cached for 5 seconds to reduce filesystem reads.
 */
export async function getEnabledPlugins(): Promise<string[]> {
  // Return cached result if still valid
  if (
    enabledPluginsCache &&
    Date.now() - enabledPluginsCache.timestamp < ENABLED_PLUGINS_CACHE_TTL_MS
  ) {
    return enabledPluginsCache.plugins
  }

  const settings = await readClaudeSettings()
  const plugins = Array.isArray(settings.enabledPlugins)
    ? (settings.enabledPlugins as string[])
    : []

  enabledPluginsCache = { plugins, timestamp: Date.now() }
  return plugins
}

/**
 * Get list of approved plugin MCP server identifiers from settings.json
 * Format: "{pluginSource}:{serverName}" e.g., "ccsetup:ccsetup:context7"
 * Returns empty array if no approved servers
 * Results are cached for 5 seconds to reduce filesystem reads
 */
export async function getApprovedPluginMcpServers(): Promise<string[]> {
  // Return cached result if still valid
  if (approvedMcpCache && Date.now() - approvedMcpCache.timestamp < APPROVED_MCP_CACHE_TTL_MS) {
    return approvedMcpCache.servers
  }

  const settings = await readClaudeSettings()
  const servers = Array.isArray(settings.approvedPluginMcpServers)
    ? (settings.approvedPluginMcpServers as string[])
    : []

  approvedMcpCache = { servers, timestamp: Date.now() }
  return servers
}

/**
 * Check if a plugin MCP server is approved
 */
export async function isPluginMcpApproved(
  pluginSource: string,
  serverName: string,
): Promise<boolean> {
  const approved = await getApprovedPluginMcpServers()
  const identifier = `${pluginSource}:${serverName}`
  return approved.includes(identifier)
}

/**
 * Write Claude settings.json file
 * Creates the .claude directory if it doesn't exist
 */
async function writeClaudeSettings(settings: Record<string, unknown>): Promise<void> {
  await writeJsonRecoveryAtomic(CLAUDE_SETTINGS_PATH, settings)
}

async function updateClaudeSettings(
  updater: (settings: Record<string, unknown>) => void,
): Promise<void> {
  await settingsMutex.runExclusive(async () => {
    const settings = await readClaudeSettings()
    updater(settings)
    await writeClaudeSettings(settings)
  })
}

export const claudeSettingsRouter = router({
  getApprovedProjectMcpConfigs: publicProcedure.query(getApprovedProjectMcpConfigs),

  approveProjectMcpConfig: publicProcedure
    .input(z.object({ projectPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const servers = await readProjectMcpJson(input.projectPath)
      if (Object.keys(servers).length === 0) throw new Error("Project .mcp.json is empty")
      const approvalId = getProjectMcpConfigApprovalId(input.projectPath, servers)
      await updateClaudeSettings((settings) => {
        const approved = Array.isArray(settings.approvedProjectMcpConfigs)
          ? (settings.approvedProjectMcpConfigs as string[])
          : []
        settings.approvedProjectMcpConfigs = [...new Set([...approved, approvalId])]
      })
      invalidateApprovedMcpCache()
      return { success: true, approvalId }
    }),

  /**
   * Get the includeCoAuthoredBy setting
   * Returns true only when setting is explicitly enabled.
   */
  getIncludeCoAuthoredBy: publicProcedure.query(async () => {
    const settings = await readClaudeSettings()
    // Default is false. Users can opt in explicitly.
    return settings.includeCoAuthoredBy === true
  }),

  /**
   * Set the includeCoAuthoredBy setting
   */
  setIncludeCoAuthoredBy: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()

      if (input.enabled) {
        // Explicitly enable because the app default is false.
        settings.includeCoAuthoredBy = true
      } else {
        // Keep the setting explicit so downstream Claude tooling also sees it.
        settings.includeCoAuthoredBy = false
      }

      await writeClaudeSettings(settings)
      return { success: true }
    }),

  /**
   * Get list of enabled plugins
   * Plugins are disabled by default - only explicitly enabled ones are active.
   */
  getEnabledPlugins: publicProcedure.query(async () => {
    return await getEnabledPlugins()
  }),

  /**
   * Set a plugin's enabled state
   * Plugins are disabled by default - adding to enabledPlugins activates them.
   */
  setPluginEnabled: publicProcedure
    .input(
      z.object({
        pluginSource: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const enabledPlugins = Array.isArray(settings.enabledPlugins)
        ? (settings.enabledPlugins as string[])
        : []

      if (input.enabled && !enabledPlugins.includes(input.pluginSource)) {
        enabledPlugins.push(input.pluginSource)
      } else if (!input.enabled) {
        const index = enabledPlugins.indexOf(input.pluginSource)
        if (index > -1) enabledPlugins.splice(index, 1)
      }

      settings.enabledPlugins = enabledPlugins
      await writeClaudeSettings(settings)
      invalidateEnabledPluginsCache()
      return { success: true }
    }),

  /**
   * Get list of approved plugin MCP servers
   */
  getApprovedPluginMcpServers: publicProcedure.query(async () => {
    return await getApprovedPluginMcpServers()
  }),

  /**
   * Approve a plugin MCP server
   * Identifier format: "{pluginSource}:{serverName}"
   */
  approvePluginMcpServer: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      if (!approved.includes(input.identifier)) {
        approved.push(input.identifier)
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Revoke approval for a plugin MCP server
   * Identifier format: "{pluginSource}:{serverName}"
   */
  revokePluginMcpServer: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      const index = approved.indexOf(input.identifier)
      if (index > -1) {
        approved.splice(index, 1)
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Approve all MCP servers from a plugin
   * Takes the pluginSource (e.g., "ccsetup:ccsetup") and list of server names
   */
  approveAllPluginMcpServers: publicProcedure
    .input(
      z.object({
        pluginSource: z.string(),
        serverNames: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      for (const serverName of input.serverNames) {
        const identifier = `${input.pluginSource}:${serverName}`
        if (!approved.includes(identifier)) {
          approved.push(identifier)
        }
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Revoke all MCP servers from a plugin
   * Removes all identifiers matching "{pluginSource}:*"
   */
  revokeAllPluginMcpServers: publicProcedure
    .input(
      z.object({
        pluginSource: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      const prefix = `${input.pluginSource}:`
      settings.approvedPluginMcpServers = approved.filter((id) => !id.startsWith(prefix))
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),
})
