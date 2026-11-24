import { createRequire } from "node:module"
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve("@mcpc-tech/acp-ai-provider"))

for (const filename of ["index.cjs", "index.mjs"]) {
  const filePath = join(packageRoot, filename)
  let source = readFileSync(filePath, "utf8")

  source = source.replace(
    /return \{\s*outcome: \{\s*outcome: "selected",\s*optionId: params\.options\[0\]\?\.optionId \|\| "allow"\s*\}\s*\};/,
    'return { outcome: { outcome: "cancelled" } };',
  )

  // The router supplies a complete, sanitized environment for app-launched Codex.
  // Preserve the library's default merge for other consumers.
  if (!source.includes("this.config.inheritEnvironment === false")) {
    source = source.replace(
      /env: \{\s*\.\.\.([\w.]+\.env),\s*\.\.\.this\.config\.env\s*\}/,
      "env: this.config.inheritEnvironment === false ? this.config.env : { ...$1, ...this.config.env }",
    )
  }
  if (!source.includes("this.config.inheritEnvironment === false")) {
    throw new Error(`Could not isolate the ACP launch environment in ${filename}`)
  }

  const clientCreation = "this.client = new ACPAISDKClient();"
  const handlerHook = `${clientCreation}\n      if (this.config.permissionRequestHandler) {\n        this.client.setPermissionRequestHandler(this.config.permissionRequestHandler);\n      }`
  if (
    !source.includes(
      "this.client.setPermissionRequestHandler(this.config.permissionRequestHandler)",
    )
  ) {
    source = source.replace(clientCreation, handlerHook)
  }

  const staleSessionLoad =
    /if \(this\.config\.existingSessionId\) \{\s*await this\.connection\.loadSession\(\{\s*sessionId: this\.config\.existingSessionId,\s*cwd: ([^,\n]+),\s*mcpServers\s*\}\);\s*this\.sessionId = this\.config\.existingSessionId;\s*this\.sessionResponse = \{\s*sessionId: this\.config\.existingSessionId\s*\};\s*this\.isFreshSession = false;\s*\} else \{\s*this\.sessionResponse = await this\.connection\.newSession\(\{\s*\.\.\.this\.config\.session,\s*cwd: ([^,\n]+),\s*mcpServers\s*\}\);\s*this\.sessionId = this\.sessionResponse\.sessionId;\s*this\.isFreshSession = true;\s*\}/
  if (!source.includes("[acp-ai-provider] Stale ACP session; starting fresh.")) {
    source = source.replace(staleSessionLoad, (_match, cwdExpression) => {
      return `if (this.config.existingSessionId) {
        try {
          await this.connection.loadSession({
            sessionId: this.config.existingSessionId,
            cwd: ${cwdExpression},
            mcpServers
          });
          this.sessionId = this.config.existingSessionId;
          this.sessionResponse = { sessionId: this.config.existingSessionId };
          this.isFreshSession = false;
        } catch (error) {
          this.debug.log("[acp-ai-provider] Stale ACP session; starting fresh.", error);
          this.config.existingSessionId = undefined;
        }
      }
      if (!this.sessionId) {
        this.sessionResponse = await this.connection.newSession({
          ...this.config.session,
          cwd: ${cwdExpression},
          mcpServers
        });
        this.sessionId = this.sessionResponse.sessionId;
        this.isFreshSession = true;
      }`
    })
  }

  if (
    !source.includes("const safeToolResultBlocks = Array.isArray(toolResult) ? toolResult : [];")
  ) {
    source = source.replace(
      "const parts = [];\n  for (const blk of toolResult) {",
      "const parts = [];\n  const safeToolResultBlocks = Array.isArray(toolResult) ? toolResult : [];\n  for (const blk of safeToolResultBlocks) {",
    )
    source = source.replace(
      'return parts.join("\\n");',
      'return parts.join("\\n") || "Tool request rejected or failed.";',
    )
  }

  if (
    source.includes("params.options[0]?.optionId") ||
    !source.includes(handlerHook) ||
    !source.includes("[acp-ai-provider] Stale ACP session; starting fresh.") ||
    !source.includes("const safeToolResultBlocks = Array.isArray(toolResult) ? toolResult : [];")
  ) {
    throw new Error(`Could not apply fail-closed ACP permission patch to ${filename}`)
  }

  writeFileSync(filePath, source)
}

const typesPath = join(packageRoot, "types", "src", "types.d.ts")
let types = readFileSync(typesPath, "utf8")
types = types.replace(
  'import type { InitializeRequest, NewSessionRequest } from "@agentclientprotocol/sdk";',
  'import type { InitializeRequest, NewSessionRequest, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";',
)
if (!types.includes("permissionRequestHandler?:")) {
  types = types.replace(
    "  /**\n   * Session configuration (ACP protocol) - Required when creating a new session",
    "  /** Flapstack-owned permission bridge. Missing handlers fail closed. */\n  permissionRequestHandler?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;\n  /**\n   * Session configuration (ACP protocol) - Required when creating a new session",
  )
}
if (!types.includes("permissionRequestHandler?:")) {
  throw new Error("Could not patch ACP provider type declarations")
}
if (!types.includes("inheritEnvironment?:")) {
  types = types.replace(
    "  permissionRequestHandler?:",
    "  inheritEnvironment?: boolean;\n  permissionRequestHandler?:",
  )
}
if (!types.includes("inheritEnvironment?:"))
  throw new Error("Could not patch ACP environment types")
writeFileSync(typesPath, types)

const codexAcpPath = require.resolve("@agentclientprotocol/codex-acp")
let codexAcpSource = readFileSync(codexAcpPath, "utf8")
// Launch the same pinned executable as the direct adapter, including in paths with spaces.
const pinnedSpawn = 'spawn(codexPath, ["app-server"], { env: spawnEnv, windowsHide: true })'
codexAcpSource = codexAcpSource.replace(
  'process.platform === "win32" ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv }) : spawn(codexPath, ["app-server"], { env: spawnEnv })',
  pinnedSpawn,
)
if (!codexAcpSource.includes(pinnedSpawn)) {
  throw new Error("Could not configure the pinned Codex ACP executable")
}
// Legacy ACP starts its own App Server. Apply the same Windows fallback to that session.
const sessionConfigLine =
  "    const configWithWorkspaceRoots = mergeSandboxWorkspaceWriteRoots(mergedConfig, additionalDirectories);"
const windowsFallback = `    if (process.platform === "win32") {
      const effective = await this.codexClient.configRead({ cwd: projectPath, includeLayers: false });
      const mode = effective.config?.windows?.sandbox;
      mergedConfig.windows = { ...mergedConfig.windows, sandbox: mode === "elevated" || mode === "mxc" ? mode : "unelevated" };
    }`
if (!codexAcpSource.includes(windowsFallback)) {
  if (!codexAcpSource.includes(sessionConfigLine))
    throw new Error("Could not configure the Codex ACP Windows sandbox")
  codexAcpSource = codexAcpSource.replace(
    sessionConfigLine,
    windowsFallback + "\n" + sessionConfigLine,
  )
}
// Every ACP start and resume uses createSessionConfig, including its empty-server paths.
// Apply the same native-layer policy as direct App Server threads after ACP's own merges.
const legacyPolicyImport =
  'import { disabledCodexMcpServers } from "./flapstack-codex-mcp-policy.mjs";'
const sessionMethod =
  "  async createSessionConfig(projectPath, additionalDirectories, mcpServers) {"
const legacyBoundary = `${sessionMethod}
    const config = await this.buildFlapstackSessionConfig(projectPath, additionalDirectories, mcpServers);
    const native = await this.codexClient.configRead({ cwd: projectPath, includeLayers: true });
    const disabled = disabledCodexMcpServers(native, config.mcp_servers);
    return Object.keys(disabled).length ? { ...config, mcp_servers: { ...config.mcp_servers, ...disabled } } : config;
  }
  async buildFlapstackSessionConfig(projectPath, additionalDirectories, mcpServers) {`
if (!codexAcpSource.includes(legacyBoundary)) {
  if (!codexAcpSource.includes(sessionMethod))
    throw new Error("Could not isolate Codex ACP session configuration")
  codexAcpSource = codexAcpSource.replace(sessionMethod, legacyBoundary)
}
if (!codexAcpSource.includes(legacyPolicyImport)) {
  codexAcpSource = codexAcpSource.replace(
    "#!/usr/bin/env node\n",
    "#!/usr/bin/env node\n" + legacyPolicyImport + "\n",
  )
}
if (!codexAcpSource.includes(legacyPolicyImport))
  throw new Error("Could not load Codex ACP session policy")
copyFileSync(
  new URL("../src/main/lib/mcp-control/codex-mcp-policy.mjs", import.meta.url),
  join(dirname(codexAcpPath), "flapstack-codex-mcp-policy.mjs"),
)
codexAcpSource = codexAcpSource.replace(
  "excludeTmpdirEnvVar: false,\n      excludeSlashTmp: false",
  "excludeTmpdirEnvVar: true,\n      excludeSlashTmp: true",
)
const correlatedMcpApproval =
  /(toolCallId: context\.correlatedCallId,\s*kind: "execute",\s*status: "pending")(\s*\/\/ content:)/
if (!codexAcpSource.includes("rawInput: { serverName: params.serverName }")) {
  codexAcpSource = codexAcpSource.replace(
    correlatedMcpApproval,
    "$1,\n              rawInput: { serverName: params.serverName }$2",
  )
}
if (!codexAcpSource.includes("rawInput: { serverName: params.serverName }")) {
  throw new Error("Could not preserve MCP server identity in Codex ACP permission requests")
}
if (!codexAcpSource.includes("excludeTmpdirEnvVar: true,\n      excludeSlashTmp: true")) {
  throw new Error("Could not restrict Codex ACP workspace mode to project roots")
}
writeFileSync(codexAcpPath, codexAcpSource)

console.log(
  "Patched ACP permission handling (fail closed, project-only tmp excluded, product MCP identity preserved).",
)
