import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import {
  CLAUDE_CONFIG_PATH,
  CLAUDE_DIR_CONFIG_PATH,
  CLAUDE_DIR_MCP_PATH,
  type ClaudeConfig,
  type McpServerConfig,
} from "./claude-config"
import { getCredentialService } from "./credential-service"
import { writeJsonRecoveryAtomic } from "./portability/io"

const SECRET_REF_KEY = "_flapstackCredentialRef"

type McpSecretBundle = {
  headers?: Record<string, string>
  oauth?: McpServerConfig["_oauth"]
}

function credentialId(scope: string | null, serverName: string): string {
  return `mcp.${createHash("sha256")
    .update(`${scope ?? "__global__"}\0${serverName}`)
    .digest("hex")}`
}

export function protectMcpServerSecrets(
  scope: string | null,
  serverName: string,
  config: McpServerConfig,
): McpServerConfig {
  const result = protectMcpServerSecretsWithPersistence(scope, serverName, config)
  if (result.persistence === "session") {
    throw new Error(
      "Secure credential persistence is unavailable; MCP configuration was not changed.",
    )
  }
  return result.config
}

function protectMcpServerSecretsWithPersistence(
  scope: string | null,
  serverName: string,
  config: McpServerConfig,
): { config: McpServerConfig; persistence: "encrypted" | "session" | null } {
  const headers = config.headers as Record<string, string> | undefined
  const oauth = config._oauth
  if (!headers && !oauth) return { config, persistence: null }
  const id = credentialId(scope, serverName)
  const result = getCredentialService().setOpaque(
    id,
    JSON.stringify({ headers, oauth } satisfies McpSecretBundle),
    { requirePersistence: true },
  )
  const protectedConfig: McpServerConfig = { ...config, [SECRET_REF_KEY]: id }
  delete protectedConfig.headers
  delete protectedConfig._oauth
  return { config: protectedConfig, persistence: result.persistence }
}

export function hydrateMcpServerSecrets(config: McpServerConfig): McpServerConfig {
  const ref = config[SECRET_REF_KEY]
  if (typeof ref !== "string") return config
  const raw = getCredentialService().resolveOpaque(ref)
  if (!raw) return config
  try {
    const bundle = JSON.parse(raw) as McpSecretBundle
    const headers = bundle.headers
      ? Object.fromEntries(
          Object.entries(bundle.headers).map(([name, value]) => [name, expandEnvVars(value)]),
        )
      : undefined
    return {
      ...config,
      ...(headers ? { headers } : {}),
      ...(bundle.oauth ? { _oauth: bundle.oauth } : {}),
    }
  } catch {
    return config
  }
}

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const defaultSeparator = expression.indexOf(":-")
    if (defaultSeparator >= 0) {
      const name = expression.slice(0, defaultSeparator)
      return process.env[name] || expression.slice(defaultSeparator + 2)
    }
    return process.env[expression] || ""
  })
}

export function clearMcpServerSecrets(config: McpServerConfig): McpServerConfig {
  const ref = config[SECRET_REF_KEY]
  if (typeof ref === "string") getCredentialService().removeOpaque(ref)
  const cleared = { ...config }
  delete cleared.headers
  delete cleared._oauth
  delete cleared[SECRET_REF_KEY]
  return cleared
}

export function sanitizeMcpServerConfig(config: McpServerConfig): Record<string, unknown> {
  const sanitized = { ...config } as Record<string, unknown>
  const headers = sanitized.headers
  const oauth = sanitized._oauth
  const env = sanitized.env
  delete sanitized.headers
  delete sanitized._oauth
  delete sanitized[SECRET_REF_KEY]
  if (headers || typeof config[SECRET_REF_KEY] === "string") sanitized.hasCredentials = true
  if (oauth) sanitized.hasOAuth = true
  if (env && typeof env === "object" && !Array.isArray(env)) {
    sanitized.env = Object.fromEntries(
      Object.keys(env as Record<string, unknown>).map((key) => [key, "[configured]"]),
    )
  }
  return sanitized
}

function migrateClaudeMcpSecrets(
  config: ClaudeConfig,
  sourceScope = "primary",
): { config: ClaudeConfig; migrated: number; deferred: number } {
  let migrated = 0
  let deferred = 0
  const protect = (scope: string | null, name: string, server: McpServerConfig) => {
    const sourceQualifiedScope =
      sourceScope === "primary" ? scope : `${sourceScope}\0${scope ?? "__global__"}`
    const result = protectMcpServerSecretsWithPersistence(sourceQualifiedScope, name, server)
    if (result.persistence === "encrypted") {
      migrated += 1
      return result.config
    }
    if (result.persistence === "session") deferred += 1
    return server
  }
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    config.mcpServers![name] = protect(null, name, server)
  }
  for (const [projectPath, project] of Object.entries(config.projects ?? {})) {
    for (const [name, server] of Object.entries(project.mcpServers ?? {})) {
      project.mcpServers![name] = protect(projectPath, name, server)
    }
  }
  return { config, migrated, deferred }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function migrateClaudeMcpSecretFiles(
  paths: {
    primary?: string
    directoryConfig?: string
    directoryMcp?: string
  } = {},
): Promise<{ migrated: number; deferred: number }> {
  const primaryPath = paths.primary ?? CLAUDE_CONFIG_PATH
  const directoryConfigPath = paths.directoryConfig ?? CLAUDE_DIR_CONFIG_PATH
  const directoryMcpPath = paths.directoryMcp ?? CLAUDE_DIR_MCP_PATH
  let migrated = 0
  let deferred = 0

  const migrateConfigFile = async (filePath: string, sourceScope: string) => {
    const parsed = await readJsonFile(filePath)
    if (!parsed) return
    const result = migrateClaudeMcpSecrets(parsed as ClaudeConfig, sourceScope)
    migrated += result.migrated
    deferred += result.deferred
    if (result.migrated > 0) await writeJsonRecoveryAtomic(filePath, result.config)
  }

  // Process lower-precedence sources first so a duplicate server in the primary
  // config remains the credential selected by the merged launch configuration.
  const directoryMcp = await readJsonFile(directoryMcpPath)
  if (directoryMcp) {
    const nested =
      directoryMcp.mcpServers && typeof directoryMcp.mcpServers === "object"
        ? (directoryMcp.mcpServers as Record<string, McpServerConfig>)
        : (directoryMcp as Record<string, McpServerConfig>)
    let fileMigrated = 0
    for (const [name, server] of Object.entries(nested)) {
      if (!server || typeof server !== "object" || Array.isArray(server)) continue
      const result = protectMcpServerSecretsWithPersistence("claude-dir-mcp", name, server)
      if (result.persistence === "encrypted") {
        nested[name] = result.config
        migrated += 1
        fileMigrated += 1
      } else if (result.persistence === "session") {
        deferred += 1
      }
    }
    if (fileMigrated > 0) await writeJsonRecoveryAtomic(directoryMcpPath, directoryMcp)
  }
  await migrateConfigFile(directoryConfigPath, "claude-dir-config")
  await migrateConfigFile(primaryPath, "primary")
  return { migrated, deferred }
}
