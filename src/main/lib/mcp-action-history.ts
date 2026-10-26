import { randomUUID } from "node:crypto"
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { Mutex } from "async-mutex"
import { secureCredentialFile } from "./credential-service"

type Provider = "claude-code" | "codex"
type Direction = "undo" | "redo"
const receipts = new Map<
  string,
  { provider: Provider; bytes: number; apply: (direction: Direction) => Promise<void> }
>()
const historyMutex = new Mutex()
const MAX_SNAPSHOT_BYTES = 1024 * 1024

export function rememberMcpAction(
  provider: Provider,
  bytes: number,
  apply: (direction: Direction) => Promise<void>,
) {
  const actionId = randomUUID()
  receipts.set(actionId, { provider, bytes, apply })
  let total = [...receipts.values()].reduce((sum, entry) => sum + entry.bytes, 0)
  while (receipts.size > 100 || total > 32 * MAX_SNAPSHOT_BYTES) {
    const oldest = receipts.keys().next().value!
    total -= receipts.get(oldest)!.bytes
    receipts.delete(oldest)
  }
  return { actionId }
}

export async function applyMcpAction(provider: Provider, actionId: string, direction: Direction) {
  return historyMutex.runExclusive(async () => {
    const receipt = receipts.get(actionId)
    if (!receipt || receipt.provider !== provider) {
      throw new Error("This MCP undo is no longer available. Refresh the server list.")
    }
    await receipt.apply(direction)
    return { success: true as const }
  })
}

export function readMcpConfigFile(path: string): string | null {
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.size > MAX_SNAPSHOT_BYTES) {
      throw new Error("MCP configuration must be a regular file smaller than 1 MB.")
    }
    return readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error("MCP configuration could not be read safely. No configuration was changed.")
  }
}

// The in-process mutex and last-moment byte comparison protect app writes. External
// writers do not share that mutex; this is not a filesystem-wide transaction.
export function replaceMcpConfigFile(path: string, expected: string | null, next: string | null) {
  if (next !== null && Buffer.byteLength(next) > MAX_SNAPSHOT_BYTES) {
    throw new Error("MCP configuration is too large for undo. No configuration was changed.")
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    if (next !== null) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const fd = openSync(temporary, "wx", 0o600)
      try {
        secureCredentialFile(temporary)
        writeFileSync(fd, next)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    }
    if (readMcpConfigFile(path) !== expected) {
      throw new Error("MCP configuration changed. Refresh before retrying undo or redo.")
    }
    if (next === null) rmSync(path, { force: true })
    else renameSync(temporary, path)
    // No fallible operation after publication: discovery is separate from commit.
  } finally {
    try {
      rmSync(temporary, { force: true })
    } catch {
      /* The committed result is authoritative. */
    }
  }
}
