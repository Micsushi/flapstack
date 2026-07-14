import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"
import {
  SAFE_CHATGPT_CODEX_MODEL,
  normalizeCodexStatus,
} from "../src/main/lib/mcp-test-control/codex-status"
import {
  appendUserMessage,
  findLastAssistantMessage,
  getMessageText,
  parseStoredMessages,
  summarizeMessages,
} from "../src/main/lib/mcp-test-control/messages"
import {
  devMcpExposedToolNames,
  devMcpTestControlTools,
  getDevMcpTool,
} from "../src/main/lib/mcp-test-control/registry"
import { redactSecretLikeText, resolveCommandPath } from "../src/main/lib/mcp-test-control/shell"
import { hasValidBearerToken, startDevMcpServer } from "../src/main/lib/mcp-test-control/server"
import { buildVisibleCopySearchState } from "../src/main/lib/mcp-test-control/settings"
import {
  parseDevMcpSettingsInvalidation,
  parseDevRendererControlRequest,
} from "../src/shared/dev-renderer-control"
import {
  listAgentInputRequests,
  replyAgentInputRequest,
} from "../src/main/lib/mcp-test-control/service"
import { agentInputLifecycle } from "../src/main/lib/agent-input/service"
import {
  listDevAgentInputRendererStates,
  recordDevAgentInputRendererState,
} from "../src/main/lib/mcp-test-control/renderer-state"
import * as schema from "../src/main/lib/db/schema"
import { closeDatabase, getDatabase } from "../src/main/lib/db"
import {
  cleanupCarryoverRunFixture,
  controlVoiceSettings,
  createCarryoverRunFixture,
  getCarryoverRunFixtureFiles,
  getRunChangeState,
  getVoiceState,
  undoRunChange,
} from "../src/main/lib/mcp-test-control/carryover-controls"

describe("dev MCP test-control registry", () => {
  it("defines the today-sized testing tool surface", () => {
    expect(devMcpTestControlTools.map((tool) => tool.name)).toEqual([
      "get_test_environment",
      "get_harness_status",
      "get_provider_status",
      "get_credential_status",
      "set_or_replace_credential",
      "migrate_legacy_credential",
      "remove_credential",
      "get_settings_state",
      "control_settings",
      "get_settings_legacy_state",
      "mutate_settings_legacy_state",
      "get_visible_copy_search_state",
      "select_test_chat",
      "get_shortcut_state",
      "mutate_shortcut_binding",
      "list_provider_extensions",
      "list_test_targets",
      "get_chat_state",
      "get_run_state",
      "get_reasoning_timer_state",
      "get_voice_state",
      "control_voice_settings",
      "get_usage_state",
      "refresh_usage_state",
      "get_run_change_state",
      "undo_run_change",
      "create_carryover_run_fixture",
      "get_carryover_run_fixture_files",
      "cleanup_carryover_run_fixture",
      "get_renderer_carryover_state",
      "control_renderer_carryover",
      "list_pending_approvals",
      "get_opencode_logs",
      "prepare_product_mcp_caller",
      "set_product_mcp_exposure",
      "start_product_mcp_call",
      "get_product_mcp_call",
      "reply_product_mcp_approval",
      "get_product_mcp_state",
      "manage_product_mcp_recovery",
      "cleanup_product_mcp_caller",
      "list_agent_input_requests",
      "get_renderer_agent_input_state",
      "ensure_test_project",
      "archive_test_project",
      "create_test_chat",
      "open_test_chat",
      "archive_test_chat",
      "mutate_project_provider_extension",
      "get_permission_state",
      "set_permission_default",
      "set_permission_change_behavior",
      "set_chat_permission",
      "preview_permission",
      "get_permission_ui_state",
      "control_permission_ui",
      "set_chat_run_config",
      "send_test_prompt",
      "launch_test_run",
      "launch_harness_test_run",
      "list_codex_permission_requests",
      "reply_codex_permission_request",
      "inject_agent_input_request",
      "reply_agent_input_request",
      "reply_approval",
      "cancel_run",
      "wait_for_run",
      "verify_run_artifacts",
      "run_project_check",
      "openspec_validate",
      "create_test_orchestration_fixture",
      "create_test_orchestration",
      "get_test_orchestration",
      "mutate_test_orchestration",
    ])
    expect(getDevMcpTool("get_harness_status")?.tier).toBe(0)
    expect(getDevMcpTool("run_project_check")?.tier).toBe(2)
  })
})

describe("dev renderer Settings control boundary", () => {
  it("accepts bounded Settings commands and rejects malformed project payloads", () => {
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "settings.control",
        operation: "navigate",
        tab: "permissions",
        targetId: "permissions-default",
      }),
    ).toMatchObject({ operation: "navigate", tab: "permissions" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "settings.control",
        operation: "select-project",
        project: { id: "project-id", name: "Project", path: 42 },
      }),
    ).toBeNull()
  })

  it("accepts only known Settings invalidation domains", () => {
    expect(
      parseDevMcpSettingsInvalidation({
        domains: ["credentials", "credentials", "permissions"],
      }),
    ).toEqual({ domains: ["credentials", "permissions"] })
    expect(parseDevMcpSettingsInvalidation({ domains: ["credentials", "filesystem"] })).toBeNull()
    expect(parseDevMcpSettingsInvalidation({ domains: [] })).toBeNull()
  })

  it("accepts bounded legacy and permission UI controls", () => {
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "settings.legacy.mutate",
        activeTab: "beta",
        ctrlTabTarget: "agents",
      }),
    ).toMatchObject({ command: "settings.legacy.mutate", activeTab: "beta" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "settings.legacy.mutate",
        ctrlTabTarget: "unsafe",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "permissions.ui.control",
        operation: "set-custom-capability",
        capability: "network",
        enabled: false,
      }),
    ).toMatchObject({ operation: "set-custom-capability", capability: "network" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "permissions.ui.control",
        operation: "set-scope",
      }),
    ).toBeNull()
  })

  it("accepts only bounded chat-selection identities from the main process", () => {
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.select",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        project: { id: "project-1", name: "Project", path: "/registered/project" },
      }),
    ).toMatchObject({ command: "chat.select", chatId: "chat-1", subChatId: "sub-chat-1" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.select",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        project: { id: "project-1", name: "Project", path: 42 },
      }),
    ).toBeNull()
  })

  it("accepts only enumerated carryover reads and controls", () => {
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "carryover.get",
        surface: "voice",
      }),
    ).toMatchObject({ command: "carryover.get", surface: "voice" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "carryover.control",
        surface: "run-change",
        operation: "open-review",
        runId: "run-1",
      }),
    ).toMatchObject({ operation: "open-review", runId: "run-1" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "carryover.control",
        surface: "voice",
        operation: "click-anything",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "carryover.control",
        surface: "reasoning",
        operation: "toggle",
        index: 101,
      }),
    ).toBeNull()
  })
})

describe("dev MCP carryover controls", () => {
  it("updates bounded Voice preferences and returns history counts without transcript content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-voice-"))
    const previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
    const previousDatabasePath = process.env.FLAPSTACK_DB_PATH
    process.env.FLAPSTACK_CONFIG_DIR = dir
    const databasePath = join(dir, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") })
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = databasePath
    try {
      expect(controlVoiceSettings({ rate: 1.4, preferOffline: false })).toMatchObject({
        rate: 1.4,
        preferOffline: false,
      })
      const state = await getVoiceState()
      expect(state.settings).toMatchObject({ rate: 1.4, preferOffline: false })
      expect(state.history).toEqual({
        count: expect.any(Number),
        transcriptionCount: expect.any(Number),
        speechCount: expect.any(Number),
        withAudioCount: expect.any(Number),
      })
      expect(JSON.stringify(state.history)).not.toContain("text")
    } finally {
      closeDatabase()
      if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
      else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
      if (previousDatabasePath === undefined) delete process.env.FLAPSTACK_DB_PATH
      else process.env.FLAPSTACK_DB_PATH = previousDatabasePath
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it("creates and cleans isolated run fixtures for non-overlap and conflict proof", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-carryover-"))
    const previousDatabasePath = process.env.FLAPSTACK_DB_PATH
    const databasePath = join(dir, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") })
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = databasePath
    const fixtureIds: string[] = []
    try {
      const nonOverlap = await createCarryoverRunFixture({ laterEdit: "non-overlap" })
      fixtureIds.push(nonOverlap.projectId)
      expect(nonOverlap.backgroundSubChatId).toEqual(expect.any(String))
      const review = await getRunChangeState({ runId: nonOverlap.runId, includeReview: true })
      expect(review).toMatchObject({ fileCount: 2, recoverable: true })
      expect(review.diff).toContain("alpha from response")
      expect(review.diff).toContain("beta from response")
      expect(await undoRunChange({ runId: nonOverlap.runId })).toMatchObject({
        success: true,
        alreadyUndone: false,
        files: expect.arrayContaining(["alpha.txt", "beta.txt"]),
      })
      expect(await getCarryoverRunFixtureFiles({ projectId: nonOverlap.projectId })).toEqual({
        alpha: "alpha before\nmanual anchor\nomega from later manual edit\n",
        beta: "beta before\n",
      })

      const overlap = await createCarryoverRunFixture({ laterEdit: "overlap" })
      fixtureIds.push(overlap.projectId)
      const beforeConflict = await getCarryoverRunFixtureFiles({ projectId: overlap.projectId })
      expect(await undoRunChange({ runId: overlap.runId })).toMatchObject({
        success: false,
        conflicts: [expect.objectContaining({ filePath: "alpha.txt" })],
      })
      expect(await getCarryoverRunFixtureFiles({ projectId: overlap.projectId })).toEqual(
        beforeConflict,
      )
    } finally {
      for (const projectId of fixtureIds) {
        await cleanupCarryoverRunFixture({ projectId }).catch(() => {})
      }
      expect(getDatabase().select().from(schema.filesystemRootRegistrations).all()).toEqual([])
      closeDatabase()
      if (previousDatabasePath === undefined) delete process.env.FLAPSTACK_DB_PATH
      else process.env.FLAPSTACK_DB_PATH = previousDatabasePath
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

describe("dev MCP transport", () => {
  it("validates bearer tokens without prefix or length ambiguity", () => {
    expect(hasValidBearerToken("Bearer exact-token", "exact-token")).toBe(true)
    expect(hasValidBearerToken("Bearer wrong-token", "exact-token")).toBe(false)
    expect(hasValidBearerToken(undefined, "exact-token")).toBe(false)
  })

  it("stays disabled when the lifecycle gate is off", async () => {
    await expect(
      startDevMcpServer({
        enabled: false,
        userDataPath: tmpdir(),
        checkout: "/repo",
        profile: "Flapstack",
      }),
    ).resolves.toBeNull()
  })

  it("rejects unauthenticated calls and lists tools through the MCP SDK", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-test-"))
    const handle = await startDevMcpServer({
      enabled: true,
      userDataPath: dir,
      checkout: "/repo",
      profile: "Flapstack Dev Test",
      pid: 123,
    })
    expect(handle).not.toBeNull()
    try {
      expect(handle!.descriptor.userDataPath).toBe(dir)
      const unauthorized = await fetch(handle!.descriptor.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
      expect(unauthorized.status).toBe(401)

      const client = new Client({ name: "flapstack-test", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(handle!.descriptor.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${handle!.descriptor.token}` },
        },
      })
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(devMcpExposedToolNames)
      const settings = await client.callTool({
        name: "get_settings_state",
        arguments: { query: "default permission", availableProviders: [] },
      })
      expect(settings.structuredContent).toMatchObject({
        result: {
          results: expect.arrayContaining([
            expect.objectContaining({
              tab: "permissions",
              targetId: "permissions-default",
            }),
          ]),
        },
      })
      const controlWithoutRenderer = await client.callTool({
        name: "control_settings",
        arguments: { operation: "open" },
      })
      expect(controlWithoutRenderer.isError).toBe(true)
      expect(JSON.stringify(controlWithoutRenderer.content)).toContain("No live renderer")
      const malformed = await client.callTool({
        name: "set_or_replace_credential",
        arguments: { id: "codex.api-key" },
      })
      expect(malformed.isError).toBe(true)
      expect(JSON.stringify(malformed)).not.toContain('secret":')
      await transport.close()
    } finally {
      await handle?.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates, reads, and controls orchestration through the authenticated live API", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-orchestration-"))
    const databasePath = join(dir, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") })
    process.env.FLAPSTACK_DB_PATH = databasePath
    const handle = await startDevMcpServer({
      enabled: true,
      userDataPath: dir,
      checkout: "/repo",
      profile: "Flapstack Dev Orchestration",
    })
    const client = new Client({ name: "flapstack-orchestration-test", version: "1.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(handle!.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${handle!.descriptor.token}` },
      },
    })
    try {
      await client.connect(transport)
      const fixture = await client.callTool({
        name: "create_test_orchestration_fixture",
        arguments: {
          projectPath: dir,
          projectName: "Project",
          chatName: "Root",
          harness: "codex",
        },
      })
      expect(fixture, JSON.stringify(fixture.content)).not.toMatchObject({ isError: true })
      const fixtureResult = (fixture.structuredContent as { result: any }).result
      const inheritedCustomPermissions = {
        schemaVersion: 1,
        projectWrite: true,
        shell: false,
        network: false,
        git: false,
        browser: false,
        secrets: false,
        subagents: false,
        thirdPartyMcp: false,
        productMcpRead: true,
        productMcpWrite: false,
        productMcpTier3: false,
      }
      sqlite
        .prepare(
          "UPDATE projects SET default_permission_mode = ?, default_custom_permissions = ? WHERE id = ?",
        )
        .run("custom", JSON.stringify(inheritedCustomPermissions), fixtureResult.projectId)
      const inheritedChat = await client.callTool({
        name: "create_test_chat",
        arguments: {
          projectId: fixtureResult.projectId,
          name: "Inherited custom permissions",
          provider: "openrouter",
          model: "openai/gpt-5.2",
        },
      })
      expect(inheritedChat, JSON.stringify(inheritedChat.content)).not.toMatchObject({
        isError: true,
      })
      const inheritedChatResult = (inheritedChat.structuredContent as { result: any }).result
      expect(
        sqlite
          .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = ?")
          .get(inheritedChatResult.chatId),
      ).toEqual({
        permission_mode: "custom",
        custom_permissions: JSON.stringify(inheritedCustomPermissions),
      })
      const cursorChat = await client.callTool({
        name: "create_test_chat",
        arguments: {
          projectId: fixtureResult.projectId,
          name: "Cursor live proof",
          provider: "cursor-agent",
          model: "auto",
        },
      })
      expect(cursorChat, JSON.stringify(cursorChat.content)).not.toMatchObject({ isError: true })
      expect((cursorChat.structuredContent as { result: any }).result).toMatchObject({
        projectId: fixtureResult.projectId,
        provider: "cursor-agent",
        model: "auto",
      })
      const created = await client.callTool({
        name: "create_test_orchestration",
        arguments: {
          request: {
            projectId: fixtureResult.projectId,
            task: { mode: "create", name: "Live API orchestration" },
            initiatingChatId: fixtureResult.chatId,
            maxParallelAgents: 1,
            maxDepth: 4,
            stopConditions: { maxTotalTokens: 10_000 },
            agents: [
              {
                role: "worker",
                prompt: "Perform the live proof.",
                harness: "codex",
                permissionMode: "full-access",
                worktreeStrategy: "none",
                dependencyAgentIds: [],
                completionCriteria: "Proof recorded",
              },
            ],
          },
        },
      })
      const createdResult = (created.structuredContent as { result: any }).result
      const taskId = createdResult.orchestration.taskId as string
      expect(createdResult.aggregate).toMatchObject({ active: 1, queued: 0 })

      const read = await client.callTool({
        name: "get_test_orchestration",
        arguments: { taskId },
      })
      expect((read.structuredContent as { result: any }).result).toMatchObject({
        overview: { orchestration: { taskId, status: "running" } },
        lineage: { taskId },
      })

      const paused = await client.callTool({
        name: "mutate_test_orchestration",
        arguments: { taskId, action: "pause" },
      })
      expect((paused.structuredContent as { result: any }).result.orchestration.status).toBe(
        "paused",
      )
      const rejectedArchive = await client.callTool({
        name: "mutate_test_orchestration",
        arguments: { taskId, action: "archive" },
      })
      expect(rejectedArchive.isError).toBe(true)

      await client.callTool({
        name: "mutate_test_orchestration",
        arguments: { taskId, action: "stop" },
      })
      const archived = await client.callTool({
        name: "mutate_test_orchestration",
        arguments: { taskId, action: "archive" },
      })
      expect((archived.structuredContent as { result: any }).result).toMatchObject({
        taskId,
        archived: true,
      })
      expect(sqlite.prepare("SELECT archived_at FROM tasks WHERE id = ?").get(taskId)).toEqual({
        archived_at: expect.any(Number),
      })
      expect(
        sqlite
          .prepare("SELECT count(*) count FROM chats WHERE task_id = ? AND archived_at IS NULL")
          .get(taskId),
      ).toEqual({ count: 0 })
    } finally {
      await transport.close().catch(() => undefined)
      await handle?.stop()
      closeDatabase()
      sqlite.close()
      delete process.env.FLAPSTACK_DB_PATH
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("dev MCP agent input control", () => {
  it("lists and resolves a provider-neutral live request through the shared owner", async () => {
    const resolution = agentInputLifecycle.create({
      requestId: "dev-request-1",
      chatId: "dev-chat-1",
      runId: "dev-run-1",
      origin: { harness: "claude-code", toolName: "request_user_input" },
      capability: { mode: "native", sameRun: true },
      questions: [
        {
          id: "question-1",
          question: "Continue?",
          options: [{ id: "yes", label: "Yes" }],
          multiSelect: false,
          allowCustom: true,
        },
      ],
      status: "pending",
      createdAt: Date.now(),
    })

    expect(listAgentInputRequests({ chatId: "dev-chat-1" })).toHaveLength(1)
    expect(
      replyAgentInputRequest({
        requestId: "dev-request-1",
        action: "answer",
        answers: { "question-1": ["Yes"] },
      }),
    ).toEqual({ ok: true })
    await expect(resolution).resolves.toMatchObject({ status: "answered" })
    expect(listAgentInputRequests()).toEqual([])
  })

  it("reports bounded renderer ownership without transcript or secret content", () => {
    recordDevAgentInputRendererState({
      parentChatId: "parent-chat",
      subChatId: "renderer-state-test",
      pendingRequestIds: ["request-1"],
      hydratedRequestIds: ["request-1"],
      expiredRequestIds: [],
      dialogOpen: true,
      hydrationError: null,
      observedAt: 42,
    })

    expect(
      listDevAgentInputRendererStates().find((state) => state.subChatId === "renderer-state-test"),
    ).toEqual({
      parentChatId: "parent-chat",
      subChatId: "renderer-state-test",
      pendingRequestIds: ["request-1"],
      hydratedRequestIds: ["request-1"],
      expiredRequestIds: [],
      dialogOpen: true,
      hydrationError: null,
      observedAt: 42,
    })
  })
})

describe("Codex status normalization", () => {
  it("uses the current safe default for ChatGPT-backed Codex auth", () => {
    const status = normalizeCodexStatus("Logged in using ChatGPT")

    expect(status.state).toBe("connected_chatgpt")
    expect(status.recommendedModel).toBe("gpt-5.3-codex-spark/high")
    expect(status.recommendedModel).toBe(SAFE_CHATGPT_CODEX_MODEL)
  })

  it("detects missing login without recommending a dead default", () => {
    const status = normalizeCodexStatus("Not logged in. Please run codex login.")

    expect(status.state).toBe("not_logged_in")
    expect(status.recommendedModel).toBe(SAFE_CHATGPT_CODEX_MODEL)
  })
})

describe("stored message helpers", () => {
  it("appends a dev MCP prompt and summarizes assistant replies", () => {
    const withUser = appendUserMessage("[]", "Reply exactly OK", { devMcpTestPrompt: true })
    const parsed = parseStoredMessages(withUser)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.role).toBe("user")
    expect(getMessageText(parsed[0]!)).toBe("Reply exactly OK")

    const raw = JSON.stringify([
      ...parsed,
      { role: "assistant", parts: [{ type: "text", text: "OK" }] },
    ])
    const summary = summarizeMessages(raw)

    expect(summary.total).toBe(2)
    expect(summary.user).toBe(1)
    expect(summary.assistant).toBe(1)
    expect(summary.lastAssistantText).toBe("OK")
    expect(getMessageText(findLastAssistantMessage(parseStoredMessages(raw))!)).toBe("OK")
  })
})

describe("secret redaction", () => {
  it("keeps dev copy/search inspection on the shared visible-content boundary", () => {
    const state = buildVisibleCopySearchState(
      JSON.stringify([
        {
          id: "message-1",
          role: "assistant",
          parts: [
            { type: "text", text: "visible answer" },
            { type: "reasoning", text: "visible reasoning" },
            { type: "file-content", content: "never-return-file-secret" },
            { type: "tool-Bash", input: { command: "never-return-command-secret" } },
          ],
        },
      ]),
      "reasoning",
    )
    expect(state).toMatchObject({ matchCount: 1 })
    expect(state.messages[0]?.text).toContain("visible answer")
    expect(state.messages[0]?.text).toContain("visible reasoning")
    expect(JSON.stringify(state)).not.toContain("never-return")
  })

  it("redacts common token shapes from command output", () => {
    expect(
      redactSecretLikeText(
        "Authorization: Bearer abc.def\noauth_token: secret-token\nsk-test123456789",
      ),
    ).toContain("Bearer [redacted]")
    expect(
      redactSecretLikeText(
        "Authorization: Bearer abc.def\noauth_token: secret-token\nsk-test123456789",
      ),
    ).toContain("oauth_token=[redacted]")
    expect(
      redactSecretLikeText(
        "Authorization: Bearer abc.def\noauth_token: secret-token\nsk-test123456789",
      ),
    ).toContain("sk-[redacted]")
  })

  it("rejects unsafe command lookup names before spawning a shell", async () => {
    await expect(resolveCommandPath("node; echo unsafe")).resolves.toBeNull()
  })
})
