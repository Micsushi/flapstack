import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import { mapCodexNotification } from "../src/main/lib/agent-runtime/codex/events"
import { coalesceReasoningDeltas } from "../src/main/lib/agent-runtime/codex/reasoning-stream"
import { spawnCodexProtocolClient } from "../src/main/lib/agent-runtime/codex/protocol-client"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

describe("direct Codex Runtime adapter", () => {
  it("targets steering to the active native turn and requires the matching provider receipt", async () => {
    const client = new FakeCodexProtocolClient()
    const adapter = createCodexRuntimeAdapterFactory({
      createClient: () => client,
      resolveThreadParams: () => ({ cwd: "/fixture" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      appendActivity: () => undefined,
    })()
    const ctx = runtimeContext()
    const session = await adapter.startSession(ctx)
    await expect(adapter.steer!(ctx, "too early")).rejects.toThrow(/no longer/)
    const turn = await adapter.startTurn(ctx, session, "first")
    client.responses.set("turn/steer", { turnId: turn.providerTurnId })
    await adapter.steer!(ctx, "change direction")
    expect(client.requests.at(-1)).toMatchObject({
      method: "turn/steer",
      params: {
        threadId: session.providerThreadId,
        expectedTurnId: turn.providerTurnId,
        input: [{ type: "text", text: "change direction", text_elements: [] }],
      },
    })
    client.responses.set("turn/steer", { turnId: "other" })
    await expect(adapter.steer!(ctx, "late")).rejects.toThrow(/did not confirm/)
    await adapter.cleanup(ctx)
  })

  it("reuses launch-owned worktree, MCP, image, permission, usage, and cancellation inputs", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const usage: unknown[] = []
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({
        cwd: "/worktree",
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        config: { mcp_servers: { fixture: { command: "/mcp" } } },
      }),
      resolveTurnInput: (_context, prompt) => [
        { type: "text", text: prompt, text_elements: [] },
        { type: "image", url: "data:image/png;base64,REDACTED" },
      ],
      requestPermission: async () => ({ decision: "accept" }),
      onUsage: async (_context, event) => usage.push(event),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()
    const context = runtimeContext()
    context.outputSchema = {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
    }
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "PROMPT_A")
    client.queue.emit({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 2, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0 },
        },
      },
    })
    client.queue.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } },
    })
    const streamed = []
    for await (const event of adapter.streamActivity(context, session, turn)) streamed.push(event)
    await adapter.complete(context)

    const threadStart = client.requests.find((request) => request.method === "thread/start")
    expect(threadStart?.params).toMatchObject({
      cwd: "/worktree",
      approvalPolicy: "on-request",
      config: { mcp_servers: { fixture: { command: "/mcp" } } },
    })
    const turnStart = client.requests.find((request) => request.method === "turn/start")
    expect(turnStart?.params?.outputSchema).toEqual(context.outputSchema)
    expect(turnStart?.params?.input).toEqual([
      { type: "text", text: "PROMPT_A", text_elements: [] },
      { type: "image", url: "data:image/png;base64,REDACTED" },
    ])
    expect(streamed.some((event) => event.kind === "usage")).toBe(true)
    expect(usage).toHaveLength(1)

    const permission = await client.serverRequest({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "command-1" },
    })
    expect(permission).toEqual({ decision: "accept" })
    expect(activity.flat().filter((event) => event.kind === "permission")).toHaveLength(2)
  })

  it("enables concurrent summaries and preserves the native thread across an effort change", async () => {
    const initial = new FakeCodexProtocolClient()
    const resumed = new FakeCodexProtocolClient()
    const createClient = vi.fn().mockReturnValueOnce(initial).mockReturnValueOnce(resumed)
    for (const client of [initial, resumed]) {
      client.responses.set("config/read", {
        config: { model_reasoning_summary: "concise", model_auto_compact_token_limit: 65_000 },
        layers: [],
      })
    }
    const adapter = createCodexRuntimeAdapterFactory({
      createClient,
      resolveThreadParams: () => ({ cwd: "/project", config: { features: { hooks: true } } }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      appendActivity: () => undefined,
    })()
    const first = runtimeContext()
    const session = await adapter.startSession(first)
    await adapter.startTurn(first, session, "first")
    await adapter.cleanup(first)
    const next = runtimeContext()
    next.launch.controls.modelEffort = "medium"
    const sameSession = await adapter.resumeSession(next, session)
    await adapter.startTurn(next, sameSession, "next")

    expect(sameSession.providerThreadId).toBe(session.providerThreadId)
    expect(resumed.requests.some((request) => request.method === "thread/start")).toBe(false)
    for (const [client, method] of [
      [initial, "thread/start"],
      [resumed, "thread/resume"],
    ] as const) {
      expect(client.requests.find((request) => request.method === method)?.params?.config).toEqual({
        features: { hooks: true, concurrent_reasoning_summaries: true },
        model_reasoning_summary: "concise",
      })
    }
    expect(
      resumed.requests.find((request) => request.method === "turn/start")?.params,
    ).toMatchObject({
      threadId: session.providerThreadId,
      effort: "medium",
      summary: "concise",
    })
    await adapter.cleanup(next)
  })

  it("coalesces public text by turn, item, stream and index without crossing a tool event", async () => {
    const client = new FakeCodexProtocolClient()
    const emit = (method: string, params: Record<string, unknown>) =>
      client.queue.emit({
        method,
        params: { threadId: "thread", turnId: "turn", itemId: "item", ...params },
      })
    emit("item/reasoning/summaryTextDelta", { summaryIndex: 0, delta: "checking " })
    emit("item/reasoning/textDelta", { contentIndex: 0, displayable: true, delta: "visible " })
    emit("item/reasoning/summaryTextDelta", { summaryIndex: 0, delta: "facts" })
    emit("item/reasoning/textDelta", { contentIndex: 0, displayable: true, delta: "detail" })
    emit("item/reasoning/summaryTextDelta", { summaryIndex: 1, delta: "next section" })
    emit("item/reasoning/textDelta", { contentIndex: 2, delta: "private detail" })
    emit("item/commandExecution/outputDelta", { itemId: "command", delta: "tool event" })
    emit("item/reasoning/summaryTextDelta", { summaryIndex: 0, delta: "later summary" })
    client.queue.finish()
    const result = []
    for await (const notification of coalesceReasoningDeltas(client.notifications())) {
      result.push(...mapCodexNotification(notification))
    }
    expect(result).toMatchObject([
      { kind: "reasoning-summary", summaryIndex: 0, payload: { text: "checking facts" } },
      { kind: "provider-visible-reasoning", contentIndex: 0, payload: { text: "visible detail" } },
      { kind: "reasoning-summary", summaryIndex: 1, payload: { text: "next section" } },
      { kind: "private-metadata", contentIndex: 2, payload: { metadata: { byteLength: 14 } } },
      { kind: "command", payload: { outputSummary: "tool event" } },
      { kind: "reasoning-summary", summaryIndex: 0, payload: { text: "later summary" } },
    ])
    expect(JSON.stringify(result)).not.toContain("private detail")
  })

  it("flushes live reasoning while the native stream is still waiting for its next event", async () => {
    const client = new FakeCodexProtocolClient()
    const results = coalesceReasoningDeltas(client.notifications())[Symbol.asyncIterator]()
    client.queue.emit({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        summaryIndex: 0,
        delta: "Live",
      },
    })
    try {
      expect(await results.next()).toMatchObject({
        value: { params: { delta: "Live" } },
        done: false,
      })
    } finally {
      client.queue.finish()
      await results.return?.()
    }
  })

  it("requests public summaries per turn and clears them on resume when switched off", async () => {
    const client = new FakeCodexProtocolClient()
    const factory = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })
    const first = factory()
    const context = runtimeContext()
    const session = await first.startSession(context)
    await first.startTurn(context, session, "FIRST")

    const next = factory()
    const resumed = runtimeContext()
    resumed.launch.controls.reasoningDisplay = false
    const reopened = await next.resumeSession(resumed, session)
    await next.startTurn(resumed, reopened, "FOLLOW_UP")

    expect(
      client.requests
        .filter((request) => request.method === "turn/start")
        .map((request) => request.params?.summary),
    ).toEqual(["auto", "none"])
  })

  it("restores an archived Codex thread before retrying resume", async () => {
    const client = new FakeCodexProtocolClient()
    let resumeAttempts = 0
    client.responses.set("thread/resume", () => {
      resumeAttempts += 1
      if (resumeAttempts === 1)
        throw new Error("session thread-1 is archived. Run `codex unarchive thread-1` first.")
      return { thread: { id: "thread-1", sessionId: "session-1" } }
    })
    client.responses.set("thread/unarchive", { thread: { id: "thread-1" } })
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()

    await expect(
      adapter.resumeSession(runtimeContext(), {
        providerSessionId: "session-1",
        providerThreadId: "thread-1",
      }),
    ).resolves.toEqual({ providerSessionId: "session-1", providerThreadId: "thread-1" })

    expect(
      client.requests
        .filter((request) => request.method.startsWith("thread/"))
        .map((request) => request.method),
    ).toEqual(["thread/resume", "thread/unarchive", "thread/resume"])
    expect(client.requests.find((request) => request.method === "thread/unarchive")).toEqual({
      method: "thread/unarchive",
      params: { threadId: "thread-1" },
      timeoutMs: 60_000,
    })
  })

  it("rejects a terminal failed turn instead of projecting provider failure as success", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.166.0-alpha.6",
      createClient: () => client,
    })()
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "PROMPT_A")
    client.queue.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "Provider usage limit reached." },
        },
      },
    })

    const stream = async () => {
      for await (const _event of adapter.streamActivity(context, session, turn)) {
        // Drain until the certain terminal provider failure is received.
      }
    }
    await expect(stream()).rejects.toThrow("Provider usage limit reached")
    await expect(adapter.complete(context)).rejects.toThrow("Provider usage limit reached")
    await expect(adapter.reconcile(context)).resolves.toBe("uncertain")
    expect(activity.flat()).toContainEqual(
      expect.objectContaining({
        kind: "lifecycle",
        phase: "failed",
        payload: expect.objectContaining({ state: "turn-failed" }),
      }),
    )
  })
})

describe("Codex App Server JSON-RPC transport bounds", () => {
  it.each(["thread/resume", "thread/fork"])(
    "disables owner registrations from native config layers during %s",
    async (method) => {
      const fake = fakeChild()
      const client = spawnCodexProtocolClient({
        command: "/fixture/codex",
        spawnProcess: () => fake.child,
      })
      const frames: Array<{ method: string; params: Record<string, unknown> }> = []
      fake.stdin.on("data", (line) => {
        const frame = JSON.parse(line.toString())
        frames.push(frame)
        const result =
          frame.method === "config/read"
            ? {
                config: { mcp_servers: { publicConfigured: { command: "example" } } },
                layers: [
                  {
                    config: {
                      mcp_servers: {
                        "flapstack-app-control": { command: "example" },
                        publicGlobal: { command: "example" },
                        inlineRecords: { env: { PROJECT_RECORDS_TOKEN: "public-inline-marker" } },
                        stdioRecords: { env_vars: ["flapstack_project_records_token_file"] },
                        httpRecords: {
                          env_http_headers: { Authorization: "PROJECT_RECORDS_TOKEN_FILE" },
                        },
                        bearerRecords: {
                          bearer_token_env_var: " FLAPSTACK_PROJECT_RECORDS_TOKEN ",
                        },
                      },
                    },
                  },
                  {
                    disabledReason: "not trusted",
                    config: {
                      mcp_servers: {
                        publicAlias: { args: ["mcp-control-stdio.js", "--external"] },
                      },
                    },
                  },
                ],
              }
            : {}
        fake.stdout.write(JSON.stringify({ id: frame.id, result }) + "\n")
      })
      try {
        const servers = {
          flapstack: { command: "trusted-chat-fixture" },
          publicRun: { command: "example" },
          claimWorker: {
            env: {
              PROJECT_RECORDS_GRANT_FILE: "public-claim",
              PROJECT_RECORDS_ATTEMPT_ID: "public-attempt",
            },
          },
        }
        await client.request(method, {
          cwd: "/fixture",
          sandbox: "danger-full-access",
          config: { mcp_servers: servers },
        })
        expect(frames[0]).toMatchObject({
          method: "config/read",
          params: { cwd: "/fixture", includeLayers: true },
        })
        expect(frames[1].params.config).toEqual({
          mcp_servers: {
            ...servers,
            "flapstack-app-control": { enabled: false },
            publicAlias: { enabled: false },
            inlineRecords: { enabled: false },
            stdioRecords: { enabled: false },
            httpRecords: { enabled: false },
            bearerRecords: { enabled: false },
          },
        })
      } finally {
        await client.close()
      }
    },
  )

  it("fails closed on malformed stdout and kills the process", async () => {
    const fake = fakeChild()
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => fake.child,
    })
    const next = client.notifications()[Symbol.asyncIterator]().next()
    fake.stdout.write("not-json\n")
    await expect(next).rejects.toThrow("Malformed App Server stdout")
    await tick()
    expect(client.isAlive()).toBe(false)
    expect(fake.kills).toContain("SIGTERM")
  })

  it("caps notification and concurrent server-request buffers", async () => {
    const notifications = fakeChild()
    const notificationClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => notifications.child,
    })
    for (let index = 0; index < 2_049; index += 1) {
      notifications.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "account/updated", params: { index } })}\n`,
      )
    }
    await tick()
    expect(notificationClient.isAlive()).toBe(false)

    const requests = fakeChild()
    const requestClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => requests.child,
    })
    requestClient.setRequestHandler(async () => await new Promise(() => {}))
    for (let index = 0; index < 33; index += 1) {
      requests.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "item/commandExecution/requestApproval", params: {} })}\n`,
      )
    }
    await tick()
    expect(requestClient.isAlive()).toBe(false)
  })

  it("does not treat child.killed as exit and rejects failed orphan cleanup", async () => {
    const stubborn = fakeChild({ exitOnKill: false })
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      shutdownTimeoutMs: 5,
      spawnProcess: () => stubborn.child,
    })
    await expect(client.close()).rejects.toThrow("did not exit after SIGKILL")
    expect(stubborn.kills).toEqual(["SIGTERM", "SIGKILL"])
  })
})

function fakeChild(options: { exitOnKill?: boolean } = {}) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const emitter = new EventEmitter()
  const kills: string[] = []
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    kill(signal = "SIGTERM") {
      kills.push(signal)
      child.killed = true
      if (options.exitOnKill !== false) {
        child.exitCode = 0
        emitter.emit("exit", 0, signal)
      }
      return true
    },
  }) as unknown as ChildProcessWithoutNullStreams
  return {
    child,
    stdout,
    stderr,
    stdin,
    kills,
    signalExit(signal: NodeJS.Signals) {
      child.signalCode = signal
      emitter.emit("exit", null, signal)
    },
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}
