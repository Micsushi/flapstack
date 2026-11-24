import { createHash } from "node:crypto"
import { basename, join } from "node:path"
import type { ClientSideConnection } from "@agentclientprotocol/sdk"
import { z } from "zod"
import { readFileInsideRoot } from "../../path-safety"
import type { RuntimeAdapterContext } from "../../../../shared/agent-runtime"

type Servers = Parameters<ClientSideConnection["newSession"]>[0]["mcpServers"]
const strings = z.record(z.string(), z.string())
const local = z
  .object({
    type: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: strings.optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
const http = z
  .object({
    type: z.literal("http").optional(),
    serverUrl: z.string().url(),
    headers: strings.optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
const configuration = z.object({ mcpServers: z.record(z.string(), z.unknown()).optional() })
const relativeConfig = ".agents/mcp_config.json"
const pairs = (values: Record<string, string> = {}) =>
  Object.entries(values).map(([name, value]) => ({ name, value }))

export async function projectMcpServers(
  cwd: string,
  supportsHttp: boolean,
  context: RuntimeAdapterContext,
  approvals: Map<string, string>,
  permission: (runId: string, request: unknown) => Promise<unknown>,
  warn: (message: string) => Promise<void>,
): Promise<Servers> {
  let contents: Buffer
  try {
    contents = await readFileInsideRoot(cwd, relativeConfig, { maxBytes: 512 * 1024 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      await warn("Gemini could not read the project's .agents/mcp_config.json.")
    return []
  }
  let entries: Record<string, unknown>
  try {
    entries = configuration.parse(JSON.parse(contents.toString("utf8"))).mcpServers ?? {}
  } catch {
    await warn("Gemini could not read the server definitions in .agents/mcp_config.json.")
    return []
  }
  const servers: Servers = []
  const labels: string[] = []
  let unsupported = false
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === "object" && value && "disabled" in value && value.disabled === true)
      continue
    if (!/^[a-z0-9._-]+$/i.test(name)) {
      unsupported = true
      continue
    }
    const stdio = local.safeParse(value)
    if (stdio.success) {
      const { command, args, env } = stdio.data
      servers.push({ name, command, args: args ?? [], env: pairs(env) })
      labels.push(name + " (" + basename(command) + ")")
      continue
    }
    const remote = http.safeParse(value)
    if (supportsHttp && remote.success && /^https?:\/\//i.test(remote.data.serverUrl)) {
      servers.push({
        type: "http",
        name,
        url: remote.data.serverUrl,
        headers: pairs(remote.data.headers),
      })
      labels.push(name + " (" + new URL(remote.data.serverUrl).hostname + ")")
      continue
    }
    unsupported = true
  }
  if (unsupported)
    await warn(
      "Gemini skipped project MCP servers whose transport or settings cannot be preserved over ACP.",
    )
  if (!servers.length) return []
  const chat = context.subChatId ?? context.chatId
  const fingerprint = createHash("sha256").update(cwd).update("\0").update(contents).digest("hex")
  if (approvals.get(chat) === fingerprint) return servers
  context.signal.throwIfAborted()
  const decision = (await permission(context.runId, {
    provider: "antigravity",
    method: "projectMcp/connect",
    toolName: "Connect project MCP servers to Gemini: " + labels.join(", "),
    toolInput: { file_path: join(cwd, relativeConfig) },
  })) as { decision?: string } | null
  context.signal.throwIfAborted()
  if (decision?.decision === "acceptForSession") approvals.set(chat, fingerprint)
  return decision?.decision === "accept" || decision?.decision === "acceptForSession" ? servers : []
}
