import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { describe, expect, it } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import { spawnCodexProtocolClient } from "../src/main/lib/agent-runtime/codex/protocol-client"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

describe("direct Codex Runtime adapter", () => {
  it("probes the pinned handshake, account, models, and capabilities", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    })()

    const probe = await adapter.probe("codex")
    expect(probe.available).toBe(true)
    expect(probe.versions).toEqual({ adapterVersion: "1", protocolVersion: "0.144.1" })
    expect(probe.capabilities.capturedAt).toBe("2026-07-14T00:00:00.000Z")
    expect(client.requests.map((request) => request.method)).toEqual([
      "initialize",
      "account/read",
      "model/list",
    ])
    expect(client.closed).toBe(true)
  })

  it("blocks auth, model, handshake, and version drift without fallback", async () => {
    const activity = collectActivity()
    const authClient = new FakeCodexProtocolClient()
    authClient.responses.set("account/read", { account: null, requiresOpenaiAuth: true })
    const authAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => authClient,
    })()
    expect(await authAdapter.probe("codex")).toMatchObject({
      available: false,
      reason: { code: "runtime-unavailable" },
    })

    const driftAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.145.0",
      createClient: () => new FakeCodexProtocolClient(),
    })()
    expect(await driftAdapter.probe("codex")).toMatchObject({
      available: false,
      reason: { code: "protocol-unsupported" },
    })

    const modelClient = new FakeCodexProtocolClient()
    modelClient.responses.set("model/list", {
      data: [{ id: "other", model: "other" }],
      nextCursor: null,
    })
    const modelAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => modelClient,
    })()
    await expect(modelAdapter.startSession(runtimeContext())).rejects.toThrow(
      "model is unavailable",
    )
  })

  it("preserves typed probe outcome when client cleanup fails", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("account/read", { account: null, requiresOpenaiAuth: true })
    client.close = async () => {
      throw new Error("cleanup failed")
    }
    const diagnostics: string[] = []
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
      onDiagnostic: (_context, message) => diagnostics.push(message),
    })()

    await expect(adapter.probe("codex")).resolves.toMatchObject({
      available: false,
      reason: { code: "runtime-unavailable", message: "Codex account authentication is required." },
    })
    expect(diagnostics).toEqual(["Probe cleanup failed: cleanup failed"])
  })

  it("fails model discovery closed on repeated cursors and page-cap truncation", async () => {
    const activity = collectActivity()
    const cycleClient = new FakeCodexProtocolClient()
    cycleClient.responses.set("model/list", () => ({
      data: [{ id: "gpt-5.4", model: "gpt-5.4" }],
      nextCursor: "same-cursor",
    }))
    const cycleAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => cycleClient,
    })()
    const cycleProbe = await cycleAdapter.probe("codex")
    expect(cycleProbe.available).toBe(false)
    expect(cycleProbe.reason?.message).toContain("repeated cursor")

    const capClient = new FakeCodexProtocolClient()
    let page = 0
    capClient.responses.set("model/list", () => {
      page += 1
      return {
        data: [{ id: "gpt-5.4", model: "gpt-5.4" }],
        nextCursor: `cursor-${page}`,
      }
    })
    const capAdapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/redacted" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => capClient,
    })()
    const capProbe = await capAdapter.probe("codex")
    expect(capProbe.available).toBe(false)
    expect(capProbe.reason?.message).toContain("exceeded 10 pages")
    expect(page).toBe(10)
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
      getBinaryVersion: async () => "0.144.1",
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

  it("sends a frozen fast service tier independently of reasoning effort", async () => {
    const client = new FakeCodexProtocolClient()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: collectActivity().append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
      createClient: () => client,
    })()
    const context = runtimeContext()
    context.launch.controls.modelEffort = "low"
    context.launch.controls.serviceTier = "fast"

    const session = await adapter.startSession(context)
    await adapter.startTurn(context, session, "PROMPT_FAST")

    expect(
      client.requests.find((request) => request.method === "thread/start")?.params,
    ).toMatchObject({ serviceTier: "fast" })
    expect(
      client.requests.find((request) => request.method === "turn/start")?.params,
    ).toMatchObject({ effort: "low", serviceTier: "fast" })
  })

  it("rejects a terminal failed turn instead of projecting provider failure as success", async () => {
    const client = new FakeCodexProtocolClient()
    const activity = collectActivity()
    const adapter = createCodexRuntimeAdapterFactory({
      appendActivity: activity.append,
      resolveThreadParams: () => ({ cwd: "/worktree" }),
      resolveCommand: () => "/fake/codex",
      getBinaryVersion: async () => "0.144.1",
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

  it("never reconciles a persisted failed turn as completed", async () => {
    const client = new FakeCodexProtocolClient()
    client.responses.set("thread/read", {
      thread: {
        status: { type: "idle" },
        turns: [{ id: "turn-failed", status: "failed" }],
      },
    })
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
    })()

    await expect(adapter.reconcile(runtimeContext())).resolves.toBe("uncertain")
  })
})

describe("Codex App Server JSON-RPC transport bounds", () => {
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

  it("incrementally bounds unterminated stdout and handles NDJSON with CRLF", async () => {
    const framed = fakeChild()
    const framedClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => framed.child,
    })
    const iterator = framedClient.notifications()[Symbol.asyncIterator]()
    const first = iterator.next()
    const second = iterator.next()
    framed.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "first", params: { index: 1 } })}\r\n${JSON.stringify({ jsonrpc: "2.0", method: "second", params: { index: 2 } })}\n`,
    )
    await expect(first).resolves.toMatchObject({ value: { method: "first" } })
    await expect(second).resolves.toMatchObject({ value: { method: "second" } })
    await framedClient.close()

    const oversized = fakeChild()
    const oversizedClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => oversized.child,
    })
    const oversizedNext = oversizedClient.notifications()[Symbol.asyncIterator]().next()
    oversized.stdout.write(Buffer.alloc(1_048_577, 0x78))
    await expect(oversizedNext).rejects.toThrow("Oversized App Server message")
    expect(oversizedClient.isAlive()).toBe(false)

    const partial = fakeChild()
    const partialClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => partial.child,
    })
    const partialNext = partialClient.notifications()[Symbol.asyncIterator]().next()
    partial.stdout.end('{"jsonrpc":"2.0"')
    await expect(partialNext).rejects.toThrow("unterminated JSON-RPC message")
    expect(partialClient.isAlive()).toBe(false)
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

  it("removes pending request state when stdin write throws synchronously", async () => {
    const fake = fakeChild()
    let throwWrites = true
    const originalWrite = fake.stdin.write.bind(fake.stdin)
    fake.stdin.write = ((chunk: unknown) => {
      if (throwWrites) throw new Error("write failed")
      return originalWrite(chunk as never)
    }) as typeof fake.stdin.write
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => fake.child,
    })
    for (let index = 0; index < 128; index += 1) {
      await expect(client.request("model/list", {})).rejects.toThrow("write failed")
    }
    throwWrites = false
    const final = client.request("model/list", {})
    fake.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 129, result: { data: [] } })}\n`)
    await expect(final).resolves.toEqual({ data: [] })
    await client.close()
  })

  it("bounds and redacts stderr diagnostics on process failure", async () => {
    const fake = fakeChild()
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => fake.child,
    })
    const next = client.notifications()[Symbol.asyncIterator]().next()
    fake.stderr.write(`${"x".repeat(100_000)} Bearer SECRET_TOKEN`)
    ;(fake.child as unknown as EventEmitter).emit("exit", 7, null)
    await expect(next).rejects.toThrow("App Server exited")
    expect(client.diagnostics()).toContain("Bearer [redacted]")
    expect(client.diagnostics()).not.toContain("SECRET_TOKEN")
    expect(Buffer.byteLength(client.diagnostics(), "utf8")).toBeLessThanOrEqual(32_768)
  })

  it("terminates when a server-response write fails", async () => {
    const fake = fakeChild()
    fake.stdin.write = (() => {
      throw new Error("response write failed")
    }) as typeof fake.stdin.write
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => fake.child,
    })
    client.setRequestHandler(async () => ({ decision: "cancel" }))
    const next = client.notifications()[Symbol.asyncIterator]().next()
    fake.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "item/fileChange/requestApproval", params: {} })}\n`,
    )
    await expect(next).rejects.toThrow("Failed to write App Server response")
    await tick()
    expect(client.isAlive()).toBe(false)
    expect(fake.kills).toContain("SIGTERM")
  })

  it("terminates on concurrency-error response failure and asynchronous stdin EPIPE", async () => {
    const overloaded = fakeChild()
    const overloadedClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => overloaded.child,
    })
    overloadedClient.setRequestHandler(async () => await new Promise(() => {}))
    for (let index = 0; index < 32; index += 1) {
      overloaded.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "item/commandExecution/requestApproval", params: {} })}\n`,
      )
    }
    overloaded.stdin.write = (() => {
      throw new Error("overload response failed")
    }) as typeof overloaded.stdin.write
    const overloadedNext = overloadedClient.notifications()[Symbol.asyncIterator]().next()
    overloaded.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 33, method: "item/commandExecution/requestApproval", params: {} })}\n`,
    )
    await expect(overloadedNext).rejects.toThrow("Failed to write App Server response")
    expect(overloadedClient.isAlive()).toBe(false)

    const brokenPipe = fakeChild()
    const brokenPipeClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => brokenPipe.child,
    })
    const brokenPipeNext = brokenPipeClient.notifications()[Symbol.asyncIterator]().next()
    brokenPipe.stdin.emit("error", new Error("EPIPE"))
    await expect(brokenPipeNext).rejects.toThrow("App Server stdin failed: EPIPE")
    expect(brokenPipeClient.isAlive()).toBe(false)
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

  it("recognizes an already signal-exited child across repeated close calls", async () => {
    const exited = fakeChild({ exitOnKill: false })
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      shutdownTimeoutMs: 5,
      spawnProcess: () => exited.child,
    })
    exited.signalExit("SIGTERM")
    await expect(client.close()).resolves.toBeUndefined()
    await expect(client.close()).resolves.toBeUndefined()
    expect(exited.kills).toEqual([])
  })

  it("cleans up a live child that emits an error", async () => {
    const failed = fakeChild()
    const client = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => failed.child,
    })
    const next = client.notifications()[Symbol.asyncIterator]().next()
    ;(failed.child as unknown as EventEmitter).emit("error", new Error("spawn channel failed"))
    await expect(next).rejects.toThrow("spawn channel failed")
    expect(client.isAlive()).toBe(false)
    expect(failed.kills).toContain("SIGTERM")
  })

  it("fails invalid authority messages but diagnoses late numeric responses", async () => {
    const late = fakeChild()
    const lateClient = spawnCodexProtocolClient({
      command: "/fake/codex",
      spawnProcess: () => late.child,
    })
    late.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} })}\n`)
    await tick()
    expect(lateClient.isAlive()).toBe(true)
    expect(lateClient.diagnostics()).toContain("Late JSON-RPC response id 999")
    await lateClient.close()

    for (const invalid of [
      { jsonrpc: "2.0", id: "string-response", result: {} },
      { jsonrpc: "2.0", unexpected: true },
      { jsonrpc: "2.0", id: 1 },
      { jsonrpc: "2.0", id: 1, result: {}, error: { code: -1 } },
      { jsonrpc: "2.0", id: 1, error: "invalid" },
      { jsonrpc: "2.0", method: "warning", params: "invalid" },
    ]) {
      const fake = fakeChild()
      const client = spawnCodexProtocolClient({
        command: "/fake/codex",
        spawnProcess: () => fake.child,
      })
      const next = client.notifications()[Symbol.asyncIterator]().next()
      fake.stdout.write(`${JSON.stringify(invalid)}\n`)
      await expect(next).rejects.toThrow("codex-runtime")
      expect(client.isAlive()).toBe(false)
    }
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
