import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
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
      "get_visible_copy_search_state",
      "select_test_chat",
      "get_shortcut_state",
      "mutate_shortcut_binding",
      "list_provider_extensions",
      "list_test_targets",
      "get_chat_state",
      "get_run_state",
      "get_reasoning_timer_state",
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
      "create_test_chat",
      "archive_test_chat",
      "mutate_project_provider_extension",
      "get_permission_state",
      "set_permission_default",
      "set_chat_permission",
      "preview_permission",
      "set_chat_run_config",
      "send_test_prompt",
      "launch_test_run",
      "reply_approval",
      "cancel_run",
      "wait_for_run",
      "verify_run_artifacts",
      "run_project_check",
      "openspec_validate",
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
