import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  LOCAL_MODEL_READ_TOOL_SCHEMAS,
  LocalModelToolLoopError,
  createReadOnlyLocalModelToolExecutor,
  runBoundedLocalModelToolLoop,
  type LocalModelProviderTurnRequest,
  type LocalModelProviderTurnEvent,
  type LocalModelReadToolExecutor,
  type LocalModelToolProvider,
} from "../src/main/lib/harness/local-model-read-tools"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("local model read tools", () => {
  it("publishes normalized schemas and executes bounded read, list, glob, and grep tools", async () => {
    const root = projectFixture()
    const verifyRoot = vi.fn(() => root)
    const executor = createReadOnlyLocalModelToolExecutor({ rootPath: root, verifyRoot })

    expect(LOCAL_MODEL_READ_TOOL_SCHEMAS.map((tool) => tool.function.name)).toEqual([
      "read_file",
      "list_directory",
      "glob",
      "grep",
    ])
    expect(
      LOCAL_MODEL_READ_TOOL_SCHEMAS.every(
        (tool) => tool.function.parameters.additionalProperties === false,
      ),
    ).toBe(true)

    await expect(execute(executor, "read_file", { path: "README.md" })).resolves.toMatchObject({
      ok: true,
      content: "hello project\n",
    })
    await expect(execute(executor, "list_directory", { path: "." })).resolves.toMatchObject({
      ok: true,
      content: expect.stringContaining("directory\tsrc"),
    })
    await expect(execute(executor, "glob", { pattern: "**/*.ts" })).resolves.toMatchObject({
      ok: true,
      content: "src/index.ts\nsrc/nested/value.ts",
    })
    await expect(
      execute(executor, "grep", { pattern: "needle", path: "src", glob: "**/*.ts" }),
    ).resolves.toMatchObject({
      ok: true,
      content: "src/nested/value.ts:1:export const value = 'needle'",
    })
    expect(verifyRoot).toHaveBeenCalledTimes(4)
  })

  it("denies unregistered roots, traversal, malformed arguments, and symlink escapes", async () => {
    const root = projectFixture()
    const outside = mkdtempSync(join(tmpdir(), "flapstack-local-tool-outside-"))
    roots.push(outside)
    writeFileSync(join(outside, "secret.txt"), "outside secret")
    symlinkSync(outside, join(root, "escape"))
    symlinkSync(join(outside, "secret.txt"), join(root, "linked-secret.txt"))
    const executor = createReadOnlyLocalModelToolExecutor({
      rootPath: root,
      verifyRoot: () => root,
    })

    await expect(execute(executor, "read_file", { path: "../secret.txt" })).resolves.toMatchObject({
      ok: false,
      errorCode: "path-denied",
    })
    await expect(
      execute(executor, "read_file", { path: "linked-secret.txt" }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "path-denied",
    })
    await expect(execute(executor, "list_directory", { path: "escape" })).resolves.toMatchObject({
      ok: false,
      errorCode: "path-denied",
    })
    await expect(
      execute(executor, "read_file", { path: "README.md", command: "ignored" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })
    await expect(execute(executor, "glob", { pattern: "**/*" })).resolves.not.toMatchObject({
      content: expect.stringContaining("secret"),
    })

    const unregistered = createReadOnlyLocalModelToolExecutor({
      rootPath: root,
      verifyRoot: () => {
        throw new Error("not registered")
      },
    })
    await expect(execute(unregistered, "read_file", { path: "README.md" })).resolves.toMatchObject({
      ok: false,
      errorCode: "unregistered-root",
    })
  })
})

describe("bounded provider-neutral local model tool loop", () => {
  it("executes a read call, returns normalized evidence, and continues with bounded context", async () => {
    const requests: LocalModelProviderTurnRequest[] = []
    const provider = scriptedProvider(requests, [
      [
        {
          kind: "tool-call",
          call: { id: "call-1", name: "read_file", arguments: { path: "README.md" } },
        },
        { kind: "done", inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      ],
      [
        { kind: "text-delta", delta: "The project says hello." },
        { kind: "done", inputTokens: 7, outputTokens: 3, totalTokens: 10 },
      ],
    ])
    const executor: LocalModelReadToolExecutor = {
      execute: vi.fn(async () => ({
        ok: true,
        tool: "read_file",
        content: "hello project",
        truncated: false,
      })),
    }

    const events = await collect(
      runBoundedLocalModelToolLoop({
        runId: "run-1",
        messages: [{ role: "user", content: "inspect the project" }],
        toolsEnabled: true,
        provider,
        executor,
        signal: new AbortController().signal,
        now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      }),
    )

    expect(requests[0]?.tools).toEqual(LOCAL_MODEL_READ_TOOL_SCHEMAS)
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: [expect.objectContaining({ id: "call-1" })],
        }),
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-1",
          content: expect.stringContaining("hello project"),
        }),
      ]),
    )
    expect(events).toEqual([
      {
        kind: "tool-input",
        evidence: expect.objectContaining({ callId: "call-1", status: "started" }),
      },
      {
        kind: "tool-output",
        evidence: expect.objectContaining({ callId: "call-1", status: "succeeded" }),
      },
      { kind: "text-delta", delta: "The project says hello." },
      { kind: "done", inputTokens: 11, outputTokens: 5, totalTokens: 16 },
    ])
  })

  it("denies unknown and malformed calls without dispatching them", async () => {
    const executor: LocalModelReadToolExecutor = { execute: vi.fn() }
    const provider = scriptedProvider(
      [],
      [
        [
          { kind: "tool-call", call: { name: "shell", arguments: { command: "pwd" } } },
          { kind: "tool-call", call: { name: "read_file", arguments: "README.md" } },
          { kind: "done" },
        ],
        [{ kind: "text-delta", delta: "denied safely" }, { kind: "done" }],
      ],
    )

    const events = await collect(
      runBoundedLocalModelToolLoop({
        runId: "run-denied",
        messages: [{ role: "user", content: "try tools" }],
        toolsEnabled: true,
        provider,
        executor,
        signal: new AbortController().signal,
      }),
    )

    expect(executor.execute).not.toHaveBeenCalled()
    expect(
      events
        .filter((event) => event.kind === "tool-output")
        .map((event) => event.evidence.result?.errorCode),
    ).toEqual(["unknown-tool", "malformed-tool-call"])
  })

  it("keeps unsupported models chat-only and never exposes or executes tools", async () => {
    const requests: LocalModelProviderTurnRequest[] = []
    const executor: LocalModelReadToolExecutor = { execute: vi.fn() }
    const provider = scriptedProvider(requests, [
      [
        { kind: "tool-call", call: { name: "read_file", arguments: { path: "README.md" } } },
        { kind: "text-delta", delta: "chat only" },
        { kind: "done" },
      ],
    ])

    const events = await collect(
      runBoundedLocalModelToolLoop({
        runId: "run-chat",
        messages: [{ role: "user", content: "hello" }],
        toolsEnabled: false,
        provider,
        executor,
        signal: new AbortController().signal,
      }),
    )

    expect(requests[0]?.tools).toEqual([])
    expect(executor.execute).not.toHaveBeenCalled()
    expect(events).toEqual([{ kind: "text-delta", delta: "chat only" }, { kind: "done" }])
  })

  it("stops recursive calls at the repeated-call cap", async () => {
    const provider = repeatingProvider("read_file", { path: "README.md" })
    const result = await collectFailure(loopWith(provider, { maxRepeatedCall: 1 }))
    expect(result.error).toMatchObject({ code: "tool-recursion-limit" })
    expect(result.events.filter((event) => event.kind === "tool-output")).toHaveLength(2)
  })

  it.each([
    [
      "tool-iteration-limit",
      { maxIterations: 1 },
      repeatingProvider("read_file", { path: "a" }, true),
    ],
    ["tool-call-limit", { maxCalls: 1 }, twoCallProvider()],
    ["tool-context-limit", { maxContextChars: 256 }, terminalProvider()],
    ["tool-output-limit", { maxOutputChars: 128 }, outputFloodProvider()],
  ] as const)("stops at %s", async (code, limits, provider) => {
    const messages =
      code === "tool-context-limit"
        ? [{ role: "user" as const, content: "x".repeat(300) }]
        : [{ role: "user" as const, content: "bounded" }]
    const result = await collectFailure(loopWith(provider, limits, messages))
    expect(result.error).toBeInstanceOf(LocalModelToolLoopError)
    expect(result.error).toMatchObject({ code })
  })

  it("aborts a stalled provider at the wall-time cap", async () => {
    const provider: LocalModelToolProvider = {
      async *streamTurn(request) {
        await new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          )
        })
      },
    }
    const result = await collectFailure(loopWith(provider, { maxWallTimeMs: 20 }))
    expect(result.error).toMatchObject({ code: "tool-time-limit" })
  })
})

function projectFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-local-read-tools-"))
  roots.push(root)
  mkdirSync(join(root, "src", "nested"), { recursive: true })
  writeFileSync(join(root, "README.md"), "hello project\n")
  writeFileSync(join(root, "src", "index.ts"), "export const root = true\n")
  writeFileSync(join(root, "src", "nested", "value.ts"), "export const value = 'needle'\n")
  return root
}

function execute(executor: LocalModelReadToolExecutor, name: string, args: unknown) {
  return executor.execute({ id: "call", name, arguments: args }, new AbortController().signal)
}

function scriptedProvider(
  requests: LocalModelProviderTurnRequest[],
  turns: LocalModelProviderTurnEvent[][],
): LocalModelToolProvider {
  let index = 0
  return {
    async *streamTurn(request) {
      requests.push(request)
      for (const event of turns[index++] ?? []) yield event
    },
  }
}

function repeatingProvider(name: string, args: unknown, vary = false): LocalModelToolProvider {
  let turn = 0
  return {
    async *streamTurn() {
      turn += 1
      yield {
        kind: "tool-call" as const,
        call: { id: `call-${turn}`, name, arguments: vary ? { ...(args as object), turn } : args },
      }
      yield { kind: "done" as const }
    },
  }
}

function twoCallProvider(): LocalModelToolProvider {
  return scriptedProvider(
    [],
    [
      [
        { kind: "tool-call", call: { name: "read_file", arguments: { path: "a" } } },
        { kind: "tool-call", call: { name: "read_file", arguments: { path: "b" } } },
        { kind: "done" },
      ],
    ],
  )
}

function terminalProvider(): LocalModelToolProvider {
  return scriptedProvider([], [[{ kind: "done" }]])
}

function outputFloodProvider(): LocalModelToolProvider {
  return scriptedProvider([], [[{ kind: "text-delta", delta: "x".repeat(129) }, { kind: "done" }]])
}

function loopWith(
  provider: LocalModelToolProvider,
  limits: Record<string, number>,
  messages = [{ role: "user" as const, content: "bounded" }],
) {
  return runBoundedLocalModelToolLoop({
    runId: "run-limits",
    messages,
    toolsEnabled: true,
    provider,
    executor: {
      execute: async (call) => ({ ok: true, tool: call.name, content: "ok", truncated: false }),
    },
    signal: new AbortController().signal,
    limits,
  })
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of stream) events.push(event)
  return events
}

async function collectFailure<T>(
  stream: AsyncIterable<T>,
): Promise<{ events: T[]; error: unknown }> {
  const events: T[] = []
  try {
    for await (const event of stream) events.push(event)
  } catch (error) {
    return { events, error }
  }
  throw new Error("Expected the stream to fail")
}
