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

  if (source.includes("params.options[0]?.optionId") || !source.includes(handlerHook)) {
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

console.log("Patched @mcpc-tech/acp-ai-provider permission handling (fail closed).")
