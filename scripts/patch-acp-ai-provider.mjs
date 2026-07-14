import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
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
writeFileSync(typesPath, types)

const codexAcpPath = require.resolve("@agentclientprotocol/codex-acp")
let codexAcpSource = readFileSync(codexAcpPath, "utf8")
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
