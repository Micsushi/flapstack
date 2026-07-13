import { describe, expect, it, vi } from "vitest"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { resolveProviderMcpPermission } from "../src/main/lib/mcp-control/provider-permissions"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"

describe("provider and product MCP permission integration", () => {
  it("distinguishes registry product tools from third-party and unknown product MCP", () => {
    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "read",
        providerToolName: "mcp__flapstack__list_projects",
      }),
    ).toMatchObject({
      source: "product",
      decision: "allow",
      providerPromptRequired: false,
      productApprovalRequired: false,
      tool: { name: "list_projects", tier: 0 },
    })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "write",
        providerToolName: "mcp__flapstack__create_chat",
      }),
    ).toMatchObject({ source: "product", decision: "deny", tool: { tier: 1 } })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "third-party",
        providerToolName: "mcp__github__list_issues",
      }),
    ).toMatchObject({ source: "third-party", decision: "deny" })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "full-access",
        correlationId: "unknown",
        providerToolName: "mcp__flapstack__invented_tool",
      }),
    ).toMatchObject({ source: "unknown-product", decision: "deny", tool: null })
  })

  it("uses pinned Codex ACP server metadata to defer once to the product registry gate", () => {
    expect(
      resolveProviderMcpPermission({
        permissionMode: "ask-before-edits",
        correlationId: "codex-product-call",
        metadata: { serverName: "flapstack" },
        isMcpToolApproval: true,
      }),
    ).toMatchObject({
      source: "product",
      decision: "allow",
      providerPromptRequired: false,
      productGateRequired: true,
      tool: null,
    })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "codex-third-party-call",
        metadata: { serverName: "github" },
        isMcpToolApproval: true,
      }),
    ).toMatchObject({ source: "third-party", decision: "deny" })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "ask-before-edits",
        correlationId: "spoofed-command",
        metadata: { serverName: "flapstack" },
      }),
    ).toBeNull()
  })

  it("uses one correlated product approval instead of a provider prompt plus product prompt", async () => {
    const correlationId = "provider-call-1"
    const providerDecision = resolveProviderMcpPermission({
      permissionMode: "ask-before-edits",
      correlationId,
      providerToolName: "mcp__flapstack__create_chat",
    })
    expect(providerDecision).toMatchObject({
      decision: "allow",
      correlationId,
      providerPromptRequired: false,
      productApprovalRequired: true,
    })

    const publish = vi.fn()
    const approvals = new McpApprovalLifecycle({ publish, readDecision: () => null })
    const execute = vi.fn(() => ({ ok: true as const, data: { created: true } }))
    const result = invokeMcpControlTool(
      "create_chat",
      { chatId: "chat-1", runId: "run-1", permissionMode: "ask-before-edits" },
      { name: "Child" },
      undefined,
      {
        approvals,
        approvalId: () => correlationId,
        invocationId: () => correlationId,
        execute,
      },
    )

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: correlationId, invocationId: correlationId }),
    )
    expect(approvals.listPending()).toHaveLength(1)
    approvals.approve(correlationId)
    await expect(result).resolves.toEqual({ ok: true, data: { created: true } })
    expect(execute).toHaveBeenCalledOnce()
    approvals.shutdown()
  })

  it("keeps every Tier 3 product call behind a fresh Stage 3 approval", async () => {
    expect(
      resolveProviderMcpPermission({
        permissionMode: "full-access",
        correlationId: "tier3-provider",
        providerToolName: "mcp__flapstack__launch_run",
      }),
    ).toMatchObject({
      decision: "allow",
      providerPromptRequired: false,
      productApprovalRequired: true,
      tool: { tier: 3 },
    })

    const approvals = new McpApprovalLifecycle()
    const execute = vi.fn(() => ({ ok: true as const, data: { launched: true } }))
    const invoke = (id: string) =>
      invokeMcpControlTool(
        "launch_run",
        { chatId: "chat-1", runId: "run-1", permissionMode: "full-access" },
        { chatId: "other-chat" },
        undefined,
        {
          approvals,
          approvalId: () => id,
          invocationId: () => id,
          execute,
        },
      )

    const first = invoke("tier3-1")
    expect(approvals.listPending()).toEqual([expect.objectContaining({ id: "tier3-1", tier: 3 })])
    approvals.approve("tier3-1", { grantSession: true })
    await expect(first).resolves.toMatchObject({ ok: true })

    const second = invoke("tier3-2")
    expect(approvals.listPending()).toEqual([expect.objectContaining({ id: "tier3-2", tier: 3 })])
    approvals.deny("tier3-2")
    await expect(second).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-denied" },
    })
    approvals.shutdown()
  })
})
