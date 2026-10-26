import { isDeepStrictEqual } from "node:util"
import {
  CLAUDE_CONFIG_PATH,
  claudeConfigMutex,
  type ClaudeConfig,
  type McpServerConfig,
} from "./claude-config"
import { getCredentialService, type CredentialService } from "./credential-service"
import { mcpCredentialId } from "./mcp-secrets"
import { readMcpConfigFile, replaceMcpConfigFile, rememberMcpAction } from "./mcp-action-history"

type Secrets = ReturnType<CredentialService["snapshotOpaque"]>
let recovery: { target: Secrets; expected: Secrets } | null = null

function readConfig() {
  const raw = readMcpConfigFile(CLAUDE_CONFIG_PATH)
  try {
    const config = JSON.parse(raw ?? "{}") as ClaudeConfig
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error()
    return { raw, config }
  } catch {
    throw new Error("Claude configuration is invalid. Repair it before changing MCP servers.")
  }
}

function recoverSecrets() {
  if (!recovery) return
  const service = getCredentialService()
  if (!isDeepStrictEqual(service.snapshotOpaque(Object.keys(recovery.target)), recovery.target)) {
    service.restoreOpaque(recovery.target, recovery.expected)
  }
  recovery = null
}

function commit(raw: string | null, before: Secrets, update: () => ClaudeConfig) {
  const service = getCredentialService()
  let after: Secrets | undefined
  try {
    const config = update()
    after = service.snapshotOpaque(Object.keys(before))
    if (Buffer.byteLength(JSON.stringify(after)) > 1024 * 1024)
      throw new Error("MCP credentials exceed the undo limit.")
    replaceMcpConfigFile(CLAUDE_CONFIG_PATH, raw, `${JSON.stringify(config, null, 2)}\n`)
    return { config, secrets: after }
  } catch {
    // Keep a failed rollback in main-process memory so the next attempt can recover
    // it before doing any new work. Never overwrite an intervening credential edit.
    recovery = { target: before, expected: after ?? before }
    if (!after) {
      try {
        recovery.expected = service.snapshotOpaque(Object.keys(before))
      } catch {
        // Keep the preimage even when secure storage cannot currently be read.
      }
    }
    try {
      recoverSecrets()
    } catch {
      throw new Error(
        "MCP credential recovery is pending. Retry after secure storage is available; configuration was not saved.",
      )
    }
    throw new Error("MCP change was not saved. Refresh the server list and retry.")
  }
}

export async function changeClaudeMcpWithUndo(
  scope: string | null,
  names: string[],
  update: (config: ClaudeConfig) => ClaudeConfig,
) {
  return claudeConfigMutex.runExclusive(() => {
    recoverSecrets()
    const keys = [...new Set(names)]
    if (keys.some((name) => !name || ["__proto__", "constructor", "prototype"].includes(name))) {
      throw new Error("This server name cannot be changed by the app.")
    }
    const entries = (config: ClaudeConfig) => {
      const servers = scope ? config.projects?.[scope]?.mcpServers : config.mcpServers
      return keys.map((key) => structuredClone(servers?.[key]))
    }
    const { raw, config } = readConfig()
    const before = entries(config)
    const ids = [
      ...new Set([
        ...keys.map((key) => mcpCredentialId(scope, key)),
        ...before.flatMap((entry) =>
          typeof entry?._flapstackCredentialRef === "string" ? [entry._flapstackCredentialRef] : [],
        ),
      ]),
    ]
    const service = getCredentialService()
    const secretsBefore = service.snapshotOpaque(ids)
    if (Buffer.byteLength(JSON.stringify(secretsBefore)) > 1024 * 1024)
      throw new Error("MCP credentials exceed the undo limit.")
    const result = commit(raw, secretsBefore, () => update(config))
    const after = entries(result.config)
    const secretsAfter = result.secrets
    let undone = false
    return rememberMcpAction(
      "claude-code",
      Buffer.byteLength(JSON.stringify([before, after, secretsBefore, secretsAfter])),
      async (direction) => {
        await claudeConfigMutex.runExclusive(() => {
          recoverSecrets()
          const { raw: liveRaw, config: live } = readConfig()
          const expected = undone ? before : after
          const expectedSecrets = undone ? secretsBefore : secretsAfter
          if (
            !isDeepStrictEqual(entries(live), expected) ||
            !isDeepStrictEqual(service.snapshotOpaque(ids), expectedSecrets)
          ) {
            throw new Error(
              "This MCP server or its credentials changed. Refresh before retrying undo or redo.",
            )
          }
          // A retried response after a confirmed write must not apply the inverse twice.
          if ((direction === "undo") === undone) return
          const target = undone ? after : before
          const targetSecrets = undone ? secretsAfter : secretsBefore
          commit(liveRaw, expectedSecrets, () => {
            service.restoreOpaque(targetSecrets, expectedSecrets)
            keys.forEach((key, index) => {
              const entry = target[index]
              if (entry === undefined) {
                // Scope was resolved when the receipt was created. Never re-resolve a
                // worktree path against a newer project mapping during undo.
                const servers = scope ? live.projects?.[scope]?.mcpServers : live.mcpServers
                if (servers) delete servers[key]
              } else {
                if (scope) {
                  live.projects ??= {}
                  live.projects[scope] ??= {}
                  live.projects[scope].mcpServers ??= {}
                } else live.mcpServers ??= {}
                const servers = scope ? live.projects![scope]!.mcpServers! : live.mcpServers!
                servers[key] = structuredClone(entry) as McpServerConfig
              }
            })
            return live
          })
          undone = !undone
        })
      },
    )
  })
}
