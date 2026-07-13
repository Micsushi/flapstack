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
import {
  listAgentInputRequests,
  replyAgentInputRequest,
} from "../src/main/lib/mcp-test-control/service"
import { agentInputLifecycle } from "../src/main/lib/agent-input/service"
import {
  listDevAgentInputRendererStates,
  recordDevAgentInputRendererState,
} from "../src/main/lib/mcp-test-control/renderer-state"

describe("dev MCP test-control registry", () => {
  it("defines the today-sized testing tool surface", () => {
    expect(devMcpTestControlTools.map((tool) => tool.name)).toEqual([
      "get_test_environment",
      "get_harness_status",
      "get_provider_status",
      "list_provider_extensions",
      "list_test_targets",
      "get_chat_state",
      "get_run_state",
      "get_reasoning_timer_state",
      "list_pending_approvals",
      "get_opencode_logs",
      "list_agent_input_requests",
      "get_renderer_agent_input_state",
      "ensure_test_project",
      "archive_test_project",
      "create_test_chat",
      "open_test_chat",
      "archive_test_chat",
      "mutate_project_provider_extension",
      "set_chat_run_config",
      "send_test_prompt",
      "launch_test_run",
      "inject_agent_input_request",
      "reply_agent_input_request",
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
      await transport.close()
    } finally {
      await handle?.stop()
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
