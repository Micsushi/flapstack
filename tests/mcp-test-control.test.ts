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
import { devMcpTestControlTools, getDevMcpTool } from "../src/main/lib/mcp-test-control/registry"
import { redactSecretLikeText, resolveCommandPath } from "../src/main/lib/mcp-test-control/shell"

describe("dev MCP test-control registry", () => {
  it("defines the today-sized testing tool surface", () => {
    expect(devMcpTestControlTools.map((tool) => tool.name)).toEqual([
      "get_test_environment",
      "get_harness_status",
      "list_test_targets",
      "set_chat_run_config",
      "send_test_prompt",
      "wait_for_run",
      "verify_run_artifacts",
      "run_project_check",
      "openspec_validate",
    ])
    expect(getDevMcpTool("get_harness_status")?.tier).toBe(0)
    expect(getDevMcpTool("run_project_check")?.tier).toBe(2)
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
