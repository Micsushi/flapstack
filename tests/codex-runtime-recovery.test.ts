import { describe, expect, it } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

describe("direct Codex Runtime recovery", () => {
  it("resumes, forks, archives, cancels, and cleans up exact provider identity", async () => {
    const clients: FakeCodexProtocolClient[] = []
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: (_context, operation) => ({ cwd: "/worktree", operation }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => {
        const client = new FakeCodexProtocolClient()
        clients.push(client)
        return client
      },
    })()
    const context = runtimeContext()
    const resumed = await adapter.resumeSession(context, {
      providerSessionId: "session-1",
      providerThreadId: "thread-1",
    })
    expect(resumed).toEqual({ providerSessionId: "session-1", providerThreadId: "thread-1" })
    const turn = await adapter.startTurn(context, resumed, "PROMPT")
    await adapter.cancel(context, "user cancel")
    expect(clients[0].requests).toContainEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    })
    clients[0].queue.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", error: null } },
    })
    for await (const _event of adapter.streamActivity(context, resumed, turn)) {
      // drain terminal event
    }
    await adapter.complete(context)
    await adapter.archiveSession(context, resumed)
    await adapter.cleanup(context)
    expect(clients[0].closed).toBe(true)

    const forkContext = { ...runtimeContext(), runId: "run-fork" }
    const forked = await adapter.forkSession(
      forkContext,
      { providerSessionId: "session-1", providerThreadId: "thread-1" },
      "turn-parent",
    )
    expect(forked).toEqual({ providerSessionId: "session-1", providerThreadId: "thread-2" })
    expect(
      clients[1].requests.find((request) => request.method === "thread/fork")?.params,
    ).toMatchObject({
      threadId: "thread-1",
      lastTurnId: "turn-parent",
    })
    await adapter.cleanup(forkContext)
  })

  it("reconciles restart state without replaying uncertain turn intent", async () => {
    const active = new FakeCodexProtocolClient()
    active.responses.set("thread/read", {
      thread: { id: "thread-1", status: { type: "active", activeFlags: [] }, turns: [] },
    })
    const activeAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
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
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => completed,
    })()
    expect(await completedAdapter.reconcile(runtimeContext())).toBe("completed")

    const uncertainAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => null,
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => new FakeCodexProtocolClient(),
    })()
    expect(await uncertainAdapter.reconcile(runtimeContext())).toBe("uncertain")
  })

  it("preserves uncertain reconciliation when cleanup fails", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("thread/read", new Error("read failed"))
    client.close = async () => {
      throw new Error("cleanup failed")
    }
    const diagnostics: string[] = []
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolvePersistedSession: () => ({
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
      onDiagnostic: (_context, message) => diagnostics.push(message),
    })()

    await expect(adapter.reconcile(runtimeContext())).resolves.toBe("uncertain")
    expect(diagnostics).toEqual(["Restart reconciliation cleanup failed: cleanup failed"])
  })

  it("fails closed on process crash and permission timeout", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      requestPermission: async () => await new Promise(() => {}),
      permissionTimeoutMs: 5,
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
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
    expect(denied).toEqual({ decision: "cancel" })
    await adapter.cleanup(context)
  })

  it("terminates the owned process on an unknown server request", async () => {
    const client = new FakeCodexProtocolClient()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
    })()
    const context = runtimeContext()
    await adapter.startSession(context)
    await expect(
      client.serverRequest({ id: 99, method: "item/futureApproval", params: {} }),
    ).rejects.toThrow("fails closed")
    expect(client.closed).toBe(true)
    expect(await adapter.reconcile(context)).toBe("uncertain")
  })

  it.each([
    ["timeout", new Error("turn/start timed out")],
    ["malformed response", { turn: { status: "inProgress" } }],
  ])("never replays uncertain turn intent after %s", async (_label, turnResponse) => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("turn/start", turnResponse)
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    await expect(adapter.startTurn(context, session, "PROMPT_ONCE")).rejects.toThrow()
    await expect(adapter.startTurn(context, session, "DO_NOT_REPLAY")).rejects.toThrow(
      "active or uncertain",
    )
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1)
    expect(await adapter.reconcile(context)).toBe("uncertain")
    await adapter.cleanup(context)
  })

  it("marks a failed interrupt uncertain", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("turn/interrupt", new Error("interrupt transport failed"))
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    await adapter.startTurn(context, session, "PROMPT")
    await expect(adapter.cancel(context, "cancel")).rejects.toThrow("interrupt transport failed")
    expect(await adapter.reconcile(context)).toBe("uncertain")
    await adapter.cleanup(context)
  })
})
