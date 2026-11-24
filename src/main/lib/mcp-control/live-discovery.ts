import { randomUUID } from "node:crypto"
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type ProductMcpRuntimePointer = {
  version: 1
  databasePath: string
  invalidationEndpoint: string
  controlEndpoint: string
}

function validEndpoint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (process.platform === "win32"
      ? /^\\\\\.\\pipe\\flapstack-product-mcp-\d+-[a-f0-9-]{36}$/.test(value)
      : /^\/tmp\/fsmcp-\d+-[a-f0-9]{8}\.sock$/.test(value))
  )
}

export function readProductMcpRuntimePointer(
  databasePath = process.env.FLAPSTACK_DB_PATH,
  configDir = process.env.FLAPSTACK_CONFIG_DIR,
): ProductMcpRuntimePointer | null {
  if (!databasePath) return null
  try {
    const file = join(configDir || dirname(databasePath), "product-mcp-runtime.json")
    const stat = lstatSync(file)
    if (
      !stat.isFile() ||
      stat.size > 8192 ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
    )
      return null
    const value = JSON.parse(readFileSync(file, "utf8"))
    if (
      value.version !== 1 ||
      value.databasePath !== realpathSync.native(databasePath) ||
      !validEndpoint(value.invalidationEndpoint) ||
      !validEndpoint(value.controlEndpoint)
    )
      return null
    return value as ProductMcpRuntimePointer
  } catch {
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
