import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import {
  LocalModelChatService,
  assembleLocalModelMessages,
  createDatabaseLocalModelRunPersistence,
  parseOllamaChatLine,
  type StreamLocalModelChatInput,
} from "../src/main/lib/harness/local-model-stream"
import * as schema from "../src/main/lib/db/schema"
import type { LocalModelRunMetadata } from "../src/shared/local-model-contract"
import type { LocalModelReadToolExecutor } from "../src/main/lib/harness/local-model-read-tools"

const NOW = Date.parse("2026-07-14T12:00:00.000Z")
const databases: Database.Database[] = []

afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

describe("local model stream", () => {
  it("normalizes split Ollama NDJSON chunks and persists text and usage", async () => {
    const fixture = setup()
    const requests: Array<Record<string, unknown>> = []
    const service = fixture.service(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return byteStreamResponse([
        '{"message":{"role":"assistant","content":"hel',
        'lo"},"done":false}\n{"message":{"role":"assistant","content":" world"},',
        '"done":false}\n{"done":true,"prompt_eval_count":4,"eval_count":2}\n',
      ])
    })

    const chunks = await collect(service.stream(input()))

    expect(chunks).toEqual([
      { type: "start", messageId: expect.any(String) },
      { type: "text-start", id: "local-response" },
      { type: "text-delta", id: "local-response", delta: "hello" },
      { type: "text-delta", id: "local-response", delta: " world" },
      { type: "text-end", id: "local-response" },
      {
        type: "message-metadata",
        messageMetadata: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
      {
        type: "finish",
        messageMetadata: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    ])
    expect(requests[0]).toMatchObject({
      model: "fixture:latest",
      stream: true,
      messages: [
        { role: "system", content: "project context" },
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "new question" },
      ],
    })
    expect(requests[0]).not.toHaveProperty("tools")
    expect(fixture.run("run-1")).toMatchObject({
      harness: "local",
      model: "fixture:latest",
      status: "success",
      initial_prompt: "new question",
      completed_at: NOW / 1_000,
    })
    const messages = fixture.messages()
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "hello world" }],
      metadata: {
        runId: "run-1",
        streamState: "success",
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
        localModel: {
          harness: "local",
          provider: { endpoint: "http://127.0.0.1:11434", version: "0.9.1" },
          model: { modelId: "fixture:latest", digest: "sha256:fixture" },
        },
        context: { sourceFingerprint: "a".repeat(64) },
      },
    })
    expect(fixture.subChat()).toMatchObject({
      session_id: null,
      stream_id: null,
      harness: "local",
      model: "fixture:latest",
      run_status: "success",
    })
  })

  it("runs declared read tools and keeps normalized tool evidence durable", async () => {
    const fixture = setup()
    const requests: Array<Record<string, unknown>> = []
    const executor: LocalModelReadToolExecutor = {
      execute: async (call) => ({
        ok: true,
        tool: call.name,
        content: "hello project",
        truncated: false,
      }),
    }
    const service = fixture.service(
      async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return requests.length === 1
          ? byteStreamResponse([
              '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"README.md"}}}]},"done":true,"prompt_eval_count":2,"eval_count":1}\n',
            ])
          : byteStreamResponse([
              '{"message":{"role":"assistant","content":"Found it."},"done":true,"prompt_eval_count":3,"eval_count":2}\n',
            ])
      },
      contextBundle,
      () => executor,
    )

    const chunks = await collect(
      service.stream(input({ runId: "run-tools", metadata: toolMetadata })),
    )

    expect(requests[0]).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ function: expect.objectContaining({ name: "read_file" }) }),
      ]),
    })
    expect(requests[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
        expect.objectContaining({ role: "tool", tool_name: "read_file" }),
      ]),
    })
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-input-available", toolName: "read_file" }),
        expect.objectContaining({ type: "tool-output-available" }),
        { type: "text-delta", id: "local-response", delta: "Found it." },
        {
          type: "finish",
          messageMetadata: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        },
      ]),
    )
    expect(fixture.run("run-tools")).toMatchObject({ status: "success" })
    const assistant = fixture.messages().at(-1) as {
      parts: Array<Record<string, unknown>>
      metadata: { streamState: string; toolEvidence: Array<Record<string, unknown>> }
    }
    expect(assistant.parts[0]).toEqual({ type: "text", text: "Found it." })
    expect(assistant.parts[1]).toMatchObject({
      type: "tool-read_file",
      toolName: "read_file",
      state: "result",
      output: { ok: true, content: "hello project" },
    })
    expect(assistant.metadata.streamState).toBe("success")
    expect(assistant.metadata.toolEvidence[0]).toMatchObject({
      tool: "read_file",
      status: "succeeded",
      result: { ok: true },
    })
  })

  it("persists a bounded terminal reason when a tool loop reaches its limit", async () => {
    const fixture = setup()
    const service = fixture.service(
      async () =>
        byteStreamResponse([
          '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"README.md"}}}]},"done":true}\n',
        ]),
      contextBundle,
      () => ({
        execute: async (call) => ({
          ok: true,
          tool: call.name,
          content: "hello project",
          truncated: false,
        }),
      }),
    )

    const chunks = await collect(
      service.stream(
        input({
          runId: "run-tool-limit",
          metadata: toolMetadata,
          toolLoopLimits: { maxIterations: 1 },
        }),
      ),
    )

    expect(chunks).toContainEqual({
      type: "error",
      errorText: "The local model tool loop reached its iteration limit.",
    })
    expect(fixture.run("run-tool-limit")).toMatchObject({ status: "failure" })
    expect(fixture.messages().at(-1)).toMatchObject({
      metadata: {
        streamState: "failure",
        errorCode: "tool-iteration-limit",
        toolEvidence: [expect.objectContaining({ status: "succeeded" })],
      },
    })
  })

  it("bounds timeout and cancellation while keeping completed content durable", async () => {
    const timeoutFixture = setup()
    const timeoutService = timeoutFixture.service(() => new Promise<Response>(() => undefined))
    const timeoutStarted = Date.now()
    const timeoutChunks = await collect(
      timeoutService.stream(input({ runId: "run-timeout", timeoutMs: 100 })),
    )
    expect(Date.now() - timeoutStarted).toBeLessThan(1_000)
    expect(timeoutChunks).toContainEqual({
      type: "error",
      errorText: "The local model response timed out.",
    })
    expect(timeoutFixture.run("run-timeout")).toMatchObject({ status: "failure" })

    const abortFixture = setup()
    const abortService = abortFixture.service(async () => openStreamResponse())
    const iterator = abortService.stream(input({ runId: "run-abort" }))
    expect((await iterator.next()).value).toMatchObject({ type: "start" })
    expect((await iterator.next()).value).toEqual({
      type: "text-start",
      id: "local-response",
    })
    expect((await iterator.next()).value).toEqual({
      type: "text-delta",
      id: "local-response",
      delta: "kept",
    })
    expect(abortService.cancel("run-abort")).toBe(true)
    const abortStarted = Date.now()
    const remaining = await collect(iterator)
    expect(Date.now() - abortStarted).toBeLessThan(1_000)
    expect(remaining).toEqual([{ type: "text-end", id: "local-response" }, { type: "finish" }])
    expect(abortFixture.run("run-abort")).toMatchObject({ status: "cancelled" })
    expect(abortFixture.messages().at(-1)).toMatchObject({
      parts: [{ type: "text", text: "kept" }],
      metadata: { streamState: "cancelled" },
    })
  })

  it("fails malformed and disconnected streams without exposing provider details", async () => {
    const malformed = setup()
    const malformedService = malformed.service(async () =>
      byteStreamResponse(['{"message":{"content":"secret-token"}}\n']),
    )
    const malformedChunks = await collect(
      malformedService.stream(input({ runId: "run-malformed" })),
    )
    expect(malformedChunks).toContainEqual({
      type: "error",
      errorText: "Ollama returned an invalid streaming response.",
    })
    expect(JSON.stringify(malformedChunks)).not.toContain("secret-token")

    const disconnected = setup()
    const disconnectedService = disconnected.service(async () =>
      byteStreamResponse(['{"message":{"content":"partial"},"done":false}\n']),
    )
    const disconnectedChunks = await collect(
      disconnectedService.stream(input({ runId: "run-disconnect" })),
    )
    expect(disconnectedChunks).toContainEqual({
      type: "error",
      errorText: "The local model stream disconnected before completion.",
    })
    expect(disconnected.messages().at(-1)).toMatchObject({
      parts: [{ type: "text", text: "partial" }],
      metadata: { streamState: "failure", errorCode: "provider-disconnected" },
    })

    const unavailable = setup()
    const unavailableService = unavailable.service(async () => {
      throw new Error("connect ECONNREFUSED http://127.0.0.1:11434?token=secret")
    })
    const unavailableChunks = await collect(
      unavailableService.stream(input({ runId: "run-unavailable" })),
    )
    expect(unavailableChunks).toContainEqual({
      type: "error",
      errorText: "Ollama is not reachable on the configured local endpoint.",
    })
    expect(JSON.stringify(unavailableChunks)).not.toContain("token=secret")
  })

  it("cancels a superseded sub-chat stream without overwriting the newer run", async () => {
    const fixture = setup()
    const service = fixture.service(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      return body.messages.at(-1)?.content === "first"
        ? openStreamResponse()
        : byteStreamResponse(['{"message":{"content":"replacement"},"done":true}\n'])
    })
    const first = service.stream(input({ runId: "run-first", prompt: "first" }))
    await first.next()
    await first.next()
    await first.next()

    const replacement = await collect(
      service.stream(input({ runId: "run-replacement", prompt: "second" })),
    )
    expect(replacement).toContainEqual({
      type: "text-delta",
      id: "local-response",
      delta: "replacement",
    })
    expect(await collect(first)).toEqual([
      { type: "text-end", id: "local-response" },
      { type: "finish" },
    ])
    expect(fixture.run("run-first")).toMatchObject({ status: "cancelled" })
    expect(fixture.run("run-replacement")).toMatchObject({ status: "success" })
    expect(fixture.subChat()).toMatchObject({ stream_id: null, run_status: "success" })
    expect(fixture.messages().slice(-3)).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ streamState: "cancelled" }) }),
      expect.objectContaining({ role: "user", parts: [{ type: "text", text: "second" }] }),
      expect.objectContaining({
        role: "assistant",
        parts: [{ type: "text", text: "replacement" }],
        metadata: expect.objectContaining({ streamState: "success" }),
      }),
    ])
  })

  it("never reconnects ordinary streams and finalizes abandoned local runs after restart", async () => {
    const fixture = setup()
    fixture.persistence.begin({
      runId: "run-abandoned",
      streamId: "stream-abandoned",
      chatId: "chat-1",
      subChatId: "sub-1",
      prompt: "unfinished",
      promptMessageId: "prompt-abandoned",
      assistantMessageId: "assistant-abandoned",
      model: "fixture:latest",
      permissionMode: "read-only",
      customPermissions: null,
      worktreePath: "/repo",
      metadata,
      context: contextBundle.metadata,
    })

    const restartedService = fixture.service(async () => {
      throw new Error("not used")
    })
    expect(restartedService.reconnect("run-abandoned")).toEqual({
      reconnectable: false,
      reason: "ordinary-streams-are-not-resumable",
      message: "Local model streams cannot reconnect after their owning process exits.",
    })
    expect(restartedService.recoverAbandoned(new Date(NOW))).toBe(1)
    expect(fixture.run("run-abandoned")).toMatchObject({
      status: "failure",
      completed_at: NOW / 1_000,
    })
    expect(fixture.subChat()).toMatchObject({ stream_id: null, run_status: "failure" })
    expect(fixture.messages().at(-1)).toMatchObject({
      metadata: { streamState: "failure", errorCode: "abandoned-stream" },
    })
    expect(restartedService.recoverAbandoned(new Date(NOW + 1))).toBe(0)
    expect(await collect(restartedService.stream(input({ runId: "run-abandoned" })))).toEqual([
      {
        type: "error",
        errorText: "This local model run is already active or terminal and cannot resume.",
      },
      { type: "finish" },
    ])
    expect(fixture.run("run-abandoned")).toMatchObject({ status: "failure" })
  })

  it("assembles a bounded text-only transcript and validates normalized records", () => {
    expect(
      assembleLocalModelMessages({
        context: "system",
        transcript: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "drop".repeat(400) }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "keep" }] },
          { id: "empty", role: "assistant", parts: [{ type: "tool", text: "ignored" }] },
        ],
        prompt: "next",
        maxTranscriptChars: 1_000,
      }),
    ).toEqual([
      { role: "system", content: "system" },
      { role: "assistant", content: "keep" },
      { role: "user", content: "next" },
    ])
    expect(parseOllamaChatLine('{"message":{"content":"x"},"done":false}')).toEqual([
      { kind: "text-delta", delta: "x" },
    ])
    expect(() => parseOllamaChatLine('{"error":"model missing","done":false}')).toThrow(
      "Ollama rejected the local chat request.",
    )
  })
})

function setup() {
  const sqlite = new Database(":memory:")
  databases.push(sqlite)
  sqlite.exec(`
    CREATE TABLE chats (
      id text PRIMARY KEY,
      harness text,
      model text
    );
    CREATE TABLE sub_chats (
      id text PRIMARY KEY,
      chat_id text NOT NULL,
      session_id text,
      stream_id text,
      harness text,
      model text,
      permission_mode text,
      worktree_path text,
      run_status text,
      messages text NOT NULL DEFAULT '[]',
      updated_at integer
    );
    CREATE TABLE agent_runs (
      id text PRIMARY KEY,
      chat_id text NOT NULL,
      sub_chat_id text,
      harness text NOT NULL,
      model text,
      permission_mode text NOT NULL,
      custom_permissions text,
      worktree_path text,
      prompt_message_id text,
      initial_prompt text,
      vault_context_sections text,
      vault_context_manifest text,
      status text NOT NULL DEFAULT 'running',
      started_at integer,
      completed_at integer,
      before_checkpoint_id text,
      after_checkpoint_id text
    );
  `)
  sqlite.prepare("INSERT INTO chats (id) VALUES ('chat-1')").run()
  sqlite.prepare("INSERT INTO sub_chats (id, chat_id, messages) VALUES (?, ?, ?)").run(
    "sub-1",
    "chat-1",
    JSON.stringify([
      { id: "old-user", role: "user", parts: [{ type: "text", text: "old question" }] },
      {
        id: "old-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "old answer" }],
      },
    ]),
  )
  const db = drizzle(sqlite, { schema })
  const persistence = createDatabaseLocalModelRunPersistence(db)
  return {
    persistence,
    service(
      fetchImpl: typeof fetch,
      context = contextBundle,
      createReadToolExecutor?: (rootPath: string) => LocalModelReadToolExecutor,
    ) {
      return new LocalModelChatService({
        persistence,
        fetchImpl,
        buildContext: async () => context,
        createReadToolExecutor,
        now: () => NOW,
      })
    },
    run(runId: string) {
      return sqlite.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as Record<
        string,
        unknown
      >
    },
    subChat() {
      return sqlite.prepare("SELECT * FROM sub_chats WHERE id = 'sub-1'").get() as Record<
        string,
        unknown
      >
    },
    messages() {
      const row = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-1'").get() as {
        messages: string
      }
      return JSON.parse(row.messages) as Array<Record<string, unknown>>
    },
  }
}

const metadata: LocalModelRunMetadata = {
  contractVersion: 1,
  harness: "local",
  provider: {
    harness: "local",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    version: "0.9.1",
  },
  model: {
    provider: "ollama",
    modelId: "fixture:latest",
    digest: "sha256:fixture",
    modifiedAt: "2026-07-14T11:00:00.000Z",
    family: "fixture",
    parameterSize: "3B",
    quantizationLevel: "Q4",
    contextWindow: 8192,
  },
  capabilities: {
    chat: { state: "supported", source: "provider-declared", evidence: "completion" },
    streaming: { state: "supported", source: "provider-contract", evidence: "/api/chat" },
    tools: { state: "unsupported", source: "provider-declared", evidence: "absent" },
    vision: { state: "unsupported", source: "provider-declared", evidence: "absent" },
  },
  permission: { mode: "read-only", customPermissions: null, toolTiers: [] },
  catalog: {
    schemaVersion: 1,
    capturedAt: "2026-07-14T11:59:00.000Z",
    expiresAt: "2026-07-14T12:04:00.000Z",
  },
  fallback: { mode: "none", cloudAllowed: false, reason: "cloud-fallback-disabled" },
}

const toolMetadata: LocalModelRunMetadata = {
  ...metadata,
  capabilities: {
    ...metadata.capabilities,
    tools: { state: "supported", source: "provider-declared", evidence: "tools" },
  },
  permission: {
    ...metadata.permission,
    toolTiers: [
      {
        tier: "read",
        requiredCapability: "tools",
        mutates: false,
        customPermission: null,
        available: true,
        limitation: null,
      },
    ],
  },
}

const contextBundle = {
  context: "project context",
  metadata: {
    mode: "new" as const,
    sourcePaths: ["/repo/AGENTS.md"],
    sourceFingerprint: "a".repeat(64),
    sourceChars: 15,
  },
}

function input(overrides: Partial<StreamLocalModelChatInput> = {}): StreamLocalModelChatInput {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subChatId: "sub-1",
    prompt: "new question",
    model: "fixture:latest",
    permissionMode: "read-only",
    cwd: "/repo",
    worktreePath: "/repo",
    metadata,
    ...overrides,
  }
}

function byteStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  )
}

function openStreamResponse(): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"message":{"role":"assistant","content":"kept"},"done":false}\n'),
        )
        // Deliberately stays open until the consumer aborts and cancels the reader.
      },
    }),
    { status: 200 },
  )
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of stream) values.push(value)
  return values
}
