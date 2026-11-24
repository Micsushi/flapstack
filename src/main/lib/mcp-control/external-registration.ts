import { generateKeyPairSync, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { secureCredentialFile } from "../credential-service"
import { externalGrantPath, externalPermissionModes } from "./external-grant"

export const externalClients = ["codex", "claude", "antigravity"] as const
export const externalClientNames = ["Codex", "Claude Code", "Antigravity"] as const
const serverName = "flapstack-app-control"

export function createExternalMcpRegistration(options: {
  databasePath: string
  configDir: string
  executablePath: string
  entryPoint: string
  client: (typeof externalClients)[number]
  permissionMode: (typeof externalPermissionModes)[number]
  outputRoot: string
}) {
  if (
    !externalClients.includes(options.client) ||
    !externalPermissionModes.includes(options.permissionMode)
  )
    throw new Error("Unknown external client or permission mode.")
  if (!isAbsolute(options.executablePath) || !isAbsolute(options.entryPoint))
    throw new Error("Use absolute paths for the MCP runtime.")
  const db = realpathSync.native(options.databasePath)
  const configDir = realpathSync.native(options.configDir)
  const outputRoot = realpathSync.native(options.outputRoot)
  for (let folder = outputRoot; ; folder = dirname(folder)) {
    if (folder === configDir || folder === dirname(db))
      throw new Error("Choose a private directory outside the Flapstack profile data.")
    if (existsSync(join(folder, ".git")))
      throw new Error("Choose a private directory outside a source repository.")
    if (dirname(folder) === folder) break
  }

  const grantId = randomUUID()
  const grantPath = externalGrantPath(db, grantId)
  const directory = join(outputRoot, `flapstack-${options.client}-${grantId}`)
  const keys = generateKeyPairSync("ed25519")
  const registration = {
    command: options.executablePath,
    args: [options.entryPoint, "--external"],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      FLAPSTACK_CONFIG_DIR: configDir,
      FLAPSTACK_DB_PATH: db,
      FLAPSTACK_MCP_OWNER_TOKEN:
        grantId +
        "." +
        keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    },
  }
  const publicGrant = {
    version: 1,
    databasePath: db,
    configDir,
    permissionMode: options.permissionMode,
    publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  }
  const codex = options.client === "codex"
  const settingsDir = options.client === "antigravity" ? join(directory, ".agents") : directory
  const configPath = join(
    settingsDir,
    codex ? "config.toml" : options.client === "claude" ? "mcp.json" : "mcp_config.json",
  )
  const contents = codex
    ? [
        `[mcp_servers.${serverName}]`,
        "command = " + JSON.stringify(registration.command),
        "args = " + JSON.stringify(registration.args),
        `[mcp_servers.${serverName}.env]`,
        ...Object.entries(registration.env).map(
          ([key, value]) => key + " = " + JSON.stringify(value),
        ),
      ].join("\n")
    : JSON.stringify({ mcpServers: { [serverName]: registration } }, null, 2)
  // Only the desktop can issue a grant. Publish its public half after the private
  // client configuration has been saved successfully in a fresh, private folder.
  mkdirSync(dirname(grantPath), { recursive: true, mode: 0o700 })
  mkdirSync(directory, { mode: 0o700 })
  let createdConfig = false
  try {
    if (settingsDir !== directory) mkdirSync(settingsDir, { mode: 0o700 })
    const fd = openSync(configPath, "wx", 0o600)
    createdConfig = true
    try {
      secureCredentialFile(configPath)
      writeFileSync(fd, contents + "\n")
    } finally {
      closeSync(fd)
    }
    writeFileSync(grantPath, JSON.stringify(publicGrant), { mode: 0o600, flag: "wx" })
  } catch (error) {
    if (createdConfig) unlinkSync(configPath)
    if (settingsDir !== directory && existsSync(settingsDir)) rmdirSync(settingsDir)
    rmdirSync(directory)
    throw error
  }
  return { grantId, grantPath, directory, configPath }
}
