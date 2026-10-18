import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SideQuestionGenerator } from "./service"
import type { CodexProtocolClient } from "../agent-runtime/codex/protocol-client"
import { requestOllamaJson } from "../ollama/request-json"

const ANSWER_LIMIT = 80_000
const SYSTEM =
  "You answer side questions from supplied context only. Do not use tools, execute actions, read files, or contact other agents. The primary task continues independently."
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function codexSideQuestionConfig(configRead: unknown): Record<string, unknown> {
  const response = record(configRead)
  if (!Array.isArray(response.layers))
    throw new Error("Codex did not expose its configuration layers.")
  const names = new Set<string>()
  for (const raw of response.layers) {
    const layer = record(raw)
    if (layer.disabledReason) continue
    for (const name of Object.keys(record(record(layer.config).mcp_servers))) names.add(name)
  }
  return {
    features: {
      shell_tool: false,
      unified_exec: false,
      apps: false,
      plugins: false,
      hooks: false,
      browser_use: false,
      computer_use: false,
      image_generation: false,
      view_image: false,
      multi_agent: false,
      goals: false,
      skill_search: false,
      skip_host_skill_discovery: true,
    },
    agents: { enabled: false },
    tools: { update_plan: { enabled: false } },
    token_budget: { enabled: false, use_history_notes_extension: false },
    sleep_tool: { enabled: false },
    skills: { include_instructions: false },
    web_search: "disabled",
    mcp_servers: Object.fromEntries([...names].map((name) => [name, { enabled: false }])),
  }
}

export async function runCodexSideAnswer(
  client: CodexProtocolClient,
  input: Parameters<SideQuestionGenerator>[0],
  cwd: string,
  apiKey?: string,
): Promise<string> {
  const close = () => {
    void client.close().catch(() => undefined)
  }
  input.signal.addEventListener("abort", close, { once: true })
  try {
    input.signal.throwIfAborted()
    client.setRequestHandler(async () => {
      throw new Error("Side questions cannot request tools or approvals.")
    })
    await client.request("initialize", {
      clientInfo: { name: "flapstack_side_question", version: "1" },
      capabilities: { experimentalApi: true },
    })
    // API-key authentication is only used with an owned temporary CODEX_HOME.
    if (apiKey) await client.request("account/login/start", { type: "apiKey", apiKey })
    const config = codexSideQuestionConfig(
      await client.request("config/read", { cwd, includeLayers: true }),
    )
    const model = input.model?.split("/")[0]
    const response = record(
      await client.request("thread/start", {
        cwd,
        model: model ?? null,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        environments: [],
        dynamicTools: [],
        selectedCapabilityRoots: [],
        runtimeWorkspaceRoots: [],
        baseInstructions: SYSTEM,
        developerInstructions: SYSTEM,
        config,
      }),
    )
    const threadId = record(response.thread).id
    if (typeof threadId !== "string") throw new Error("Codex did not start a side question.")
    const turnResponse = record(
      await client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
      }),
    )
    const turnId = record(turnResponse.turn).id
    let answer = ""
    for await (const event of client.notifications()) {
      input.signal.throwIfAborted()
      if (event.params.threadId !== threadId) continue
      if (event.method === "item/agentMessage/delta" && typeof event.params.delta === "string")
        answer += event.params.delta
      if (event.method === "item/started") {
        const type = record(event.params.item).type
        if (
          typeof type === "string" &&
          !["userMessage", "agentMessage", "reasoning", "plan"].includes(type)
        )
          throw new Error("A side question attempted to use a tool.")
      }
      if (answer.length > ANSWER_LIMIT) throw new Error("Side answer exceeded its limit.")
      if (event.method === "turn/completed") {
        const turn = record(event.params.turn)
        if (turnId && turn.id !== turnId) continue
        if (turn.status !== "completed") throw new Error("Codex side question did not complete.")
        if (!answer.trim() && Array.isArray(turn.items))
          answer = turn.items
            .map((item) => (record(item).type === "agentMessage" ? record(item).text : ""))
            .filter((value) => typeof value === "string")
            .join("\n")
        return answer
      }
      if (event.method === "error") throw new Error("Codex side question failed.")
    }
    throw new Error("Codex disconnected before the answer finished.")
  } finally {
    input.signal.removeEventListener("abort", close)
    await client.close()
  }
}

async function claudeSideAnswer(
  input: Parameters<SideQuestionGenerator>[0],
  cwd: string,
): Promise<string> {
  const [
    { query },
    { buildClaudeEnv, getBundledClaudeBinaryPath },
    { safeStorage },
    { getDatabase },
    { resolveClaudeAccountToken },
    { decryptClaudeCredential },
    { getExistingClaudeToken },
    { getCredentialService },
  ] = await Promise.all([
    import("@anthropic-ai/claude-agent-sdk"),
    import("../claude/env"),
    import("electron"),
    import("../db"),
    import("../provider-accounts/claude-token"),
    import("../claude-credential-storage"),
    import("../claude-token"),
    import("../credential-service"),
  ])
  const credentials = getCredentialService()
  const customStatus = credentials.status("claude.custom-api-token")
  const customToken = credentials.resolve("claude.custom-api-token")
  const custom =
    customToken && customStatus.metadata?.model && customStatus.metadata.baseUrl
      ? { token: customToken, baseUrl: customStatus.metadata.baseUrl }
      : null
  const env = buildClaudeEnv({
    enableTasks: false,
    customEnv: {
      CLAUDE_CONFIG_DIR: cwd,
      ...(custom ? { ANTHROPIC_AUTH_TOKEN: custom.token, ANTHROPIC_BASE_URL: custom.baseUrl } : {}),
    },
  })
  const hasExistingApiConfig = Boolean(
    env.ANTHROPIC_API_KEY ||
    env.ANTHROPIC_AUTH_TOKEN ||
    (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL !== "https://api.anthropic.com"),
  )
  if (!hasExistingApiConfig) {
    const token = resolveClaudeAccountToken(
      getDatabase(),
      (encrypted, migrate) => decryptClaudeCredential(encrypted, safeStorage, migrate),
      getExistingClaudeToken,
    )
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  }
  return runClaudeSideAnswer(query, input, cwd, getBundledClaudeBinaryPath(), env)
}

export async function runClaudeSideAnswer(
  query: (
    input: Parameters<typeof import("@anthropic-ai/claude-agent-sdk").query>[0],
  ) => AsyncIterable<unknown>,
  input: Parameters<SideQuestionGenerator>[0],
  cwd: string,
  binary: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal.addEventListener("abort", abort, { once: true })
  try {
    input.signal.throwIfAborted()
    const stream = query({
      prompt: input.prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable: binary,
        abortController: controller,
        ...(input.model ? { model: input.model } : {}),
        env,
        systemPrompt: SYSTEM,
        tools: [],
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: [],
        skills: [],
        plugins: [],
        persistSession: false,
        maxTurns: 1,
        canUseTool: async () => ({ behavior: "deny", message: "Side questions cannot use tools." }),
      },
    })
    let answer = ""
    let completed = false
    for await (const raw of stream) {
      input.signal.throwIfAborted()
      const message = record(raw)
      if (message.type === "assistant") {
        if (record(message.message).stop_reason === "max_tokens")
          throw new Error("Claude side answer reached its output limit.")
        const content = record(message.message).content
        if (Array.isArray(content))
          for (const rawBlock of content) {
            const block = record(rawBlock)
            if (block.type === "tool_use")
              throw new Error("A side question attempted to use a tool.")
            if (block.type === "text" && typeof block.text === "string") answer += block.text
          }
      }
      if (message.type === "result") {
        if (message.subtype !== "success") throw new Error("Claude side question failed.")
        if (message.stop_reason === "max_tokens")
          throw new Error("Claude side answer reached its output limit.")
        completed = true
      }
      if (answer.length > ANSWER_LIMIT) throw new Error("Side answer exceeded its limit.")
    }
    if (!completed) throw new Error("Claude disconnected before the answer finished.")
    return answer
  } finally {
    controller.abort()
    input.signal.removeEventListener("abort", abort)
  }
}

export function completedLocalSideAnswer(value: Record<string, unknown>): string {
  if (typeof value.response !== "string" || value.done !== true || value.done_reason === "length")
    throw new Error("Local side question did not complete within its output limit.")
  return value.response
}

export const generateSideAnswer: SideQuestionGenerator = async (input) => {
  input.signal.throwIfAborted()
  if (input.provider === "ollama") {
    if (!input.model || /cloud/i.test(input.model))
      throw new Error("Select an installed local model.")
    const value = record(
      await requestOllamaJson("/api/generate", {
        timeoutMs: 180_000,
        maxBytes: 512_000,
        signal: input.signal,
        body: {
          model: input.model,
          prompt: input.prompt,
          system: SYSTEM,
          stream: false,
          options: { num_predict: 4096 },
        },
      }),
    )
    return completedLocalSideAnswer(value)
  }
  // Empty, owned working directory prevents project configuration discovery.
  const cwd = await mkdtemp(join(tmpdir(), "flapstack-side-question-"))
  try {
    if (input.provider === "claude") return await claudeSideAnswer(input, cwd)
    const [
      { spawnCodexProtocolClient },
      { resolveCodexRuntimeCommand },
      { getClaudeShellEnvironment },
      { getCredentialService },
    ] = await Promise.all([
      import("../agent-runtime/codex/protocol-client"),
      import("../agent-runtime/codex/binary"),
      import("../claude/env"),
      import("../credential-service"),
    ])
    const apiKey = getCredentialService().resolve("codex.api-key")?.trim()
    const env = { ...process.env, ...getClaudeShellEnvironment() }
    if (apiKey) {
      // Provider login may write credentials. Confine those writes to this owned directory.
      env.CODEX_HOME = join(cwd, "codex")
      await mkdir(env.CODEX_HOME)
    }
    return await runCodexSideAnswer(
      spawnCodexProtocolClient({ command: resolveCodexRuntimeCommand(), cwd, env }),
      input,
      cwd,
      apiKey,
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
