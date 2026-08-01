import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: { getPath: () => process.env.FLAPSTACK_CONFIG_DIR || "/tmp" },
  BrowserWindow: { getAllWindows: () => [] },
}))
import {
  SAFE_CHATGPT_CODEX_MODEL,
  normalizeCodexStatus,
} from "../src/main/lib/mcp-test-control/codex-status"
import {
  appendUserMessage,
  buildActivityAssistant,
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
import {
  hasValidBearerToken,
  stage4Failure,
  stage4OperationalFailure,
  startDevMcpServer,
} from "../src/main/lib/mcp-test-control/server"
import { buildVisibleCopySearchState } from "../src/main/lib/mcp-test-control/settings"
import {
  parseDevMcpSettingsInvalidation,
  parseDevRendererControlRequest,
} from "../src/shared/dev-renderer-control"
import {
  cleanupAllTestRendererCaptures,
  archiveTestTask,
  buildStage6PerformanceMessages,
  listAgentInputRequests,
  replyAgentInputRequest,
  resolveDevRendererControlTimeoutMs,
  stage6PerformanceRendererSelectionTimeoutMs,
} from "../src/main/lib/mcp-test-control/service"
import { STAGE4_OPERATIONAL_ACTIONS } from "../src/main/lib/mcp-test-control/stage4-operations"
import {
  STAGE4_PROFILE_MUTATION_ACTIONS,
  STAGE4_PROFILE_READ_ACTIONS,
  STAGE4_RUNTIME_MUTATION_ACTIONS,
} from "../src/main/lib/mcp-test-control/stage4-runtime-profiles"
import {
  configureStage4OwnershipJournal,
  resetStage4OwnershipForTests,
} from "../src/main/lib/mcp-test-control/stage4-ownership"
import { agentInputLifecycle } from "../src/main/lib/agent-input/service"
import {
  listDevAgentInputRendererStates,
  recordDevAgentInputRendererState,
} from "../src/main/lib/mcp-test-control/renderer-state"
import * as schema from "../src/main/lib/db/schema"
import { closeDatabase, getDatabase } from "../src/main/lib/db"
import {
  cleanupCarryoverRunFixture,
  cleanupUsageUiFixture,
  cleanupVoiceUiFixture,
  controlVoiceSettings,
  createCarryoverRunFixture,
  createUsageUiFixture,
  createVoiceUiFixture,
  getCarryoverRunFixtureFiles,
  getRunChangeState,
  getVoiceState,
  requireVoiceUiFixture,
  undoRunChange,
} from "../src/main/lib/mcp-test-control/carryover-controls"

describe("dev renderer control timeouts", () => {
  it("keeps platform defaults unchanged without an explicit timeout", () => {
    expect(resolveDevRendererControlTimeoutMs(undefined, "win32")).toBe(15_000)
    expect(resolveDevRendererControlTimeoutMs(undefined, "linux")).toBe(5_000)
  })

  it("extends selection only inside the isolated Stage 6 performance profile", () => {
    expect(stage6PerformanceRendererSelectionTimeoutMs({})).toBeUndefined()
    expect(
      stage6PerformanceRendererSelectionTimeoutMs({
        FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "0",
      }),
    ).toBeUndefined()
    expect(
      stage6PerformanceRendererSelectionTimeoutMs({
        FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1",
      }),
    ).toBe(180_000)
  })

  it("fails closed above the renderer control timeout ceiling", () => {
    expect(resolveDevRendererControlTimeoutMs(180_000, "win32")).toBe(180_000)
    expect(() => resolveDevRendererControlTimeoutMs(180_001, "win32")).toThrow(/between 1 and/)
    expect(() => resolveDevRendererControlTimeoutMs(0, "win32")).toThrow(/between 1 and/)
  })
})

describe("Stage 6 long-chat fixture", () => {
  it("builds 100 paragraph-like back-and-forth exchanges", () => {
    const messages = buildStage6PerformanceMessages(200)

    expect(messages).toHaveLength(200)
    expect(messages.filter((message) => message.role === "user")).toHaveLength(100)
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(100)
    expect(
      messages.every(
        (message) =>
          message.parts[0]?.type === "text" && (message.parts[0].text?.length ?? 0) >= 200,
      ),
    ).toBe(true)
    expect(messages.at(-1)?.parts[0]?.text).toContain("stage6-target-199")
  })
})

describe("dev MCP test-control registry", () => {
  it("serializes Stage 4 failures without raw path-bearing messages", () => {
    const response = stage4Failure(
      new Error(
        "Could not open C:\\Users\\sushi\\private\\repo or /home/sushi/private/repo with Bearer abcdefghijklmnop",
      ),
    )
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain("C:\\Users\\sushi")
    expect(serialized).not.toContain("/home/sushi")
    expect(serialized).not.toContain("abcdefghijklmnop")
    expect(serialized).toContain("[path:")
  })

  it("redacts operational Stage 4 failures at the server boundary", () => {
    const response = stage4OperationalFailure(
      new Error(
        "Failed at C:\\Users\\sushi\\private\\repo with Bearer abc.def and sk-secret123456",
      ),
    )
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain("C:\\Users\\sushi")
    expect(serialized).not.toContain("abc.def")
    expect(serialized).not.toContain("sk-secret")
  })

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
      "copy_test_chat_history",
      "get_renderer_orchestration_state",
      "control_electron_performance_measurement",
      "provision_stage6_performance_fixture",
      "get_shortcut_state",
      "get_product_mcp_renderer_state",
      "cancel_product_mcp_child_run",
      "control_product_mcp_renderer",
      "mutate_shortcut_binding",
      "list_provider_extensions",
      "list_test_targets",
      "get_chat_state",
      "get_run_state",
      "get_reasoning_timer_state",
      "get_voice_state",
      "control_voice_settings",
      "create_voice_ui_fixture",
      "cleanup_voice_ui_fixture",
      "get_renderer_voice_ui_state",
      "control_renderer_voice_ui",
      "get_usage_state",
      "refresh_usage_state",
      "create_usage_ui_fixture",
      "cleanup_usage_ui_fixture",
      "get_renderer_usage_ui_state",
      "control_renderer_usage_ui",
      "get_run_change_state",
      "undo_run_change",
      "create_carryover_run_fixture",
      "get_carryover_run_fixture_files",
      "cleanup_carryover_run_fixture",
      "get_renderer_carryover_state",
      "capture_test_renderer",
      "cleanup_test_renderer_capture",
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
      "get_renderer_agent_input_navigation_state",
      "navigate_agent_input_notification",
      "ensure_test_project",
      "archive_test_project",
      "create_test_chat",
      "open_test_chat",
      "archive_test_task",
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
      "get_stage4_operational_state",
      "mutate_stage4_operational_state",
      "cleanup_stage4_owned_runtime_profiles",
      "get_stage4_runtime_state",
      "mutate_stage4_runtime",
      "get_stage4_profile_state",
      "mutate_stage4_profile",
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
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "agent-input.get",
      }),
    ).toMatchObject({ command: "agent-input.get" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "usage-ui.control",
        operation: "show-all",
        target: "samples",
      }),
    ).toMatchObject({ command: "usage-ui.control", target: "samples" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "usage-ui.control",
        operation: "scroll-to",
        target: "provider-states",
      }),
    ).toMatchObject({ command: "usage-ui.control", target: "provider-states" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "usage-ui.control",
        operation: "show-all",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "voice-ui.control",
        operation: "copy-history",
        historyId: "voice-history-id",
      }),
    ).toMatchObject({ command: "voice-ui.control", historyId: "voice-history-id" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "voice-ui.control",
        operation: "copy-history",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "voice-ui.control",
        operation: "set-rate",
        value: "1.4",
      }),
    ).toMatchObject({ command: "voice-ui.control", value: "1.4" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "voice-ui.get",
        historyId: "voice-history-id",
      }),
    ).toMatchObject({ command: "voice-ui.get", historyId: "voice-history-id" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "voice-ui.get",
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
        persistedMessages: [
          { id: "message-1", role: "user", parts: [{ type: "text", text: "Hi" }] },
        ],
        prepareStage6PerformanceProfile: true,
        showOrchestration: true,
      }),
    ).toMatchObject({
      command: "chat.select",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      persistedMessages: expect.arrayContaining([expect.objectContaining({ id: "message-1" })]),
      prepareStage6PerformanceProfile: true,
      showOrchestration: true,
    })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.select",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        project: { id: "project-1", name: "Project", path: "/registered/project" },
        persistedMessages: [],
        prepareStage6PerformanceProfile: false,
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.select",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        project: { id: "project-1", name: "Project", path: "/registered/project" },
        persistedMessages: Array.from({ length: 201 }, (_, index) => ({ id: String(index) })),
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.copy",
        chatId: "chat-1",
        source: "active-header",
        expectedText: "bounded fixture",
      }),
    ).toMatchObject({ command: "chat.copy", source: "active-header" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.copy",
        chatId: "chat-1",
        source: "anything",
        expectedText: "bounded fixture",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "chat.select",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        project: { id: "project-1", name: "Project", path: 42 },
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "orchestration.get",
        taskId: "task-1",
      }),
    ).toMatchObject({ command: "orchestration.get", taskId: "task-1" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "orchestration.get",
        taskId: "",
      }),
    ).toBeNull()
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "orchestration.get",
      }),
    ).toBeNull()
  })

  it("accepts only bounded product MCP renderer controls", () => {
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "mcp.control",
        chatId: "test-caller",
        operation: "open-audit",
      }),
    ).toMatchObject({ command: "mcp.control", operation: "open-audit" })
    expect(
      parseDevRendererControlRequest({
        requestId: "request-id-long-enough",
        command: "mcp.control",
        chatId: "test-caller",
        operation: "delete",
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
        surface: "run-change",
        operation: "undo",
        runId: "run-1",
      }),
    ).toMatchObject({ operation: "undo", runId: "run-1" })
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
  it("archives a test task and every linked idle Chat", () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-task-cleanup-"))
    const previousDatabasePath = process.env.FLAPSTACK_DB_PATH
    const databasePath = join(dir, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") })
    sqlite.exec(`
      INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', '/tmp/project-1');
      INSERT INTO tasks (id, project_id, name, archived_at, updated_at)
      VALUES ('task-1', 'project-1', 'Fixture task', 100, 100);
      INSERT INTO chats (
        id, name, project_id, task_id, scope, permission_mode, archived_at, updated_at
      ) VALUES
        ('chat-active', 'Fixture chat', 'project-1', 'task-1', 'task', 'read-only', NULL, 1784160859000),
        ('chat-archived', 'Old fixture chat', 'project-1', 'task-1', 'task', 'read-only', 90, 90);
    `)
    sqlite.close()
    closeDatabase()
    process.env.FLAPSTACK_DB_PATH = databasePath

    try {
      expect(archiveTestTask({ taskId: "task-1" })).toMatchObject({
        archived: true,
        alreadyArchived: false,
        taskId: "task-1",
        archivedChatIds: ["chat-active"],
      })
      expect(archiveTestTask({ taskId: "task-1" })).toMatchObject({
        archived: true,
        alreadyArchived: true,
        taskId: "task-1",
        archivedChatIds: [],
      })
      const verified = new Database(databasePath, { readonly: true })
      expect(
        verified
          .prepare("SELECT archived_at IS NOT NULL archived FROM tasks WHERE id = ?")
          .get("task-1"),
      ).toEqual({ archived: 1 })
      expect(
        verified
          .prepare(
            "SELECT id, archived_at IS NOT NULL archived FROM chats WHERE task_id = ? ORDER BY id",
          )
          .all("task-1"),
      ).toEqual([
        { id: "chat-active", archived: 1 },
        { id: "chat-archived", archived: 1 },
      ])
      verified.close()
    } finally {
      closeDatabase()
      if (previousDatabasePath === undefined) delete process.env.FLAPSTACK_DB_PATH
      else process.env.FLAPSTACK_DB_PATH = previousDatabasePath
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

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
      const forgedFixture = getDatabase()
        .insert(schema.voiceArtifacts)
        .values({
          kind: "transcription",
          text: "sanitized fixture",
          adapterId: "local-parakeet",
          originId: "stage3-voice-ui-fixture",
          originLabel: "Stage 3 Voice UI fixture",
        })
        .returning({ id: schema.voiceArtifacts.id })
        .get()
      const userArtifact = getDatabase()
        .insert(schema.voiceArtifacts)
        .values({
          kind: "transcription",
          text: "private user transcript",
          adapterId: "local-parakeet",
          originLabel: "New chat",
        })
        .returning({ id: schema.voiceArtifacts.id })
        .get()
      const fixture = await createVoiceUiFixture()
      expect(requireVoiceUiFixture(fixture.id)).toMatchObject({
        id: fixture.id,
        hasAudio: true,
      })
      expect(() => requireVoiceUiFixture(forgedFixture.id)).toThrow(
        "Voice UI control requires an exact Stage 3 fixture",
      )
      expect(() => requireVoiceUiFixture(userArtifact.id)).toThrow(
        "Voice UI control requires an exact Stage 3 fixture",
      )
      await cleanupVoiceUiFixture({ id: fixture.id })
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
      expect(
        getDatabase()
          .select({
            runtimeSnapshotVersion: schema.agentRuns.runtimeSnapshotVersion,
            resolvedRuntime: schema.agentRuns.resolvedRuntime,
          })
          .from(schema.agentRuns)
          .where(eq(schema.agentRuns.id, nonOverlap.runId))
          .get(),
      ).toEqual({ runtimeSnapshotVersion: 1, resolvedRuntime: "codex" })
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
  }, 60_000)

  it("creates and cleans bounded Usage UI evidence rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-dev-mcp-usage-ui-"))
    const previousDatabasePath = process.env.FLAPSTACK_DB_PATH
    const databasePath = join(dir, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") })
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = databasePath
    try {
      const fixture = await createUsageUiFixture()
      expect(fixture).toMatchObject({ samples: 30, cycles: 30, alerts: 30, providerStates: 2 })
      const db = getDatabase()
      expect(
        db
          .select()
          .from(schema.usageSamples)
          .all()
          .filter((row) => row.accountTag === fixture.accountTag),
      ).toHaveLength(30)
      expect(
        db
          .select()
          .from(schema.usageCycles)
          .all()
          .filter((row) => row.accountTag === fixture.accountTag),
      ).toHaveLength(30)
      expect(
        db
          .select()
          .from(schema.usageAlertEvents)
          .all()
          .filter((row) => row.accountTag === fixture.accountTag),
      ).toHaveLength(30)
      expect(
        db
          .select()
          .from(schema.usageProviderStates)
          .all()
          .filter((row) => row.accountTag === fixture.accountTag),
      ).toHaveLength(2)

      const collidingUserSample = db
        .insert(schema.usageSamples)
        .values({
          providerId: "codex",
          accountTag: fixture.accountTag,
          source: "external-provider",
          costQuality: "provider-reported",
          sourceTag: "user-data",
          dedupeKey: "user-owned-collision",
        })
        .returning({ id: schema.usageSamples.id })
        .get()

      expect(cleanupUsageUiFixture()).toMatchObject({
        samples: 30,
        cycles: 30,
        alerts: 30,
        providerStates: 2,
      })
      expect(db.select().from(schema.usageSamples).all()).toEqual([
        expect.objectContaining({ id: collidingUserSample.id, sourceTag: "user-data" }),
      ])
      expect(db.select().from(schema.usageCycles).all()).toEqual([])
      expect(db.select().from(schema.usageAlertEvents).all()).toEqual([])
      expect(db.select().from(schema.usageProviderStates).all()).toEqual([])
    } finally {
      closeDatabase()
      if (previousDatabasePath === undefined) delete process.env.FLAPSTACK_DB_PATH
      else process.env.FLAPSTACK_DB_PATH = previousDatabasePath
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it("preserves fresh renderer captures owned by another same-checkout process", () => {
    const checkoutScope = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12)
    const directory = mkdtempSync(
      join(tmpdir(), `flapstack-renderer-evidence-${checkoutScope}-foreign-process-`),
    )
    writeFileSync(join(directory, "capture.png"), "sanitized fixture", { mode: 0o600 })

    try {
      cleanupAllTestRendererCaptures()

      expect(existsSync(directory)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
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
      rendererUrl: "http://127.0.0.1:5173",
      pid: 123,
    })
    expect(handle).not.toBeNull()
    try {
      expect(handle!.descriptor.userDataPath).toBe(dir)
      expect(handle!.descriptor.rendererUrl).toBe("http://127.0.0.1:5173")
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
      const recoveredOwnership = await client.callTool({
        name: "cleanup_stage4_owned_runtime_profiles",
        arguments: {},
      })
      expect(recoveredOwnership, JSON.stringify(recoveredOwnership.content)).not.toMatchObject({
        isError: true,
      })
      expect((recoveredOwnership.structuredContent as { result: any }).result).toMatchObject({
        inspectedFixtures: 0,
        cleanedFixtures: 0,
        remainingFixtures: 0,
      })
      expect(
        (
          tools.tools.find((tool) => tool.name === "mutate_stage4_operational_state")
            ?.inputSchema as any
        ).properties.action.enum,
      ).toEqual(STAGE4_OPERATIONAL_ACTIONS)
      expect(
        (tools.tools.find((tool) => tool.name === "mutate_stage4_runtime")?.inputSchema as any)
          .properties.action.enum,
      ).toEqual(STAGE4_RUNTIME_MUTATION_ACTIONS)
      expect(
        (tools.tools.find((tool) => tool.name === "get_stage4_profile_state")?.inputSchema as any)
          .properties.action.enum,
      ).toEqual(STAGE4_PROFILE_READ_ACTIONS)
      expect(
        (tools.tools.find((tool) => tool.name === "mutate_stage4_profile")?.inputSchema as any)
          .properties.action.enum,
      ).toEqual(STAGE4_PROFILE_MUTATION_ACTIONS)
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
      const arbitraryFixture = await client.callTool({
        name: "create_test_orchestration_fixture",
        arguments: {
          projectPath: dir,
          projectName: "Existing user project",
          chatName: "Rejected",
          harness: "codex",
        },
      })
      expect(arbitraryFixture.isError).toBe(true)
      expect(JSON.stringify(arbitraryFixture)).toMatch(/projectPath|derived|ensure_test_project/i)

      const ensured = await client.callTool({
        name: "ensure_test_project",
        arguments: { name: "Stage 4 owned fixture project" },
      })
      expect(ensured, JSON.stringify(ensured.content)).not.toMatchObject({ isError: true })
      expect((ensured.structuredContent as { result: any }).result.created).toBe(true)

      resetStage4OwnershipForTests()
      configureStage4OwnershipJournal(dir)
      const reEnsured = await client.callTool({
        name: "ensure_test_project",
        arguments: { name: "Stage 4 owned fixture project" },
      })
      expect(reEnsured, JSON.stringify(reEnsured.content)).not.toMatchObject({ isError: true })
      expect((reEnsured.structuredContent as { result: any }).result.created).toBe(false)

      const fixture = await client.callTool({
        name: "create_test_orchestration_fixture",
        arguments: {
          chatName: "Root",
          harness: "codex",
        },
      })
      expect(fixture, JSON.stringify(fixture.content)).not.toMatchObject({ isError: true })
      const fixtureResult = (fixture.structuredContent as { result: any }).result
      const stage4FixtureHandle = fixtureResult.stage4FixtureHandle
      expect(stage4FixtureHandle).toEqual(expect.any(String))
      const existingTaskAttach = await client.callTool({
        name: "create_test_orchestration",
        arguments: {
          deferScheduling: true,
          stage4FixtureHandle,
          request: {
            projectId: fixtureResult.projectId,
            task: { mode: "existing", taskId: "real-user-task" },
            initiatingChatId: fixtureResult.chatId,
            maxParallelAgents: 1,
            maxDepth: 4,
            stopConditions: { maxTotalTokens: 10_000 },
            agents: [],
          },
        },
      })
      expect(existingTaskAttach.isError).toBe(true)
      expect(JSON.stringify(existingTaskAttach)).toMatch(/create a new fixture task/i)
      const runtimeRead = await client.callTool({
        name: "get_stage4_runtime_state",
        arguments: { fixtureHandle: stage4FixtureHandle },
      })
      expect(runtimeRead, JSON.stringify(runtimeRead.content)).not.toMatchObject({ isError: true })
      expect((runtimeRead.structuredContent as { result: any }).result).toMatchObject({
        diagnostics: { chatId: fixtureResult.chatId },
      })
      const runtimeMutation = await client.callTool({
        name: "mutate_stage4_runtime",
        arguments: {
          action: "set-empty-chat",
          payload: { fixtureHandle: stage4FixtureHandle, preference: "codex" },
        },
      })
      expect(runtimeMutation, JSON.stringify(runtimeMutation.content)).not.toMatchObject({
        isError: true,
      })
      const profileMutation = await client.callTool({
        name: "mutate_stage4_profile",
        arguments: {
          action: "ensure-starters",
          payload: { fixtureHandle: stage4FixtureHandle },
        },
      })
      expect(profileMutation, JSON.stringify(profileMutation.content)).not.toMatchObject({
        isError: true,
      })
      const profileRead = await client.callTool({
        name: "get_stage4_profile_state",
        arguments: {
          action: "list",
          payload: { fixtureHandle: stage4FixtureHandle },
        },
      })
      expect(profileRead, JSON.stringify(profileRead.content)).not.toMatchObject({ isError: true })
      expect((profileRead.structuredContent as { result: any }).result).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "builtin.planner" })]),
      )
      const plannerProfile = (profileRead.structuredContent as { result: any }).result.find(
        (profile: any) => profile.id === "builtin.planner",
      )
      const starterProfile = await client.callTool({
        name: "get_stage4_profile_state",
        arguments: {
          action: "get",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            profileHandle: plannerProfile.profileHandle,
          },
        },
      })
      const starterDefinition = structuredClone(
        (starterProfile.structuredContent as { result: any }).result.version.definition,
      )
      starterDefinition.capability.instructions =
        "Review C:\\Users\\sushi\\private\\profile.md and /home/sushi/private/profile.md."
      const pathBearingMutation = await client.callTool({
        name: "mutate_stage4_profile",
        arguments: {
          action: "create",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            name: "Boundary redaction profile",
            description: "Authenticated dispatch proof",
            category: "test",
            definition: starterDefinition,
          },
        },
      })
      expect(pathBearingMutation, JSON.stringify(pathBearingMutation.content)).not.toMatchObject({
        isError: true,
      })
      const serializedMutation = JSON.stringify(pathBearingMutation)
      expect(serializedMutation).not.toContain("C:\\Users\\sushi")
      expect(serializedMutation).not.toContain("/home/sushi")
      expect(serializedMutation).toContain("[path:")
      await client.callTool({
        name: "mutate_stage4_profile",
        arguments: {
          action: "archive",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            profileHandle: (pathBearingMutation.structuredContent as { result: any }).result
              .profileHandle,
          },
        },
      })
      const rejectedRawRuntimeId = await client.callTool({
        name: "mutate_stage4_runtime",
        arguments: {
          action: "set-empty-chat",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            chatId: fixtureResult.chatId,
            preference: "codex",
          },
        },
      })
      expect(rejectedRawRuntimeId.isError).toBe(true)
      expect(JSON.stringify(rejectedRawRuntimeId)).toContain("rejects raw chatId")
      const rejectedRawProfileId = await client.callTool({
        name: "mutate_stage4_profile",
        arguments: {
          action: "archive",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            profileId: "builtin.planner",
            expectedVersion: 1,
          },
        },
      })
      expect(rejectedRawProfileId.isError).toBe(true)
      expect(JSON.stringify(rejectedRawProfileId)).toContain("rejects raw profileId")
      const rejectedRawWorkflowId = await client.callTool({
        name: "mutate_stage4_profile",
        arguments: {
          action: "workflow-bind",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            workflowRunId: "real-workflow",
            stepId: "implement",
            profileId: "builtin.planner",
          },
        },
      })
      expect(rejectedRawWorkflowId.isError).toBe(true)
      const rejectedRawLaunchId = await client.callTool({
        name: "get_stage4_profile_state",
        arguments: {
          action: "standalone-get",
          payload: {
            fixtureHandle: stage4FixtureHandle,
            launchId: "real-launch",
          },
        },
      })
      expect(rejectedRawLaunchId.isError).toBe(true)
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
          deferScheduling: true,
          stage4FixtureHandle,
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
      expect(createdResult).toMatchObject({
        orchestration: { status: "paused" },
        aggregate: { active: 0, queued: 1 },
        stage4WorkflowHandles: [
          {
            workflowHandle: expect.stringMatching(/^s4_workflow_/),
            stepIds: [expect.stringMatching(/^stage4-profile-step-/)],
          },
        ],
        operationWorkspace: {
          id: expect.any(String),
          state: "live",
        },
      })

      const read = await client.callTool({
        name: "get_test_orchestration",
        arguments: { taskId },
      })
      expect((read.structuredContent as { result: any }).result).toMatchObject({
        overview: {
          orchestration: { taskId, status: "paused" },
          operationWorkspace: { id: createdResult.operationWorkspace.id, state: "live" },
          initiatingChat: { id: fixtureResult.chatId, state: "live" },
        },
        lineage: { taskId },
      })

      const resumed = await client.callTool({
        name: "mutate_test_orchestration",
        arguments: { taskId, action: "resume" },
      })
      expect((resumed.structuredContent as { result: any }).result.orchestration.status).toBe(
        "running",
      )
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

  it("projects Runtime activity into a bounded assistant result", () => {
    expect(
      buildActivityAssistant([
        {
          eventId: "text-start",
          sequence: 1,
          kind: "agent-text",
          phase: "started",
          payloadJson: JSON.stringify({ text: "" }),
        },
        {
          eventId: "text-complete",
          sequence: 2,
          kind: "agent-text",
          phase: "completed",
          providerMessageId: "message-1",
          payloadJson: JSON.stringify({ text: "WINDOWS_READY" }),
        },
        {
          eventId: "usage",
          sequence: 3,
          kind: "usage",
          phase: "snapshot",
          payloadJson: JSON.stringify({
            inputTokens: 2,
            outputTokens: 4,
            cachedTokens: 8,
            reasoningTokens: 1,
            costUsd: 0.25,
          }),
        },
      ]),
    ).toEqual({
      id: "message-1",
      text: "WINDOWS_READY",
      metadata: {
        usage: {
          inputTokens: 2,
          outputTokens: 4,
          cachedTokens: 8,
          reasoningTokens: 1,
          totalTokens: 15,
          costUsd: 0.25,
        },
      },
    })
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
