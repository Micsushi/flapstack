import { describe, expect, it } from "vitest"
import { resolveProviderMcpPermission } from "../src/main/lib/mcp-control/provider-permissions"

describe("provider and product MCP permission integration", () => {
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
