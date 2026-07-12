import { afterEach, describe, expect, it, vi } from "vitest"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"

const request = (
  id: string,
  overrides: Partial<Parameters<McpApprovalLifecycle["request"]>[0]> = {},
) => ({
  id,
  caller: { chatId: "chat-1", runId: "run-1" },
  toolName: "rename_item",
  tier: 2 as const,
  ...overrides,
})

afterEach(() => vi.useRealTimers())

describe("MCP approval lifecycle", () => {
  it("settles duplicate and late decisions exactly once", async () => {
    const lifecycle = new McpApprovalLifecycle()
    const wait = lifecycle.request(request("approval-1"))

    expect(lifecycle.approve("approval-1")).toBe(true)
    expect(lifecycle.deny("approval-1")).toBe(false)
    expect(lifecycle.cancel("approval-1")).toBe(false)
    await expect(wait.decision).resolves.toEqual({
      id: "approval-1",
      state: "approved",
      source: "user",
    })
    expect(lifecycle.listPending()).toEqual([])
  })

  it("fails closed on timeout, cancellation, and shutdown", async () => {
    vi.useFakeTimers()
    const lifecycle = new McpApprovalLifecycle()
    const timeout = lifecycle.request(request("timeout", { timeoutMs: 10 }))
    const cancelled = lifecycle.request(request("cancelled"))
    const shutdown = lifecycle.request(request("shutdown"))

    vi.advanceTimersByTime(10)
    expect(lifecycle.cancel("cancelled")).toBe(true)
    lifecycle.shutdown()
    expect(lifecycle.approve("shutdown")).toBe(false)

    await expect(timeout.decision).resolves.toMatchObject({ state: "timed-out", source: "timeout" })
    await expect(cancelled.decision).resolves.toMatchObject({
      state: "cancelled",
      source: "cancellation",
    })
    await expect(shutdown.decision).resolves.toMatchObject({
      state: "shutdown",
      source: "shutdown",
    })
    await expect(lifecycle.request(request("after-shutdown")).decision).resolves.toMatchObject({
      state: "shutdown",
    })
  })

  it("shares one pending decision for duplicate request ids", async () => {
    const lifecycle = new McpApprovalLifecycle()
    const first = lifecycle.request(request("same-id"))
    const second = lifecycle.request(request("same-id", { toolName: "archive_item" }))

    expect(second.pending).toMatchObject({ id: "same-id", toolName: "rename_item" })
    expect(second.decision).toBe(first.decision)
    lifecycle.deny("same-id")
    await expect(Promise.all([first.decision, second.decision])).resolves.toEqual([
      { id: "same-id", state: "denied", source: "user" },
      { id: "same-id", state: "denied", source: "user" },
    ])
  })

  it("keeps grants in memory and scopes them to chat, tool, and tier", async () => {
    const lifecycle = new McpApprovalLifecycle()
    const first = lifecycle.request(request("grant"))
    expect(lifecycle.approve("grant", { grantSession: true })).toBe(true)
    await expect(first.decision).resolves.toMatchObject({ state: "approved", source: "user" })

    await expect(lifecycle.request(request("granted")).decision).resolves.toMatchObject({
      state: "approved",
      source: "session-grant",
    })
    expect(
      lifecycle.request(request("wrong-tool", { toolName: "archive_item" })).pending,
    ).not.toBeNull()
    expect(
      lifecycle.request(request("wrong-chat", { caller: { chatId: "chat-2" } })).pending,
    ).not.toBeNull()
    expect(
      lifecycle.request(request("wrong-session", { caller: { chatId: "chat-1", runId: "run-2" } }))
        .pending,
    ).not.toBeNull()
    expect(lifecycle.request(request("wrong-tier", { tier: 1 })).pending).not.toBeNull()

    lifecycle.revokeSession("chat-1", "run-1")
    expect(lifecycle.request(request("after-session")).pending).not.toBeNull()
    lifecycle.shutdown()
  })

  it("never creates or uses a Tier 3 session grant", async () => {
    const lifecycle = new McpApprovalLifecycle()
    const first = lifecycle.request(request("danger", { tier: 3, toolName: "launch_run" }))

    expect(lifecycle.approve("danger", { grantSession: true })).toBe(true)
    await expect(first.decision).resolves.toMatchObject({ state: "approved", source: "user" })
    const next = lifecycle.request(request("danger-next", { tier: 3, toolName: "launch_run" }))
    expect(next.pending).toMatchObject({ tier: 3 })
    expect(lifecycle.hasSessionGrant(request("probe", { tier: 3, toolName: "launch_run" }))).toBe(
      false,
    )
    lifecycle.shutdown()
  })

  it("cancels all pending requests and grants when a chat ends", async () => {
    const lifecycle = new McpApprovalLifecycle()
    const granted = lifecycle.request(request("grant"))
    lifecycle.approve("grant", { grantSession: true })
    await granted.decision
    const pending = lifecycle.request(request("pending", { toolName: "archive_item" }))

    lifecycle.revokeChat("chat-1")
    await expect(pending.decision).resolves.toMatchObject({ state: "cancelled" })
    expect(lifecycle.request(request("after-chat")).pending).not.toBeNull()
    lifecycle.shutdown()
  })
})
