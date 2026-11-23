import fs from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { app } from "electron"
import { assertTerminalGeometry } from "../replay"

const MAX_BYTES = 8 * 1024 * 1024
const MAX_FILES = 32
export type RetainedTerminalOutput = { data: string; cols: number; rows: number }

function location(workspaceId: string, paneId: string) {
  const directory = path.join(app.getPath("userData"), "terminal-recovery")
  const key = createHash("sha256")
    .update(JSON.stringify([workspaceId, paneId]))
    .digest("hex")
  return { directory, file: path.join(directory, `${key}.json`) }
}

export function readTerminalOutput(
  workspaceId: string,
  paneId: string,
): RetainedTerminalOutput | null {
  try {
    const { directory, file } = location(workspaceId, paneId)
    if (fs.lstatSync(directory).isSymbolicLink()) return null
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as RetainedTerminalOutput
    if (typeof value.data !== "string") return null
    assertTerminalGeometry(value.cols, value.rows)
    return value
  } catch {
    return null
  }
}

/** Atomic, bounded output snapshots. No separate input log or process identity. */
export function retainTerminalOutput(
  workspaceId: string,
  paneId: string,
  value: RetainedTerminalOutput,
): void {
  let temporary: string | undefined
  try {
    const content = JSON.stringify(value)
    if (Buffer.byteLength(content) > MAX_BYTES) return
    const { directory, file } = location(workspaceId, paneId)
    fs.mkdirSync(directory, { recursive: true })
    if (fs.lstatSync(directory).isSymbolicLink()) return
    temporary = `${file}.${randomUUID()}.tmp`
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" })
    fs.renameSync(temporary, file)
    temporary = undefined
    const files = fs
      .readdirSync(directory)
      .filter((name) => /^[a-f0-9]{64}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name))
      .map((name) => ({ name, time: fs.lstatSync(path.join(directory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const entry of files.slice(MAX_FILES)) fs.unlinkSync(path.join(directory, entry.name))
  } catch (error) {
    console.warn("[Terminal] Could not retain output:", error)
  } finally {
    if (temporary) {
      try {
        fs.unlinkSync(temporary)
      } catch {
        /* Preserve the previous snapshot. */
      }
    }
  }
}
