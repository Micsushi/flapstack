import { describe, expect, it } from "vitest"
import { evaluateMcpGate, evaluateMcpToolGate } from "../src/main/lib/mcp-control/gate"
import { resolveTrustedMcpCaller } from "../src/main/lib/mcp-control/identity"
import { getMcpControlTool } from "../src/main/lib/mcp-control/registry"
import type {
  McpCallerRecord,
  McpCallerStore,
  McpRunRecord,
} from "../src/main/lib/mcp-control/types"
import type { CustomPermissionToggles } from "../src/main/lib/permissions"

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
          projectId: "project-1",
          taskId: "task-1",
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
      projectId: "project-1",
      taskId: "task-1",
    })
  })
})

describe("MCP caller-by-tier gate matrix", () => {
  it("never lets approval override read-only mode", () => {
    expect(evaluateMcpGate({ tier: 2, permissionMode: "read-only", approved: true }).decision).toBe(
      "denied",
    )
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
})
