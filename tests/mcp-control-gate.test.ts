import { describe, expect, it } from "vitest"
import { evaluateMcpGate, evaluateMcpToolGate } from "../src/main/lib/mcp-control/gate"
import { resolveTrustedMcpCaller } from "../src/main/lib/mcp-control/identity"
import { getMcpControlTool, mcpControlTools } from "../src/main/lib/mcp-control/registry"
import type {
  McpCallerRecord,
  McpCallerStore,
  McpRunRecord,
} from "../src/main/lib/mcp-control/types"
import type { CustomPermissionToggles, PermissionMode } from "../src/main/lib/permissions"

const allCapabilities: CustomPermissionToggles = {
  schemaVersion: 1,
  projectWrite: true,
  shell: true,
  network: true,
  git: true,
  browser: true,
  secrets: true,
  subagents: true,
  thirdPartyMcp: true,
  productMcpRead: true,
  productMcpWrite: true,
  productMcpTier3: true,
}

function createStore(input?: {
  chat?: McpCallerRecord | null
  run?: McpRunRecord | null
  customPermissions?: CustomPermissionToggles | null
}): McpCallerStore {
  const chat =
    input?.chat === undefined
      ? {
          id: "chat-1",
          permissionMode: "ask-before-edits",
          archived: false,
          exposureEnabled: true,
        }
      : input.chat
  const run =
    input?.run === undefined
      ? { id: "run-1", chatId: "chat-1", permissionMode: "full-access", active: true }
      : input.run
  return {
    findChat: (id) => (chat?.id === id ? chat : null),
    findRun: (id) => (run?.id === id ? run : null),
    findCustomPermissions: () => input?.customPermissions ?? null,
  }
}

describe("trusted MCP caller resolution", () => {
  it("uses the durable run snapshot instead of launcher-provided permission data", () => {
    expect(resolveTrustedMcpCaller({ chatId: "chat-1", runId: "run-1" }, createStore())).toEqual({
      chatId: "chat-1",
      runId: "run-1",
      permissionMode: "full-access",
      customPermissions: undefined,
    })
  })

  it.each([
    ["missing chat", { chat: null }, /chat is missing or stale/],
    [
      "archived chat",
      {
        chat: {
          id: "chat-1",
          permissionMode: "full-access",
          archived: true,
          exposureEnabled: true,
        },
      },
      /chat is missing or stale/,
    ],
    ["missing run", { run: null }, /run is missing or stale/],
    [
      "inactive run",
      {
        run: { id: "run-1", chatId: "chat-1", permissionMode: "full-access", active: false },
      },
      /run is missing or stale/,
    ],
    [
      "foreign run",
      {
        run: { id: "run-1", chatId: "chat-other", permissionMode: "full-access", active: true },
      },
      /does not belong/,
    ],
  ])("fails closed for %s", (_name, storeInput, expected) => {
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore(storeInput as Parameters<typeof createStore>[0]),
      ),
    ).toThrow(expected as RegExp)
  })

  it("fails closed immediately after product MCP exposure is disabled", () => {
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore({
          chat: {
            id: "chat-1",
            permissionMode: "full-access",
            archived: false,
            exposureEnabled: false,
          },
        }),
      ),
    ).toThrow(/exposure is disabled/)
  })

  it("requires stored custom capability toggles", () => {
    const customRun = {
      id: "run-1",
      chatId: "chat-1",
      permissionMode: "custom",
      active: true,
    }
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore({ run: customRun }),
      ),
    ).toThrow(/missing stored capability toggles/)

    expect(
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore({ run: customRun, customPermissions: allCapabilities }),
      ),
    ).toMatchObject({ permissionMode: "custom", customPermissions: allCapabilities })
  })
})

describe("MCP caller-by-tier gate matrix", () => {
  const expected: Record<PermissionMode, readonly string[]> = {
    "read-only": ["allowed", "denied", "denied", "denied"],
    "ask-before-edits": ["allowed", "approval-required", "approval-required", "approval-required"],
    "auto-edit-project-only": ["allowed", "allowed", "allowed", "approval-required"],
    "full-access": ["allowed", "allowed", "allowed", "allowed"],
    custom: ["allowed", "allowed", "allowed", "approval-required"],
  }

  it.each(Object.entries(expected))("is deterministic for %s", (permissionMode, decisions) => {
    for (const [tier, decision] of decisions.entries()) {
      expect(
        evaluateMcpGate({
          tier: tier as 0 | 1 | 2 | 3,
          permissionMode,
          customPermissions: permissionMode === "custom" ? allCapabilities : undefined,
        }).decision,
      ).toBe(decision)
    }
  })

  it("denies missing and unsupported permission modes", () => {
    expect(evaluateMcpGate({ tier: 0 }).decision).toBe("denied")
    expect(evaluateMcpGate({ tier: 0, permissionMode: "root" }).decision).toBe("denied")
  })

  it("never lets approval override read-only mode", () => {
    expect(evaluateMcpGate({ tier: 2, permissionMode: "read-only", approved: true }).decision).toBe(
      "denied",
    )
  })

  it("auto-approves Tier 3 in full-access and keeps other modes guarded", () => {
    expect(evaluateMcpGate({ tier: 3, permissionMode: "full-access" }).decision).toBe("allowed")
    expect(evaluateMcpGate({ tier: 3, permissionMode: "ask-before-edits" }).decision).toBe(
      "approval-required",
    )
    expect(
      evaluateMcpGate({ tier: 3, permissionMode: "ask-before-edits", approved: true }).decision,
    ).toBe("allowed")
  })

  it("enforces registry capability requirements for custom mode", () => {
    const writeTool = getMcpControlTool("write_attachment_to_worktree")
    expect(writeTool).not.toBeNull()
    expect(
      evaluateMcpToolGate({
        tool: writeTool!,
        caller: {
          permissionMode: "custom",
          customPermissions: { ...allCapabilities, projectWrite: false },
        },
      }),
    ).toMatchObject({ decision: "denied", reason: expect.stringContaining("projectWrite") })
  })

  it("propagates verified frozen profile authority and rejects missing provenance", () => {
    const authority = {
      snapshotId: "snapshot-1",
      snapshotDigest: "a".repeat(64),
      profile: { profileId: "profile-1", version: 1 },
      allowedTools: ["describe"],
      allowedSkills: [],
      memoryPolicy: { mode: "none" as const },
      allowedDescendantProfileIds: [],
      maxDescendants: 0,
    }
    expect(
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore({
          run: {
            id: "run-1",
            chatId: "chat-1",
            permissionMode: "full-access",
            active: true,
            profileRuntimeAuthority: authority,
          },
        }),
      ),
    ).toMatchObject({ profileRuntimeAuthority: authority })
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-1" },
        createStore({
          run: {
            id: "run-1",
            chatId: "chat-1",
            permissionMode: "full-access",
            active: true,
            profileRuntimeAuthority: "invalid",
          },
        }),
      ),
    ).toThrow(/frozen Agent Profile provenance/)
  })

  it("enforces the frozen Agent Profile product-tool allowlist before permission tiers", () => {
    const describe = getMcpControlTool("describe")!
    const launch = getMcpControlTool("launch_run")!
    const authority = {
      snapshotId: "snapshot-1",
      snapshotDigest: "a".repeat(64),
      profile: { profileId: "profile-1", version: 1 },
      allowedTools: ["describe"],
      allowedSkills: [],
      memoryPolicy: { mode: "none" as const },
      allowedDescendantProfileIds: [],
      maxDescendants: 0,
    }

    expect(
      evaluateMcpToolGate({
        tool: describe,
        caller: { permissionMode: "full-access", profileRuntimeAuthority: authority },
      }),
    ).toMatchObject({ decision: "allowed" })
    expect(
      evaluateMcpToolGate({
        tool: launch,
        caller: { permissionMode: "full-access", profileRuntimeAuthority: authority },
      }),
    ).toMatchObject({
      decision: "denied",
      reason: expect.stringContaining("frozen Agent Profile"),
    })
    expect(
      evaluateMcpToolGate({
        tool: describe,
        caller: {
          permissionMode: "full-access",
          profileRuntimeAuthority: { ...authority, allowedTools: [] },
        },
      }),
    ).toMatchObject({ decision: "denied" })
    expect(
      evaluateMcpToolGate({
        tool: launch,
        caller: {
          permissionMode: "full-access",
          profileRuntimeAuthority: {
            ...authority,
            allowedTools: ["launch_run"],
          },
        },
      }),
    ).toMatchObject({
      decision: "denied",
      reason: expect.stringContaining("descendant ceiling"),
    })
    expect(
      evaluateMcpToolGate({
        tool: launch,
        caller: {
          permissionMode: "full-access",
          profileRuntimeAuthority: {
            ...authority,
            allowedTools: ["launch_run"],
            allowedDescendantProfileIds: ["profile-child"],
            maxDescendants: 1,
          },
        },
      }),
    ).toMatchObject({
      decision: "denied",
      reason: expect.stringMatching(/profile provenance/i),
    })
  })

  it("assigns a tier and capability boundary to every registry tool", () => {
    expect(mcpControlTools.length).toBeGreaterThan(0)
    for (const tool of mcpControlTools) {
      expect([0, 1, 2, 3]).toContain(tool.tier)
      expect(tool.requiredCapabilities).not.toContain("schemaVersion")
    }
  })
})
