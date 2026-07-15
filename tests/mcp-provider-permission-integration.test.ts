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
        trustedProductServerName: "flapstack",
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
        trustedProductServerName: "flapstack",
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
        trustedProductServerName: "flapstack",
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
        trustedProductServerName: "flapstack",
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
      trustedProductServerName: "flapstack",
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
        audit: { append: vi.fn() },
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

  it("requires one product approval for Tier 3 calls in full-access mode", async () => {
    expect(
      resolveProviderMcpPermission({
        permissionMode: "full-access",
        correlationId: "tier3-provider",
        providerToolName: "mcp__flapstack__launch_run",
        trustedProductServerName: "flapstack",
      }),
    ).toMatchObject({
      decision: "allow",
      providerPromptRequired: false,
      productApprovalRequired: true,
      tool: { tier: 3 },
    })

    const approvals = new McpApprovalLifecycle()
    const execute = vi.fn(() => ({ ok: true as const, data: { launched: true } }))
    const result = invokeMcpControlTool(
      "launch_run",
      { chatId: "chat-1", runId: "run-1", permissionMode: "full-access" },
      { chatId: "other-chat" },
      undefined,
      {
        approvals,
        approvalId: () => "tier3",
        invocationId: () => "tier3",
        audit: { append: vi.fn() },
        execute,
      },
    )
    expect(approvals.listPending()).toHaveLength(1)
    approvals.approve("tier3")
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(approvals.listPending()).toEqual([])
    expect(execute).toHaveBeenCalledOnce()
    approvals.shutdown()
  })

  it("treats an untrusted reserved-name server as third-party and fails closed", () => {
    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "spoofed-product",
        providerToolName: "mcp__flapstack__list_projects",
      }),
    ).toMatchObject({ source: "third-party", decision: "deny", productGateRequired: false })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "full-access",
        correlationId: "user-third-party",
        providerToolName: "mcp__flapstack__list_projects",
      }),
    ).toMatchObject({ source: "third-party", decision: "allow", productGateRequired: false })

    expect(
      resolveProviderMcpPermission({
        permissionMode: "read-only",
        correlationId: "spoofed-codex-product",
        metadata: { serverName: "flapstack" },
        isMcpToolApproval: true,
      }),
    ).toMatchObject({ source: "third-party", decision: "deny" })

    for (const serverName of ["Flapstack", "FLAPSTACK"]) {
      expect(
        resolveProviderMcpPermission({
          permissionMode: "read-only",
          correlationId: `case-collision-${serverName}`,
          providerToolName: `mcp__${serverName}__list_projects`,
          trustedProductServerName: "flapstack",
        }),
      ).toMatchObject({ source: "third-party", decision: "deny", productGateRequired: false })
      expect(
        resolveProviderMcpPermission({
          permissionMode: "read-only",
          correlationId: `case-metadata-${serverName}`,
          metadata: { serverName },
          isMcpToolApproval: true,
          trustedProductServerName: "flapstack",
        }),
      ).toMatchObject({ source: "third-party", decision: "deny", productGateRequired: false })
    }
  })
})
