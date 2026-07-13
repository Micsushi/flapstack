import { z } from "zod"
import { getDevMcpTool, devMcpTestControlTools } from "../../mcp-test-control/registry"
import {
  controlSettings,
  getHarnessStatusForRepo,
  getSettingsState,
  getLiveSettingsState,
  getVisibleCopySearchState,
  getTestEnvironment,
  listTestTargets,
  openspecValidate,
  runProjectCheck,
  sendTestPrompt,
  setChatRunConfig,
  verifyRunArtifacts,
  waitForRun,
} from "../../mcp-test-control/service"
import { publicProcedure, router } from "../index"
import { recordDevAgentInputRendererState } from "../../mcp-test-control/renderer-state"

const repoPathSchema = z.string().optional()
const settingsProviderSchema = z.enum([
  "claude",
  "codex",
  "cursor",
  "opencode",
  "openrouter",
  "nanogpt",
  "openai-voice",
])

export const devMcpTestControlRouter = router({
  describe: publicProcedure.query(() => ({
    enabled: true,
    transport: "trpc-dev-bridge",
    reason:
      "Dev-only MCP-shaped test-control tools. Actual MCP transport can wrap this registry after Stage 1 lands.",
    tools: devMcpTestControlTools,
  })),

  getTestEnvironment: publicProcedure
    .input(z.object({ repoPath: repoPathSchema }).optional())
    .query(({ input }) => getTestEnvironment(input?.repoPath)),

  getHarnessStatus: publicProcedure
    .input(z.object({ probeCli: z.boolean().optional(), repoPath: repoPathSchema }).optional())
    .query(({ input }) => getHarnessStatusForRepo(input)),

  listTestTargets: publicProcedure.query(() => listTestTargets()),

  getSettingsState: publicProcedure
    .input(
      z
        .object({
          query: z.string().max(200).optional(),
          showDevelopment: z.boolean().optional(),
          availableProviders: z.array(settingsProviderSchema).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => ({
      ...getSettingsState(input),
      renderer: await getLiveSettingsState(),
    })),

  controlSettings: publicProcedure
    .input(
      z.object({
        operation: z.enum(["open", "close", "navigate", "search", "select-project"]),
        tab: z.string().max(100).optional(),
        query: z.string().max(200).optional(),
        targetId: z.string().max(200).optional(),
        projectId: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(({ input }) => controlSettings(input)),

  getVisibleCopySearchState: publicProcedure
    .input(
      z.object({
        subChatId: z.string().min(1),
        query: z.string().max(200).optional(),
        messageLimit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(({ input }) => getVisibleCopySearchState(input)),

  reportAgentInputRendererState: publicProcedure
    .input(
      z.object({
        parentChatId: z.string(),
        subChatId: z.string(),
        pendingRequestIds: z.array(z.string()).max(32),
        hydratedRequestIds: z.array(z.string()).max(32),
        expiredRequestIds: z.array(z.string()).max(32),
        dialogOpen: z.boolean(),
        hydrationError: z.string().max(2_000).nullable(),
        observedAt: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ input }) => recordDevAgentInputRendererState(input)),

  setChatRunConfig: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        harness: z.enum(["codex", "claude-code"]),
        model: z.string().optional(),
        permissionMode: z.string().optional(),
        worktreePath: z.string().optional(),
      }),
    )
    .mutation(({ input }) => setChatRunConfig(input)),

  sendTestPrompt: publicProcedure
    .input(z.object({ subChatId: z.string(), prompt: z.string(), noEdit: z.boolean().optional() }))
    .mutation(({ input }) => sendTestPrompt(input)),

  waitForRun: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        afterAssistantCount: z.number().int().nonnegative().optional(),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
        pollMs: z.number().int().positive().max(10_000).optional(),
      }),
    )
    .query(({ input }) => waitForRun(input)),

  verifyRunArtifacts: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        expectedAssistantText: z.string().optional(),
        noEditExpected: z.boolean().optional(),
      }),
    )
    .query(({ input }) => verifyRunArtifacts(input)),

  runProjectCheck: publicProcedure
    .input(
      z.object({ repoPath: repoPathSchema, timeoutMs: z.number().int().positive().optional() }),
    )
    .mutation(({ input }) => runProjectCheck(input)),

  openspecValidate: publicProcedure
    .input(
      z.object({ repoPath: repoPathSchema, timeoutMs: z.number().int().positive().optional() }),
    )
    .mutation(({ input }) => openspecValidate(input)),

  invoke: publicProcedure
    .input(z.object({ tool: z.string(), input: z.unknown().optional() }))
    .mutation(async ({ input }) => {
      const tool = getDevMcpTool(input.tool)
      if (!tool) throw new Error(`Unknown dev MCP test-control tool: ${input.tool}`)

      switch (tool.name) {
        case "get_test_environment":
          return getTestEnvironment()
        case "get_harness_status":
          return getHarnessStatusForRepo()
        case "get_settings_state":
          return getSettingsState()
        case "list_test_targets":
          return listTestTargets()
        case "run_project_check":
          return runProjectCheck({})
        case "openspec_validate":
          return openspecValidate({})
        default:
          throw new Error(`Tool ${tool.name} requires its typed tRPC procedure.`)
      }
    }),
})
