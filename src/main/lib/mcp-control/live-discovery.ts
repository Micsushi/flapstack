import { randomUUID } from "node:crypto"
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type ProductMcpRuntimePointer = {
  version: 1
  databasePath: string
  invalidationEndpoint: string
  controlEndpoint: string
}

export function productMcpLocalEndpointPid(value: unknown): number | null {
  if (typeof value !== "string") return null
  const pattern =
    process.platform === "win32"
      ? /^\\\\\.\\pipe\\flapstack-product-mcp-([1-9]\d{0,9})-[a-f0-9-]{36}$/
      : /^\/tmp\/fsmcp-([1-9]\d{0,9})-[a-f0-9]{8}\.sock$/
  const pid = Number(pattern.exec(value)?.[1])
  return pid <= 0x7fffffff ? pid : null
}

export function validProductMcpHttpEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false
  const found = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/mcp\/[a-f0-9-]{36}$/.exec(value)
  return !!found && Number(found[1]) <= 65535
}

export function readProductMcpRuntimePointer(
  databasePath = process.env.FLAPSTACK_DB_PATH,
  configDir = process.env.FLAPSTACK_CONFIG_DIR,
  options: { failIfInvalid?: boolean } = {},
): ProductMcpRuntimePointer | null {
  try {
    if (!databasePath) throw new Error("The database path is missing.")
    const file = join(configDir || dirname(databasePath), "product-mcp-runtime.json")
    const stat = lstatSync(file, { throwIfNoEntry: false })
    if (!stat) return null
    if (
      !stat.isFile() ||
      stat.size > 8192 ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
    )
      throw new Error("The runtime pointer file is invalid.")
    const value = JSON.parse(readFileSync(file, "utf8"))
    const pid = productMcpLocalEndpointPid(value.invalidationEndpoint)
    if (
      value.version !== 1 ||
      value.databasePath !== realpathSync.native(databasePath) ||
      pid === null ||
      // Older builds advertised a named pipe or Unix socket for control.
      (!validProductMcpHttpEndpoint(value.controlEndpoint) &&
        productMcpLocalEndpointPid(value.controlEndpoint) !== pid)
    )
      throw new Error("The runtime pointer is invalid.")
    return value as ProductMcpRuntimePointer
  } catch {
    if (options.failIfInvalid)
      throw new Error("Could not read the local Flapstack MCP runtime pointer.")
    return null
  }
}

export function advertiseProductMcpRuntime(configDir: string, pointer: ProductMcpRuntimePointer) {
  const file = join(configDir, "product-mcp-runtime.json")
  const temporary = file + "." + randomUUID()
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ ...pointer, databasePath: realpathSync.native(pointer.databasePath) }),
      { flag: "wx", mode: 0o600 },
    )
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
  return () => {
    if (
      readProductMcpRuntimePointer(pointer.databasePath, configDir)?.controlEndpoint ===
      pointer.controlEndpoint
    ) {
      rmSync(file, { force: true })
    }
  }
}
