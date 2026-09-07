// @vitest-environment jsdom

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const catalogMocks = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock("../src/main/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/lib/permissions")>()),
  getPermissionPreferences: () => ({ globalDefault: "read-only" }),
}))
const transportMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock("../src/main/lib/harness/local-model-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/lib/harness/local-model-catalog")>()
  return {
    ...actual,
    probeLocalModelCatalog: catalogMocks.probe,
  }
})

vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: {
    localModels: {
      chat: { subscribe: transportMocks.subscribe },
      cancel: { mutate: transportMocks.cancel },
    },
  },
}))

import { eq } from "drizzle-orm"
import {
  agentRuns,
  chats,
  closeDatabase,
  getDatabase,
  getSqliteDatabase,
  projects,
  subChats,
  usageSamples,
} from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { bindRegisteredFilesystemRoot } from "../src/main/lib/git/security/path-validation"
import { localModelsRouter } from "../src/main/lib/trpc/routers/local-models"
import { queueChatRun, drainPendingMcpRuns } from "../src/main/lib/run-launch-service"
import { DiffAnnotationService } from "../src/main/lib/diff-annotations/service"
import { DiffFeedbackService } from "../src/main/lib/diff-annotations/feedback"
import { LocalModelChatTransport } from "../src/renderer/features/agents/lib/local-model-chat-transport"
import {
  LOCAL_MODEL_CATALOG_CACHE_VERSION,
  type LocalModelCatalogSnapshot,
} from "../src/shared/local-model-contract"
import {
  LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
  LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS,
  LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
} from "../src/shared/local-model-dev-fixture"

const caller = localModelsRouter.createCaller({ getWindow: () => null })
const endpoint = "http://127.0.0.1:11434"
const model = "fixture-tools:latest"

let fixtureDir: string
let databasePath: string
let registeredPath: string
let canonicalPath: string

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "flapstack-local-route-"))
  canonicalPath = join(fixtureDir, "root")
  mkdirSync(canonicalPath)
  registeredPath = `${canonicalPath}/../root`
  databasePath = join(fixtureDir, "agents.db")

  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath

  getDatabase()
    .insert(projects)
    .values({ id: "project-local-route", name: "Local route", path: registeredPath })
    .run()
  bindRegisteredFilesystemRoot(registeredPath)
})

beforeEach(() => {
  catalogMocks.probe.mockReset().mockResolvedValue(catalog("ready"))
  transportMocks.subscribe.mockReset()
  transportMocks.cancel.mockReset().mockResolvedValue({ cancelled: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ELECTRON_RENDERER_URL
})

afterAll(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe("local model router bridge", () => {
  it.each([
    "foreign-harness",
    "foreign-runtime",
    "terminal",
    "ordinary-running",
    "changed-prompt",
    "changed-message",
    "occupied-stream",
  ])("does not adopt a %s run", async (kind) => {
    seedChat(kind, { chatPermission: "read-only" })
    const sqlite = getSqliteDatabase()
    const queued = queueChatRun(sqlite, {
      chatId: `chat-${kind}`,
      subChatId: `sub-${kind}`,
      initialPrompt: "Answer locally",
      idempotencyKey: kind,
    })
    if (!queued.ok) throw new Error(queued.message)
    if (kind === "foreign-harness")
      sqlite.prepare("UPDATE agent_runs SET harness='codex' WHERE id=?").run(queued.runId)
    if (kind === "foreign-runtime") {
      const record = readRun(queued.runId)!
      // Create the incompatible fixture without weakening immutable-snapshot triggers.
      getDatabase().delete(agentRuns).where(eq(agentRuns.id, queued.runId)).run()
      getDatabase()
        .insert(agentRuns)
        .values({ ...record, resolvedRuntime: "codex" })
        .run()
    }
    if (kind === "changed-message")
      sqlite.prepare("UPDATE sub_chats SET messages=? WHERE id=?").run(
        JSON.stringify([
          {
            id: readRun(queued.runId)!.promptMessageId,
            role: "user",
            parts: [{ type: "text", text: "changed persisted prompt" }],
          },
        ]),
        `sub-${kind}`,
      )
    if (kind === "terminal")
      sqlite.prepare("UPDATE agent_runs SET status='success' WHERE id=?").run(queued.runId)
    if (kind === "ordinary-running")
      sqlite
        .prepare("UPDATE agent_runs SET status='running', prompt_message_id='ordinary' WHERE id=?")
        .run(queued.runId)
    if (kind === "changed-prompt")
      sqlite
        .prepare("UPDATE agent_runs SET initial_prompt='different' WHERE id=?")
        .run(queued.runId)
    if (kind === "occupied-stream") {
      sqlite.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(queued.runId)
      sqlite.prepare("UPDATE sub_chats SET stream_id='other-stream' WHERE id=?").run(`sub-${kind}`)
    }
    const before = readRun(queued.runId)
    const beforeMessages = sqlite
      .prepare("SELECT messages FROM sub_chats WHERE id=?")
      .get(`sub-${kind}`)
    const fetchMock = successFetch()
    vi.stubGlobal("fetch", fetchMock)
    try {
      const chunks = await collect(await caller.chat(input(kind, { runId: queued.runId })))
      expect(chunks).toContainEqual(expect.objectContaining({ type: "error" }))
      expect(fetchMock).not.toHaveBeenCalled()
      expect(readRun(queued.runId)).toEqual(before)
      expect(
        sqlite.prepare("SELECT messages FROM sub_chats WHERE id=?").get(`sub-${kind}`),
      ).toEqual(beforeMessages)
    } finally {
      sqlite.prepare("UPDATE agent_runs SET status='cancelled' WHERE id=?").run(queued.runId)
    }
  })

  it("adopts a claimed queued run without changing its snapshot or later chat preferences", async () => {
    seedChat("queued", { chatPermission: "read-only" })
    const queued = queueChatRun(getSqliteDatabase(), {
      chatId: "chat-queued",
      subChatId: "sub-queued",
      initialPrompt: "queued question",
      idempotencyKey: "local-queued",
    })
    if (!queued.ok) throw new Error(queued.message)
    const before = readRun(queued.runId)!
    const db = getDatabase()
    db.update(subChats)
      .set({
        permissionMode: "full-access",
        model: "new-preference",
        messages: JSON.stringify([
          {
            id: before.promptMessageId,
            role: "user",
            parts: [{ type: "text", text: "queued question" }],
          },
          { id: "later-user", role: "user", parts: [{ type: "text", text: "later question" }] },
        ]),
      })
      .where(eq(subChats.id, "sub-queued"))
      .run()
    db.update(chats)
      .set({ permissionMode: "full-access", model: "new-preference" })
      .where(eq(chats.id, "chat-queued"))
      .run()
    const fetchMock = successFetch()
    vi.stubGlobal("fetch", fetchMock)
    expect(
      await drainPendingMcpRuns(
        databasePath,
        async (run) => {
          const chunks = await collect(
            await caller.chat(
              input("queued", {
                runId: run.runId,
                prompt: run.prompt,
                model: run.model!,
              }),
            ),
          )
          expect(chunks.some((chunk) => chunk.type === "error")).toBe(false)
        },
        { waitForCompletion: true },
      ),
    ).toBe(1)
    expect(readRun(queued.runId)).toMatchObject({
      status: "success",
      permissionMode: before.permissionMode,
      model: before.model,
      customPermissions: before.customPermissions,
      promptMessageId: before.promptMessageId,
      runtimeCapabilitySnapshot: before.runtimeCapabilitySnapshot,
    })
    const row = db.select().from(subChats).where(eq(subChats.id, "sub-queued")).get()!
    expect(row).toMatchObject({ permissionMode: "full-access", model: "new-preference" })
    const messages = JSON.parse(row.messages)
    expect(messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"])
    expect(messages[0].id).toBe(before.promptMessageId)
    expect(messages[1].metadata.localModel.permission.mode).toBe("read-only")
    expect(messages[2].id).toBe("later-user")
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.model).toBe(model)
    expect(
      body.messages.filter((message: any) => message.content.includes("queued question")),
    ).toHaveLength(1)
    expect(JSON.stringify(body.messages)).not.toContain("later question")
    expect(
      await drainPendingMcpRuns(databasePath, async () => {
        throw new Error("duplicate")
      }),
    ).toBe(0)
  })

  it("reports loopback-only diagnostics with no cloud fallback", async () => {
    await expect(caller.diagnostics({ endpoint })).resolves.toMatchObject({
      provider: "ollama",
      endpoint,
      endpointPolicy: "loopback-only",
      activeRunCount: 0,
      reconnectable: false,
      cloudFallback: false,
    })
  })

  it("runs a durable feedback batch through the queue claim and local persistence once", async () => {
    seedChat("feedback", { chatPermission: "read-only" })
    const scope = { projectId: "project-local-route", chatId: "chat-feedback" }
    const readDiff = async () => ({
      success: true,
      diff: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n",
    })
    const annotations = new DiffAnnotationService(getDatabase(), readDiff)
    const comment = await annotations.create({
      ...scope,
      id: randomUUID(),
      body: "Review this local change",
      anchor: {
        diffHash: (await annotations.list(scope)).diffHash!,
        filePath: "file.txt",
        side: "right",
        startLine: 1,
        endLine: 1,
      },
    })
    const feedback = new DiffFeedbackService(getSqliteDatabase(), readDiff)
    const request = {
      ...scope,
      id: randomUUID(),
      subChatId: "sub-feedback",
      comments: [{ id: comment.id, version: comment.version }],
    }
    const batch = await feedback.queue(request)
    const fetchMock = successFetch()
    vi.stubGlobal("fetch", fetchMock)
    expect(
      await drainPendingMcpRuns(
        databasePath,
        async (run) => {
          const chunks = await collect(
            await caller.chat(
              input("feedback", { runId: run.runId, prompt: run.prompt, model: run.model! }),
            ),
          )
          expect(chunks.some((chunk) => chunk.type === "error")).toBe(false)
        },
        { waitForCompletion: true },
      ),
    ).toBe(1)
    expect(readRun(batch.runId)?.status).toBe("success")
    expect((await annotations.list(scope)).annotations[0]).toMatchObject({
      lastFeedbackVersion: 1,
      feedback: { status: "success" },
    })
    expect(await feedback.queue(request)).toEqual(batch)
    expect(fetchMock).toHaveBeenCalledOnce()
    const row = getDatabase().select().from(subChats).where(eq(subChats.id, "sub-feedback")).get()!
    expect(JSON.parse(row.messages)).toMatchObject([
      {
        id: `mcp-diff-feedback-${request.id}`,
        role: "user",
        metadata: { feedbackBatchId: batch.id },
      },
      { role: "assistant", metadata: { runId: batch.runId } },
    ])
  })

  it("routes the Dev fixture through normal catalog and persisted chat paths", async () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173"
    const fixtureEndpoint = LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready
    const fixtureCatalog = await caller.catalog({ endpoint: fixtureEndpoint })
    expect(fixtureCatalog).toMatchObject({
      state: "ready",
      provider: { endpoint: fixtureEndpoint },
    })
    expect(fixtureCatalog.models.map((entry) => entry.identity.modelId)).toContain(
      LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
    )
    expect(catalogMocks.probe).not.toHaveBeenCalled()

    seedChat("dev-fixture", {
      chatPermission: "read-only",
      model: LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
    })
    const chunks = await collect(
      await caller.chat(
        input("dev-fixture", {
          endpoint: fixtureEndpoint,
          model: LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
          prompt: "/fixture tool",
          runId: "run-dev-fixture",
        }),
      ),
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text-delta", delta: "Flapstack Dev fixture " }),
        expect.objectContaining({
          type: "text-delta",
          delta: "stream completed. Chat-only fixture exposed no tools.",
        }),
        expect.objectContaining({ type: "finish" }),
      ]),
    )
    expect(chunks.some((chunk) => chunk.type === "tool-input-start")).toBe(false)
    expect(readRun("run-dev-fixture")).toMatchObject({
      status: "success",
      harness: "local",
      model: LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
    })

    seedChat("dev-tools-fixture", {
      chatPermission: "read-only",
      model: LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
    })
    const toolChunks = await collect(
      await caller.chat(
        input("dev-tools-fixture", {
          endpoint: fixtureEndpoint,
          model: LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
          prompt: "/fixture tool",
          runId: "run-dev-tools-fixture",
        }),
      ),
    )
    expect(toolChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-input-start",
          toolName: "fixture_unknown_tool",
        }),
        expect.objectContaining({ type: "tool-output-error" }),
        expect.objectContaining({
          type: "text-delta",
          delta: "stream completed. Tool-capable fixture call was denied safely.",
        }),
      ]),
    )
    expect(readRun("run-dev-tools-fixture")).toMatchObject({
      status: "success",
      model: LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
    })
  })

  it("rejects a renderer model that diverges from persisted local state", async () => {
    seedChat("mismatch", { chatPermission: "read-only" })

    const chunks = await collect(
      await caller.chat(input("mismatch", { runId: "run-mismatch", model: "other:latest" })),
    )

    expect(chunks).toEqual([
      {
        type: "error",
        errorText:
          "The stored local model does not match this launch. Re-select the model and retry.",
      },
      { type: "finish" },
    ])
    expect(catalogMocks.probe).not.toHaveBeenCalled()
    expect(readRun("run-mismatch")).toBeUndefined()
  })

  it.each(["stale", "unavailable"] as const)(
    "fails a %s catalog safely without starting a run",
    async (state) => {
      seedChat(state, { chatPermission: "read-only" })
      catalogMocks.probe.mockResolvedValue(catalog(state))

      const chunks = await collect(await caller.chat(input(state, { runId: `run-${state}` })))

      expect(chunks.at(-2)).toMatchObject({ type: "error" })
      expect(chunks.at(-1)).toEqual({ type: "finish" })
      expect(readRun(`run-${state}`)).toBeUndefined()
    },
  )

  it("uses the sub-chat permission and canonical root, then persists and finalizes", async () => {
    seedChat("override", {
      chatPermission: "full-access",
      subChatPermission: "read-only",
    })
    vi.stubGlobal("fetch", successFetch())

    const chunks = await collect(
      await caller.chat(
        input("override", { runId: "run-override", cwd: join(fixtureDir, "forged") }),
      ),
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text-delta", delta: "local answer" }),
        expect.objectContaining({ type: "finish" }),
      ]),
    )
    expect(readRun("run-override")).toMatchObject({
      status: "success",
      permissionMode: "read-only",
      worktreePath: realpathSync(canonicalPath),
      model,
    })
    expect(
      getDatabase()
        .select({
          providerId: usageSamples.providerId,
          runId: usageSamples.runId,
          inputTokens: usageSamples.inputTokens,
          outputTokens: usageSamples.outputTokens,
          totalTokens: usageSamples.totalTokens,
          costUsd: usageSamples.costUsd,
          costQuality: usageSamples.costQuality,
        })
        .from(usageSamples)
        .where(eq(usageSamples.runId, "run-override"))
        .get(),
    ).toEqual({
      providerId: "local",
      runId: "run-override",
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      costUsd: 0,
      costQuality: "exact",
    })
  })

  it("fails malformed custom permission state closed in persisted metadata", async () => {
    seedChat("custom", {
      chatPermission: "full-access",
      subChatPermission: "custom",
      customPermissions: "{malformed",
    })
    vi.stubGlobal("fetch", successFetch())

    await collect(await caller.chat(input("custom", { runId: "run-custom" })))

    const row = getDatabase()
      .select({ messages: subChats.messages })
      .from(subChats)
      .where(eq(subChats.id, "sub-custom"))
      .get()!
    const messages = JSON.parse(row.messages) as Array<any>
    const metadata = messages.find((message) => message.role === "assistant")?.metadata?.localModel
    expect(metadata.permission.mode).toBe("custom")
    expect(
      metadata.permission.toolTiers
        .filter((tier: any) => ["project-write", "shell", "git", "network"].includes(tier.tier))
        .every((tier: any) => tier.available === false),
    ).toBe(true)
    expect(readRun("run-custom")).toMatchObject({ status: "success", permissionMode: "custom" })
  })

  it("cancels an active real service run through the router", async () => {
    seedChat("cancel", { chatPermission: "read-only" })
    const fetchMock = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          )
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const chunksPromise = collect(await caller.chat(input("cancel", { runId: "run-cancel" })))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const duplicate = await collect(await caller.chat(input("cancel", { runId: "run-cancel" })))
    expect(duplicate).toContainEqual(expect.objectContaining({ type: "error" }))
    expect(readRun("run-cancel")?.status).toBe("running")
    const foreign = await collect(await caller.chat(input("missing", { runId: "run-cancel" })))
    expect(foreign).toContainEqual(expect.objectContaining({ type: "error" }))
    expect(readRun("run-cancel")?.status).toBe("running")
    expect(fetchMock).toHaveBeenCalledOnce()
    const queued = queueChatRun(getSqliteDatabase(), {
      chatId: "chat-cancel",
      subChatId: "sub-cancel",
      initialPrompt: "Answer locally",
      idempotencyKey: "while-active",
    })
    if (!queued.ok) throw new Error(queued.message)
    const premature = await collect(await caller.chat(input("cancel", { runId: queued.runId })))
    expect(premature).toContainEqual(expect.objectContaining({ type: "error" }))
    expect(readRun("run-cancel")?.status).toBe("running")
    expect(readRun(queued.runId)?.status).toBe("pending")
    await expect(caller.cancel({ runId: "run-cancel" })).resolves.toEqual({ cancelled: true })
    const chunks = await chunksPromise

    expect(chunks.at(-1)).toEqual({ type: "finish" })
    expect(readRun("run-cancel")).toMatchObject({ status: "cancelled" })
  })
})

describe("local model renderer transport", () => {
  it("does not subscribe when the request is already aborted", async () => {
    const transport = new LocalModelChatTransport({
      chatId: "chat-aborted",
      subChatId: "sub-aborted",
      cwd: canonicalPath,
      endpoint,
      model,
    })
    const abortController = new AbortController()
    abortController.abort()

    const stream = await transport.sendMessages({
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "Do not run" }] }],
      abortSignal: abortController.signal,
    })

    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    expect(transportMocks.subscribe).not.toHaveBeenCalled()
    expect(transportMocks.cancel).not.toHaveBeenCalled()
  })

  it("streams through the local route and forwards abort to unsubscribe and cancel", async () => {
    let handlers: any
    const unsubscribe = vi.fn()
    transportMocks.subscribe.mockImplementation((_input, nextHandlers) => {
      handlers = nextHandlers
      return { unsubscribe }
    })
    const transport = new LocalModelChatTransport({
      chatId: "chat-transport",
      subChatId: "sub-transport",
      cwd: canonicalPath,
      endpoint,
      model,
    })
    const abortController = new AbortController()

    await transport.sendMessages({
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "Hello local" }] }],
      abortSignal: abortController.signal,
    })

    const request = transportMocks.subscribe.mock.calls[0]![0]
    expect(request).toMatchObject({
      chatId: "chat-transport",
      subChatId: "sub-transport",
      cwd: canonicalPath,
      endpoint,
      model,
      prompt: "Hello local",
    })
    handlers.onData({ type: "start", messageId: "assistant" })
    abortController.abort()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(transportMocks.cancel).toHaveBeenCalledWith({ runId: request.runId })
  })
})

function seedChat(
  suffix: string,
  options: {
    chatPermission: string
    subChatPermission?: string
    customPermissions?: string | null
    model?: string
  },
) {
  const db = getDatabase()
  db.insert(chats)
    .values({
      id: `chat-${suffix}`,
      projectId: "project-local-route",
      scope: "project",
      permissionMode: options.chatPermission,
      customPermissions: options.customPermissions ?? null,
      harness: "local",
      model: options.model ?? model,
      worktreePath: registeredPath,
    })
    .run()
  db.insert(subChats)
    .values({
      id: `sub-${suffix}`,
      chatId: `chat-${suffix}`,
      permissionMode: options.subChatPermission ?? null,
      harness: "local",
      model: options.model ?? model,
      worktreePath: registeredPath,
      messages: "[]",
    })
    .run()
}

function input(
  suffix: string,
  overrides: Partial<{
    runId: string
    model: string
    cwd: string
    endpoint: string
    prompt: string
  }> = {},
) {
  return {
    chatId: `chat-${suffix}`,
    subChatId: `sub-${suffix}`,
    runId: overrides.runId ?? `run-${suffix}`,
    prompt: overrides.prompt ?? "Answer locally",
    model: overrides.model ?? model,
    endpoint: overrides.endpoint ?? endpoint,
    cwd: overrides.cwd ?? registeredPath,
  }
}

function readRun(runId: string) {
  return getDatabase().select().from(agentRuns).where(eq(agentRuns.id, runId)).get()
}

function successFetch() {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(
        [
          JSON.stringify({ message: { content: "local answer" }, done: false }),
          JSON.stringify({ done: true, prompt_eval_count: 2, eval_count: 3 }),
          "",
        ].join("\n"),
        { status: 200 },
      ),
    )
}

function catalog(state: LocalModelCatalogSnapshot["state"]): LocalModelCatalogSnapshot {
  return {
    schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
    provider: { harness: "local", provider: "ollama", endpoint, version: "fixture" },
    state,
    capturedAt: "2026-07-14T20:00:00.000Z",
    expiresAt: "2026-07-14T20:05:00.000Z",
    models:
      state === "unavailable"
        ? []
        : [
            {
              identity: {
                provider: "ollama",
                modelId: model,
                digest: "sha256:fixture",
                modifiedAt: null,
                family: "fixture",
                parameterSize: "7B",
                quantizationLevel: "Q4",
                contextWindow: 8192,
              },
              capabilities: {
                chat: { state: "supported", source: "provider-declared", evidence: "chat" },
                streaming: {
                  state: "supported",
                  source: "provider-contract",
                  evidence: "ollama-api-chat",
                },
                tools: { state: "supported", source: "provider-declared", evidence: "tools" },
                vision: { state: "unsupported", source: "provider-declared", evidence: "absent" },
              },
              limitations: [],
            },
          ],
    limitations:
      state === "stale"
        ? [{ code: "catalog-cache-stale", message: "Cached catalog is stale." }]
        : state === "unavailable"
          ? [{ code: "provider-unavailable", message: "Ollama is unavailable." }]
          : [],
  }
}

async function collect(stream: any): Promise<any[]> {
  const chunks: any[] = []
  if (stream?.[Symbol.asyncIterator]) {
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.subscribe({
      next: (chunk: any) => chunks.push(chunk),
      error: rejectPromise,
      complete: resolvePromise,
    })
  })
  return chunks
}
