import { describe, expect, it, vi } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

describe("direct Codex Runtime recovery", () => {
  it("reconciles restart state without replaying uncertain turn intent", async () => {
    const active = new FakeCodexProtocolClient()
    active.responses.set("thread/read", {
      thread: {
        id: "thread-1",
        status: { type: "active", activeFlags: [] },
        turns: [{ id: "turn-1", status: "inProgress" }],
      },
    })
    const activeAdapter = createCodexRuntimeAdapterFactory({
      resolvePersistedTurn: () => ({ providerTurnId: "turn-1" }),
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => active,
    })()
    expect(await activeAdapter.reconcile(runtimeContext())).toBe("running")
    expect(active.requests.map((request) => request.method)).not.toContain("turn/start")

    const completed = new FakeCodexProtocolClient()
    completed.responses.set("thread/read", {
      thread: {
        id: "thread-1",
        status: { type: "idle" },
        turns: [{ id: "turn-1", status: "completed" }],
      },
    })
    const completedAdapter = createCodexRuntimeAdapterFactory({
      resolvePersistedTurn: () => ({ providerTurnId: "turn-1" }),
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => completed,
    })()
    expect(await completedAdapter.reconcile(runtimeContext())).toBe("completed")

    const uncertainAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => null,
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => new FakeCodexProtocolClient(),
    })()
    expect(await uncertainAdapter.reconcile(runtimeContext())).toBe("uncertain")
  })

  it("interrupts a recovered turn only from exact persisted thread and turn identity", async () => {
    const client = new FakeCodexProtocolClient()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-restart",
        providerThreadId: "thread-restart",
      }),
      resolvePersistedTurn: () => ({ providerTurnId: "turn-restart" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()

    await adapter.cancel(runtimeContext(), "operator")

    expect(client.requests).toContainEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-restart", turnId: "turn-restart" },
    })
    expect(client.closed).toBe(true)
  })

  it("does not complete an externally interrupted turn when the local signal is live", async () => {
    const client = new FakeCodexProtocolClient()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "PROMPT")
    client.queue.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted" } },
    })
    await expect(async () => {
      for await (const _event of adapter.streamActivity(context, session, turn)) {
        // drain terminal event
      }
    }).rejects.toThrow("interrupted")
    expect(context.signal.aborted).toBe(false)
    await expect(adapter.complete(context)).rejects.toThrow("interrupted")
    await expect(adapter.reconcile(context)).resolves.toBe("uncertain")
    await adapter.cleanup(context)
  })

  it("fails closed on process crash and permission timeout", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const requestPermission = vi.fn(async () => await new Promise(() => {}))
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      requestPermission,
      permissionTimeoutMs: 5,
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "PROMPT")
    client.queue.finish(new Error("process crashed"))
    await expect(async () => {
      for await (const _event of adapter.streamActivity(context, session, turn)) {
        // crash before terminal
      }
    }).rejects.toThrow("process crashed")
    expect(await adapter.reconcile(context)).toBe("uncertain")

    const denied = await adapter.requestPermission(context, {
      id: 9,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "patch-1" },
    })
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(denied).toEqual({ decision: "decline" })
    await adapter.cleanup(context)
  })
})
