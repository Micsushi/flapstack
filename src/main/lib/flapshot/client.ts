import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { randomUUID } from "node:crypto"
import { app } from "electron"
import {
  getMergedGlobalMcpServers,
  getMergedLocalProjectMcpServers,
  readClaudeConfig,
  readClaudeDirConfig,
  readProjectMcpJson,
  type McpServerConfig,
} from "../claude-config"
import { buildSafeMcpEnvironment } from "../mcp-auth"
import {
  assertServiceResponseCorrelation,
  deriveFlapshotActions,
  authStatusResponseSchema,
  flapshotDiscoverySchema,
  FLAPSHOT_CAPABILITIES_URI,
  FLAPSHOT_SERVER_NAME,
  FLAPSHOT_TOOLS,
  parseToolStructuredContent,
  throwIfServiceFailure,
  type FlapshotAuthStatus,
  type FlapshotDiscovery,
} from "./contracts"

export interface FlapshotStdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

export interface FlapshotProtocolClient {
  listTools(): Promise<{ tools: Array<{ name: string }> }>
  readResource(input: { uri: string }): Promise<unknown>
  callTool(
    input: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<unknown>
  getServerVersion(): { name: string; version: string } | undefined
  close(): Promise<void>
}

export interface FlapshotProtocolConnection {
  client: FlapshotProtocolClient
  close(): Promise<void>
}

export type FlapshotConnectionFactory = (
  config: FlapshotStdioConfig,
  onDisconnect: (error?: Error) => void,
) => Promise<FlapshotProtocolConnection>

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value)
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return {}
  return Object.fromEntries(entries)
}

function toStdioConfig(config: McpServerConfig | undefined): FlapshotStdioConfig | null {
  if (!config || config.disabled === true || typeof config.command !== "string") return null
  if (config.url) throw new Error("Flapshot must be configured as an external stdio MCP server")
  const command = config.command.trim()
  if (!command) return null
  const cwd = typeof config.cwd === "string" && config.cwd.trim() ? config.cwd : undefined
  return {
    command,
    args: stringArray(config.args),
    env: stringRecord(config.env),
    ...(cwd ? { cwd } : {}),
  }
}

export async function resolveFlapshotMcpConfig(
  projectPath: string | null,
): Promise<FlapshotStdioConfig | null> {
  const [config, directoryConfig] = await Promise.all([readClaudeConfig(), readClaudeDirConfig()])
  const globalServers = await getMergedGlobalMcpServers(config, directoryConfig)
  if (!projectPath) return toStdioConfig(globalServers[FLAPSHOT_SERVER_NAME])

  const [projectFileServers, projectServers] = await Promise.all([
    readProjectMcpJson(projectPath),
    getMergedLocalProjectMcpServers(projectPath, config, directoryConfig),
  ])
  return toStdioConfig({
    ...globalServers[FLAPSHOT_SERVER_NAME],
    ...projectFileServers[FLAPSHOT_SERVER_NAME],
    ...projectServers[FLAPSHOT_SERVER_NAME],
  })
}

async function sdkConnectionFactory(
  config: FlapshotStdioConfig,
  onDisconnect: (error?: Error) => void,
): Promise<FlapshotProtocolConnection> {
  const client = new Client({ name: "flapstack-desktop", version: app.getVersion() })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: buildSafeMcpEnvironment(config.env),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    stderr: "pipe",
  })
  let intentionalClose = false
  transport.onerror = (error) => {
    if (!intentionalClose) onDisconnect(error)
  }
  transport.onclose = () => {
    if (!intentionalClose) onDisconnect()
  }
  await client.connect(transport, { timeout: 15_000 })
  return {
    client: {
      listTools: () => client.listTools(),
      readResource: (input) => client.readResource(input),
      callTool: (input, options) => client.callTool(input, undefined, options),
      getServerVersion: () => client.getServerVersion(),
      close: () => client.close(),
    },
    close: async () => {
      intentionalClose = true
      await client.close()
    },
  }
}

export interface FlapshotConnectionStatus {
  connected: boolean
  configured: boolean
  serverVersion: string | null
  discovery: FlapshotDiscovery | null
  auth: FlapshotAuthStatus | null
  pairingStatusSupported: boolean
  error: string | null
}

export function readMcpResourceText(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("MCP resource response is invalid")
  const contents = (value as { contents?: unknown }).contents
  if (!Array.isArray(contents)) throw new Error("MCP resource returned no contents")
  const item = contents[0]
  if (!item || typeof item !== "object" || typeof (item as { text?: unknown }).text !== "string") {
    throw new Error("MCP resource returned no text")
  }
  return (item as { text: string }).text
}

interface CachedConnection {
  signature: string
  connection: FlapshotProtocolConnection
  discovery: FlapshotDiscovery
  toolNames: ReadonlySet<string>
}

interface PendingConnection {
  signature: string
  promise: Promise<CachedConnection>
}

export class FlapshotMcpClientManager {
  private readonly connections = new Map<string, CachedConnection>()
  private readonly connecting = new Map<string, PendingConnection>()

  constructor(
    private readonly factory: FlapshotConnectionFactory = sdkConnectionFactory,
    private readonly onDisconnect: (connectionKey: string, error?: Error) => void = () => undefined,
    private readonly configResolver: (
      projectPath: string | null,
    ) => Promise<FlapshotStdioConfig | null> = resolveFlapshotMcpConfig,
  ) {}

  connectionKey(projectPath: string | null): string {
    return projectPath ?? "__global__"
  }

  async status(projectPath: string | null): Promise<FlapshotConnectionStatus> {
    if (process.platform !== "darwin") {
      return {
        connected: false,
        configured: false,
        serverVersion: null,
        discovery: null,
        auth: null,
        pairingStatusSupported: false,
        error: "Flapshot capture is currently supported by Flapstack on macOS only",
      }
    }
    const config = await this.configResolver(projectPath)
    if (!config) {
      return {
        connected: false,
        configured: false,
        serverVersion: null,
        discovery: null,
        auth: null,
        pairingStatusSupported: false,
        error: 'Add an external stdio MCP server named "flapshot" in MCP settings',
      }
    }
    let pairingStatusSupported = false
    try {
      const connected = await this.connect(projectPath, config)
      const cached = await this.refreshDiscovery(projectPath, connected)
      pairingStatusSupported = cached.toolNames.has(FLAPSHOT_TOOLS.authStatus)
      if (!pairingStatusSupported) {
        return {
          connected: true,
          configured: true,
          serverVersion: cached.connection.client.getServerVersion()?.version ?? null,
          discovery: cached.discovery,
          auth: null,
          pairingStatusSupported: false,
          error: null,
        }
      }
      const authRequestId = `flapstack-auth-${randomUUID()}`
      const authResult = await cached.connection.client.callTool(
        {
          name: FLAPSHOT_TOOLS.authStatus,
          arguments: { requestId: authRequestId },
        },
        { timeout: 15_000 },
      )
      const authValue = parseToolStructuredContent(authResult)
      throwIfServiceFailure(authValue)
      assertServiceResponseCorrelation(authValue, authRequestId)
      const auth = authStatusResponseSchema.parse(authValue).data
      return {
        connected: true,
        configured: true,
        serverVersion: cached.connection.client.getServerVersion()?.version ?? null,
        discovery: cached.discovery,
        auth,
        pairingStatusSupported: true,
        error: null,
      }
    } catch (error) {
      return {
        connected: false,
        configured: true,
        serverVersion: null,
        discovery: null,
        auth: null,
        pairingStatusSupported,
        error: safeMcpError(error),
      }
    }
  }

  async client(projectPath: string | null): Promise<FlapshotProtocolClient> {
    const config = await this.configResolver(projectPath)
    if (!config) throw new Error('External stdio MCP server "flapshot" is not configured')
    return (await this.connect(projectPath, config)).connection.client
  }

  async restart(projectPath: string | null): Promise<FlapshotConnectionStatus> {
    await this.close(projectPath)
    return this.status(projectPath)
  }

  async close(projectPath: string | null): Promise<void> {
    const key = this.connectionKey(projectPath)
    const pending = this.connecting.get(key)
    if (pending) await pending.promise.catch(() => undefined)
    const cached = this.connections.get(key)
    if (this.connections.get(key) === cached) this.connections.delete(key)
    await cached?.connection.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.connecting.values()].map((item) => item.promise))
    const closing = [...this.connections.values()].map((item) => item.connection.close())
    this.connections.clear()
    await Promise.allSettled(closing)
  }

  private async connect(
    projectPath: string | null,
    config: FlapshotStdioConfig,
  ): Promise<CachedConnection> {
    const key = this.connectionKey(projectPath)
    const signature = JSON.stringify(config)
    const current = this.connections.get(key)
    if (current?.signature === signature) return current
    const pending = this.connecting.get(key)
    if (pending?.signature === signature) return pending.promise
    if (pending) {
      await pending.promise.catch(() => undefined)
      return this.connect(projectPath, config)
    }

    const promise = this.createConnection(projectPath, config, signature)
    const entry = { signature, promise }
    this.connecting.set(key, entry)
    try {
      return await promise
    } finally {
      if (this.connecting.get(key) === entry) this.connecting.delete(key)
    }
  }

  private async createConnection(
    projectPath: string | null,
    config: FlapshotStdioConfig,
    signature: string,
  ): Promise<CachedConnection> {
    const key = this.connectionKey(projectPath)
    const current = this.connections.get(key)
    if (current?.signature === signature) return current
    if (current) {
      this.connections.delete(key)
      await current.connection.close().catch(() => undefined)
    }

    let connection: FlapshotProtocolConnection | null = null
    connection = await this.factory(config, (error) => {
      if (!connection) return
      const active = this.connections.get(key)
      if (active?.connection !== connection) return
      this.connections.delete(key)
      this.onDisconnect(key, error)
    })
    try {
      const discovered = await this.discover(connection.client)
      const cached = { signature, connection, ...discovered }
      this.connections.set(key, cached)
      return cached
    } catch (error) {
      await connection.close().catch(() => undefined)
      throw error
    }
  }

  private async refreshDiscovery(
    projectPath: string | null,
    cached: CachedConnection,
  ): Promise<CachedConnection> {
    const discovered = await this.discover(cached.connection.client)
    const refreshed = { ...cached, ...discovered }
    const key = this.connectionKey(projectPath)
    if (this.connections.get(key)?.connection === cached.connection) {
      this.connections.set(key, refreshed)
    }
    return refreshed
  }

  private async discover(client: FlapshotProtocolClient) {
    const server = client.getServerVersion()
    if (!server || server.name !== FLAPSHOT_SERVER_NAME) {
      throw new Error("Configured MCP server did not identify as Flapshot")
    }
    const [listedTools, resource] = await Promise.all([
      client.listTools(),
      client.readResource({ uri: FLAPSHOT_CAPABILITIES_URI }),
    ])
    const text = readMcpResourceText(resource)
    const discovery = flapshotDiscoverySchema.parse(JSON.parse(text))
    const toolNames = new Set(listedTools.tools.map((tool) => tool.name))
    for (const tool of discovery.tools) {
      if (!toolNames.has(tool.name)) {
        throw new Error(`Flapshot discovery listed missing tool ${tool.name}`)
      }
    }
    for (const schema of ["screenshot", "recording", "artifacts", "operations", "system"]) {
      if (discovery.applicationSchemas[schema] !== 1) {
        throw new Error(`Unsupported Flapshot ${schema} schema version`)
      }
    }
    deriveFlapshotActions(discovery)
    return { discovery, toolNames }
  }
}

export function safeMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Flapshot MCP connection failed"
  return message
    .replace(/(?:\/[^\s:]+)+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .slice(0, 512)
}
