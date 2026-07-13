import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, rmSync, writeFileSync } from "node:fs"
import type { Server as HttpServer } from "node:http"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import * as z from "zod/v4"
import { CREDENTIAL_IDS } from "../../../shared/credential-types"
import { CUSTOM_PERMISSION_SCHEMA_VERSION, permissionModes } from "../permissions"
import {
  archiveTestChat,
  archiveTestProject,
  cancelRun,
  cleanupProductMcpCaller,
  cancelProductMcpChildRun,
  controlProductMcpRenderer,
  controlSettings,
  createTestChat,
  ensureTestProject,
  createTestOrchestration,
  createTestOrchestrationFixture,
  getChatState,
  getHarnessStatusForRepo,
  getOpencodeLogs,
  getProductMcpState,
  getProductMcpRendererState,
  getProductMcpTestCall,
  getProviderStatus,
  getSettingsState,
  getLiveSettingsState,
  getVisibleCopySearchState,
  requestDevRendererControl,
  getRendererAgentInputState,
  listProviderExtensions,
  getReasoningTimerState,
  getRunState,
  getTestEnvironment,
  getTestOrchestration,
  launchTestRun,
  injectAgentInputRequest,
  listAgentInputRequests,
  listPendingApprovals,
  listTestTargets,
  mutateProjectProviderExtension,
  manageProductMcpRecovery,
  prepareProductMcpCaller,
  mutateTestOrchestration,
  replyApproval,
  replyProductMcpApproval,
  sendTestPrompt,
  setProductMcpTestExposure,
  startProductMcpTestCall,
  openTestChat,
  replyAgentInputRequest,
  waitForRunState,
} from "./service"
import {
  getCredentialStatus,
  getPermissionState,
  listRegisteredProviderExtensions,
  migrateLegacyCredential,
  mutateRegisteredProjectProviderExtension,
  previewPermission,
  resolveTestChatSelection,
  removeCredential,
  setChatPermission,
  setOrReplaceCredential,
  setPermissionDefault,
} from "./settings-release-controls"

export const DEV_MCP_DESCRIPTOR_FILENAME = "dev-test-control-mcp.json"

export type DevMcpDescriptor = {
  url: string
  token: string
  pid: number
  checkout: string
  profile: string
  userDataPath: string
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

const productMcpAuditDecisionSchema = z.enum([
  "allowed",
  "dispatch-started",
  "denied",
  "approval-required",
  "timed-out",
  "stale",
  "failed",
  "completed",
  "recovery-retryable",
  "recovery-unknown",
  "retry-authorized",
  "retry-consumed",
  "reconciled-completed",
  "reconciled-failed",
  "recovery-exhausted",
])

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

const credentialIdSchema = z.enum(CREDENTIAL_IDS)
const credentialMetadataSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    baseUrl: z.string().trim().url().max(2_000).optional(),
  })
  .strict()
  .optional()
const customPermissionsSchema = z
  .object({
    schemaVersion: z.literal(CUSTOM_PERMISSION_SCHEMA_VERSION),
    projectWrite: z.boolean(),
    shell: z.boolean(),
    network: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
    secrets: z.boolean(),
    subagents: z.boolean(),
    thirdPartyMcp: z.boolean(),
    productMcpRead: z.boolean(),
    productMcpWrite: z.boolean(),
    productMcpTier3: z.boolean(),
  })
  .strict()
const permissionModeSchema = z.enum(permissionModes)

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
    "get_credential_status",
    {
      description: "Inspect managed credential status without returning plaintext.",
      inputSchema: { id: credentialIdSchema.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(await getCredentialStatus(input)),
  )
  server.registerTool(
    "set_or_replace_credential",
    {
      description: "Write one managed credential. Plaintext is accepted but never returned.",
      inputSchema: {
        id: credentialIdSchema,
        secret: z
          .string()
          .min(1)
          .max(64 * 1024),
        metadata: credentialMetadataSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await setOrReplaceCredential(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "migrate_legacy_credential",
    {
      description:
        "Attempt an acknowledged legacy credential migration. Plaintext is never returned.",
      inputSchema: {
        id: credentialIdSchema,
        legacyKey: z.enum([
          "onboarding:codex-api-key",
          "agents:openai-api-key",
          "agents:claude-custom-config",
        ]),
        secret: z
          .string()
          .min(1)
          .max(64 * 1024),
        expectedFingerprint: z.string().regex(/^[a-f0-9]{12}$/),
        metadata: credentialMetadataSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await migrateLegacyCredential(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "remove_credential",
    {
      description: "Remove one managed credential and return status only.",
      inputSchema: { id: credentialIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await removeCredential(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_settings_state",
    {
      description:
        "Inspect the Settings release registry, search results, provider scope, and stable targets.",
      inputSchema: {
        query: z.string().max(200).optional(),
        showDevelopment: z.boolean().optional(),
        availableProviders: z
          .array(
            z.enum([
              "claude",
              "codex",
              "cursor",
              "opencode",
              "openrouter",
              "nanogpt",
              "openai-voice",
            ]),
          )
          .optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const registry = getSettingsState(input)
      try {
        return result({
          ...registry,
          renderer: await getLiveSettingsState(),
          rendererWarning: null,
        })
      } catch (error) {
        return result({
          ...registry,
          renderer: null,
          rendererWarning: error instanceof Error ? error.message : "Live renderer unavailable",
        })
      }
    },
  )
  server.registerTool(
    "control_settings",
    {
      description: "Control the production Settings renderer and return its resulting live state.",
      inputSchema: {
        operation: z.enum(["open", "close", "navigate", "search", "select-project"]),
        tab: z.string().max(100).optional(),
        query: z.string().max(200).optional(),
        targetId: z.string().max(200).optional(),
        projectId: z.string().max(200).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        if (input.operation === "navigate" && !input.tab) {
          throw new Error("tab is required for navigate")
        }
        if (input.operation === "select-project" && input.projectId === undefined) {
          throw new Error("projectId is required for select-project; use null to clear")
        }
        return result(await controlSettings(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_visible_copy_search_state",
    {
      description:
        "Inspect bounded visible chat copy/search text without private tool or attachment payloads.",
      inputSchema: {
        subChatId: z.string().min(1),
        query: z.string().max(200).optional(),
        messageLimit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(getVisibleCopySearchState(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "select_test_chat",
    {
      description: "Select one active persisted test chat in the live renderer by exact IDs.",
      inputSchema: {
        chatId: z.string().min(1).max(200),
        subChatId: z.string().min(1).max(200),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const selection = resolveTestChatSelection(input)
        return result(await requestDevRendererControl({ command: "chat.select", ...selection }))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_shortcut_state",
    {
      description:
        "Inspect the live renderer shortcut inventory, resolved bindings, and diagnostics.",
      inputSchema: { platform: z.enum(["darwin", "win32", "linux"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      result(await requestDevRendererControl({ command: "shortcuts.get", ...input })),
  )
  server.registerTool(
    "mutate_shortcut_binding",
    {
      description: "Set or reset live shortcut preferences through the production renderer store.",
      inputSchema: {
        operation: z.enum(["set", "reset", "reset-all"]),
        actionId: z.string().min(1).max(100).optional(),
        hotkey: z.string().min(1).max(100).optional(),
        platform: z.enum(["darwin", "win32", "linux"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await requestDevRendererControl({ command: "shortcuts.mutate", ...input }))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "list_provider_extensions",
    {
      description:
        "List provider-scoped extension identities and capabilities without returning extension content.",
      inputSchema: { projectId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await listRegisteredProviderExtensions(input))
      } catch (error) {
        return failure(error)
      }
    },
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
    "prepare_product_mcp_caller",
    {
      description: "Create an isolated global Codex or Claude caller fixture with exposure off.",
      inputSchema: {
        harness: z.enum(["codex", "claude"]),
        name: z.string().trim().min(1).max(200).optional(),
        repoPath: z.string().min(1).optional(),
        permissionMode: z
          .enum(["read-only", "ask-before-edits", "auto-edit-project-only", "full-access"])
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(prepareProductMcpCaller(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "set_product_mcp_exposure",
    {
      description: "Enable or disable product MCP for one isolated test caller chat.",
      inputSchema: { chatId: z.string().min(1), enabled: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(setProductMcpTestExposure(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "start_product_mcp_call",
    {
      description: "Start one real product stdio call and return immediately with a pollable ID.",
      inputSchema: {
        chatId: z.string().min(1),
        runId: z.string().min(1),
        toolName: z.string().min(1).max(200),
        arguments: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return result(startProductMcpTestCall(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_product_mcp_call",
    {
      description: "Read one bounded product stdio test-call result.",
      inputSchema: { callId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(getProductMcpTestCall(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "reply_product_mcp_approval",
    {
      description: "Resolve one pending product MCP test approval exactly once.",
      inputSchema: {
        approvalId: z.string().min(1),
        decision: z.enum(["approve", "deny"]),
        grantSession: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(replyProductMcpApproval(input)),
  )
  server.registerTool(
    "get_product_mcp_state",
    {
      description: "Read exposure, approvals, audit, lineage, and run state for one caller.",
      inputSchema: {
        chatId: z.string().min(1),
        toolName: z.string().trim().min(1).max(200).optional(),
        decision: productMcpAuditDecisionSchema.optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        cursor: z.string().min(1).max(512).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(getProductMcpState(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_product_mcp_renderer_state",
    {
      description: "Read bounded live renderer state for one isolated product-MCP caller.",
      inputSchema: { chatId: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await getProductMcpRendererState(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "control_product_mcp_renderer",
    {
      description: "Open or close audit history for one isolated product-MCP caller renderer.",
      inputSchema: {
        chatId: z.string().min(1).max(200),
        operation: z.enum(["open-audit", "close-audit"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await controlProductMcpRenderer(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "manage_product_mcp_recovery",
    {
      description: "List or explicitly resolve terminal-audit recovery claims.",
      inputSchema: {
        chatId: z.string().min(1),
        action: z.enum(["list", "authorize-retry", "reconcile-completed", "reconcile-failed"]),
        invocationId: z.string().min(1).max(256).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(manageProductMcpRecovery(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "cleanup_product_mcp_caller",
    {
      description: "Cancel and archive one isolated product-MCP caller fixture after testing.",
      inputSchema: { chatId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(cleanupProductMcpCaller(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "cancel_product_mcp_child_run",
    {
      description: "Cancel one pending or active spawned child owned by an isolated MCP caller.",
      inputSchema: {
        chatId: z.string().min(1).max(200),
        childChatId: z.string().min(1).max(200),
        runId: z.string().min(1).max(200),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await cancelProductMcpChildRun(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "list_agent_input_requests",
    {
      description: "List live provider-neutral input requests without hidden provider data.",
      inputSchema: { chatId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(listAgentInputRequests(input)),
  )
  server.registerTool(
    "get_renderer_agent_input_state",
    {
      description: "Inspect active renderer question ownership and dialog visibility.",
      inputSchema: { subChatId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(getRendererAgentInputState(input)),
  )
  server.registerTool(
    "ensure_test_project",
    {
      description: "Register or restore this development checkout as a local test project.",
      inputSchema: { name: z.string().min(1).max(200).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(ensureTestProject(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "archive_test_project",
    {
      description: "Reversibly archive an idle test project for this development checkout.",
      inputSchema: { projectId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(archiveTestProject(input))
      } catch (error) {
        return failure(error)
      }
    },
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
    "open_test_chat",
    {
      description: "Select one existing test chat in the live renderer.",
      inputSchema: { chatId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(openTestChat(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "create_test_orchestration_fixture",
    {
      description:
        "Create a read-only Codex or Claude project-chat fixture for orchestration testing.",
      inputSchema: {
        projectPath: z.string().min(1),
        projectName: z.string().min(1).max(200).optional(),
        chatName: z.string().min(1).max(200).optional(),
        harness: z.enum(["codex", "claude-code"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(createTestOrchestrationFixture(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "create_test_orchestration",
    {
      description: "Create or attach a durable test orchestration through production services.",
      inputSchema: {
        request: z.record(z.string(), z.unknown()),
        deferScheduling: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ request, deferScheduling }) => {
      try {
        return result(createTestOrchestration(request, { deferScheduling }))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_test_orchestration",
    {
      description: "Read one durable test orchestration overview and lineage.",
      inputSchema: { taskId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(getTestOrchestration(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "mutate_test_orchestration",
    {
      description: "Tick, control, progress, retry, replace, or add a test orchestration worker.",
      inputSchema: {
        taskId: z.string().min(1),
        action: z.enum([
          "tick",
          "pause",
          "resume",
          "stop",
          "retry",
          "replace",
          "add",
          "progress",
          "archive",
        ]),
        agentId: z.string().min(1).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(mutateTestOrchestration(input))
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
    "send_test_prompt",
    {
      description:
        "Append one bounded database-only visible test prompt without launching a provider run.",
      inputSchema: {
        subChatId: z.string().min(1),
        prompt: z.string().trim().min(1).max(20_000),
        noEdit: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(sendTestPrompt(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "mutate_project_provider_extension",
    {
      description:
        "Create, update, or delete one project-scoped provider extension through the production adapter.",
      inputSchema: {
        operation: z.enum(["create", "update", "delete"]),
        provider: z.enum(["claude", "codex", "cursor", "opencode"]),
        kind: z.enum(["skill", "command", "plugin", "custom-agent", "mcp"]),
        projectId: z.string().min(1),
        sourceId: z.string().min(1).optional(),
        name: z.string().min(1).max(64),
        description: z.string().max(1_024).optional(),
        content: z.string().max(1_000_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await mutateRegisteredProjectProviderExtension(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "get_permission_state",
    {
      description: "Inspect permission defaults and optional exact chat custom capabilities.",
      inputSchema: { chatId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await getPermissionState(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "set_permission_default",
    {
      description: "Set the global permission default with explicit custom capabilities.",
      inputSchema: {
        mode: permissionModeSchema,
        customPermissions: customPermissionsSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await setPermissionDefault(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "set_chat_permission",
    {
      description: "Set one chat or all chats permission state through production persistence.",
      inputSchema: {
        chatId: z.string().min(1),
        mode: permissionModeSchema,
        scope: z.enum(["all-chats", "current-chat"]).optional(),
        rememberBehavior: z.enum(["ask", "current-chat", "all-chats"]).optional(),
        customPermissions: customPermissionsSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await setChatPermission(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "preview_permission",
    {
      description:
        "Preview an exact harness mapping; cwd derives only from an optional persisted chat.",
      inputSchema: {
        harness: z.enum(["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt"]),
        mode: permissionModeSchema,
        chatMode: z.enum(["plan", "agent"]).optional(),
        chatId: z.string().min(1).optional(),
        customPermissions: customPermissionsSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(await previewPermission(input))
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
    "inject_agent_input_request",
    {
      description: "Inject a bounded provider-neutral input request into one live test chat.",
      inputSchema: {
        subChatId: z.string().min(1),
        harness: z.enum([
          "claude-code",
          "codex",
          "cursor-agent",
          "openrouter",
          "nanogpt",
          "local",
          "custom",
        ]),
        model: z.string().min(1).optional(),
        timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(2_000),
              header: z.string().min(1).max(120).optional(),
              options: z
                .array(
                  z.object({
                    label: z.string().min(1).max(200),
                    description: z.string().min(1).max(500).optional(),
                  }),
                )
                .max(12)
                .optional(),
              multiSelect: z.boolean().optional(),
              allowCustom: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(8),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(injectAgentInputRequest(input))
      } catch (error) {
        return failure(error)
      }
    },
  )
  server.registerTool(
    "reply_agent_input_request",
    {
      description: "Answer, skip, or cancel one injected provider-neutral input request.",
      inputSchema: {
        requestId: z.string().min(1),
        action: z.enum(["answer", "skip", "cancel"]),
        mode: z.enum(["structured", "chat"]).optional(),
        answers: z.record(z.string(), z.array(z.string().min(1).max(4_000)).min(1)).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return result(replyAgentInputRequest(input))
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
    userDataPath: input.userDataPath,
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
