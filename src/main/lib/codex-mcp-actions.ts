import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { CodexProtocolClient } from "./agent-runtime/codex/protocol-client"
import { Mutex } from "async-mutex"
import { secureCredentialFile } from "./credential-service"
import { readMcpConfigFile, replaceMcpConfigFile, rememberMcpAction } from "./mcp-action-history"

const configMutex = new Mutex()

export async function changeCodexMcpWithUndo(
  configPath: string,
  name: string,
  value: Record<string, unknown> | null,
  createClient: (home: string) => CodexProtocolClient,
) {
  return configMutex.runExclusive(async () => {
    if (!/^[a-zA-Z0-9_:@/.-]+$/.test(name)) {
      throw new Error("This Codex server name cannot be changed by the app.")
    }
    const before = readMcpConfigFile(configPath)
    const home = await mkdtemp(join(tmpdir(), "flapstack-mcp-"))
    let after: string | null
    try {
      // Only stage configuration. No account credentials, threads, MCP connections or OAuth requests.
      secureCredentialFile(home)
      const staged = join(home, "config.toml")
      if (before !== null) {
        await writeFile(staged, "", { mode: 0o600 })
        secureCredentialFile(staged)
        await writeFile(staged, before)
      }
      const client = createClient(home)
      try {
        await client.request("initialize", {
          clientInfo: { name: "flapstack_mcp_config", version: "1" },
          capabilities: { experimentalApi: true },
        })
        const response = (await client.request("config/read", {
          cwd: home,
          includeLayers: true,
        })) as {
          layers?: Array<{
            name: { type: string; file?: string; profile?: string | null }
            config: { mcp_servers?: Record<string, unknown> }
            version: string
            disabledReason?: string | null
          }>
        }
        const layer = response.layers?.find(
          (entry) =>
            entry.name.type === "user" &&
            !entry.name.profile &&
            entry.name.file &&
            resolve(entry.name.file) === resolve(staged),
        )
        if (!layer || layer.disabledReason || !layer.version) throw new Error()
        const owns = Object.hasOwn(layer.config.mcp_servers ?? {}, name)
        const exists = response.layers!.some((entry) =>
          Object.hasOwn(entry.config.mcp_servers ?? {}, name),
        )
        if (value === null ? !owns : exists) throw new Error()
        await client.request("config/batchWrite", {
          edits: [
            { keyPath: `mcp_servers.${JSON.stringify(name)}`, value, mergeStrategy: "replace" },
          ],
          filePath: staged,
          expectedVersion: layer.version,
          reloadUserConfig: false,
        })
      } finally {
        await client.close()
      }
      after = readMcpConfigFile(staged)
      if (after === before) throw new Error()
    } catch {
      // Provider diagnostics may contain config values. Keep them out of IPC and logs.
      throw new Error("Codex MCP change could not be prepared. Refresh the server list and retry.")
    } finally {
      await rm(home, { recursive: true, force: true })
    }
    replaceMcpConfigFile(configPath, before, after)
    let undone = false
    // shortcut: exact whole-file CAS preserves unknown TOML fields; unrelated config
    // edits also conflict. Merge entry-level reversals only if unrelated bytes can be preserved.
    return rememberMcpAction(
      "codex",
      Buffer.byteLength(before ?? "") + Buffer.byteLength(after ?? ""),
      async (direction) => {
        await configMutex.runExclusive(() => {
          const expected = undone ? before : after
          if (readMcpConfigFile(configPath) !== expected) {
            throw new Error("Codex configuration changed. Refresh before retrying undo or redo.")
          }
          if ((direction === "undo") === undone) return
          replaceMcpConfigFile(configPath, expected, undone ? after : before)
          undone = !undone
        })
      },
    )
  })
}
