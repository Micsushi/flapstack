import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, rmSync, writeFileSync } from "node:fs"
import type { Server as HttpServer } from "node:http"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import * as z from "zod/v4"
import {
  archiveTestChat,
  cancelRun,
  createTestChat,
  getChatState,
  getHarnessStatusForRepo,
  getOpencodeLogs,
  getProviderStatus,
  getReasoningTimerState,
  getRunState,
  getTestEnvironment,
  launchTestRun,
  listPendingApprovals,
  listTestTargets,
  replyApproval,
  waitForRunState,
} from "./service"

export const DEV_MCP_DESCRIPTOR_FILENAME = "dev-test-control-mcp.json"

export type DevMcpDescriptor = {
  url: string
  token: string
  pid: number
  checkout: string
  profile: string
  startedAt: string
}

export type DevMcpServerHandle = {
  descriptor: DevMcpDescriptor
  descriptorPath: string
  stop(): Promise<void>
}

type DevMcpHttpRequest = {
  headers: { authorization?: string | string[] }
  body?: unknown
}

type DevMcpHttpResponse = {
  headersSent: boolean
  status(code: number): DevMcpHttpResponse
  json(value: unknown): unknown
  on(event: "close", listener: () => void): void
}

export function hasValidBearerToken(header: string | string[] | undefined, token: string): boolean {
  const value = Array.isArray(header) ? header[0] : header
  const supplied = value?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!supplied) return false
  const actual = Buffer.from(supplied)
  const expected = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function result(data: unknown) {
  const text = JSON.stringify(data, null, 2)
  return { content: [{ type: "text" as const, text }], structuredContent: { result: data } }
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      },
    ],
  }
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "get_test_environment",
    {
      description: "Verify the live Flapstack Dev checkout, profile, database, and tool catalog.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(getTestEnvironment()),
  )
  server.registerTool(
    "get_harness_status",
    {
      description: "Inspect Codex and Claude readiness without returning credentials.",
      inputSchema: { probeCli: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ probeCli }) => result(await getHarnessStatusForRepo({ probeCli })),
  )
  server.registerTool(
    "get_provider_status",
    {
      description: "Inspect OpenRouter and NanoGPT readiness and cached model counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(await getProviderStatus()),
  )
  server.registerTool(
    "list_test_targets",
    {
      description: "List projects, chats, provider configuration, and recent message counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(listTestTargets()),
  )
  server.registerTool(
    "get_chat_state",
    {
      description: "Inspect one compact transcript, its recent runs, tools, and approvals.",
      inputSchema: {
        subChatId: z.string().min(1),
        messageLimit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(getChatState(input)),
  )
  server.registerTool(
    "get_run_state",
    {
      description: "Inspect one persisted run and matching assistant result.",
      inputSchema: { runId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(getRunState(input)),
  )
  server.registerTool(
    "get_reasoning_timer_state",
    {
      description: "Inspect the authoritative start, elapsed duration, and label for one run.",
      inputSchema: {
        runId: z.string().min(1),
        nowMs: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(getReasoningTimerState(input)),
  )
  server.registerTool(
    "list_pending_approvals",
    {
      description: "List pending OpenRouter or NanoGPT permission requests.",
      inputSchema: { runId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(listPendingApprovals(input)),
  )
  server.registerTool(
    "get_opencode_logs",
    {
      description: "Read bounded redacted provider-runtime logs for diagnosis.",
      inputSchema: {
        sessionId: z.string().min(1).optional(),
        maxLines: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(getOpencodeLogs(input)),
  )
  server.registerTool(
    "create_test_chat",
    {
      description: "Create one local OpenRouter or NanoGPT project test chat.",
      inputSchema: {
        projectId: z.string().min(1),
        name: z.string().min(1).max(200),
        provider: z.enum(["openrouter", "nanogpt"]),
        model: z.string().min(1),
        permissionMode: z
          .enum([
            "read-only",
            "ask-before-edits",
            "auto-edit-project-only",
            "full-access",
            "custom",
          ])
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(createTestChat(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "archive_test_chat",
    {
      description: "Reversibly archive one idle test chat without deleting history.",
      inputSchema: { chatId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(archiveTestChat(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "launch_test_run",
    {
      description: "Launch a real OpenRouter or NanoGPT run through Flapstack persistence.",
      inputSchema: {
        subChatId: z.string().min(1),
        prompt: z.string().min(1).max(20_000),
        provider: z.enum(["openrouter", "nanogpt"]).optional(),
        model: z.string().min(1).optional(),
        cwd: z.string().min(1).optional(),
        reasoningEnabled: z.boolean().optional(),
        reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        return result(await launchTestRun(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "reply_approval",
    {
      description: "Reply once to a pending provider permission request.",
      inputSchema: {
        requestId: z.string().min(1),
        reply: z.enum(["once", "always", "reject"]),
        message: z.string().max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => result(replyApproval(input)),
  )
  server.registerTool(
    "cancel_run",
    {
      description: "Cancel a matching active OpenRouter or NanoGPT run.",
      inputSchema: { subChatId: z.string().min(1), runId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(cancelRun(input)),
  )
  server.registerTool(
    "wait_for_run",
    {
      description: "Wait for one run to finish, bounded to five minutes.",
      inputSchema: {
        runId: z.string().min(1),
        timeoutMs: z.number().int().min(100).max(300_000).optional(),
        pollMs: z.number().int().min(100).max(10_000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(await waitForRunState(input)),
  )
}

function createServer(): McpServer {
  const server = new McpServer({ name: "flapstack-dev-test-control", version: "1.0.0" })
  registerTools(server)
  return server
}

export async function startDevMcpServer(input: {
  enabled: boolean
  userDataPath: string
  checkout: string
  profile: string
  pid?: number
}): Promise<DevMcpServerHandle | null> {
  if (!input.enabled) return null

  const token = randomBytes(32).toString("base64url")
  const expressApp = createMcpExpressApp({
    host: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
  })
  expressApp.use((request: DevMcpHttpRequest, response: DevMcpHttpResponse, next: () => void) => {
    if (!hasValidBearerToken(request.headers.authorization, token)) {
      response.status(401).json({ error: "Unauthorized" })
      return
    }
    next()
  })
  expressApp.post("/mcp", async (request: DevMcpHttpRequest, response: DevMcpHttpResponse) => {
    const server = createServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(
        request as Parameters<typeof transport.handleRequest>[0],
        response as unknown as Parameters<typeof transport.handleRequest>[1],
        request.body,
      )
      response.on("close", () => {
        void transport.close()
        void server.close()
      })
    } catch (error) {
      console.error("[dev-mcp] Request failed", error)
      if (!response.headersSent) response.status(500).json({ error: "Internal MCP error" })
    }
  })
  expressApp.get("/mcp", (_request: DevMcpHttpRequest, response: DevMcpHttpResponse) =>
    response.status(405).json({ error: "POST only" }),
  )
  expressApp.delete("/mcp", (_request: DevMcpHttpRequest, response: DevMcpHttpResponse) =>
    response.status(405).json({ error: "POST only" }),
  )

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const listening = expressApp.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error)
      else resolve(listening)
    })
  })
  const address = httpServer.address()
  if (!address || typeof address === "string") {
    httpServer.close()
    throw new Error("Dev MCP did not bind a TCP port")
  }
  const descriptor: DevMcpDescriptor = {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    pid: input.pid ?? process.pid,
    checkout: input.checkout,
    profile: input.profile,
    startedAt: new Date().toISOString(),
  }
  const descriptorPath = join(input.userDataPath, DEV_MCP_DESCRIPTOR_FILENAME)
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 })
  chmodSync(descriptorPath, 0o600)
  console.log(`[dev-mcp] Listening at ${descriptor.url}`)

  return {
    descriptor,
    descriptorPath,
    stop: async () => {
      rmSync(descriptorPath, { force: true })
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
