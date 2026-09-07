import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"

const mocks = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock("electron", () => ({
  app: { getPath: () => process.env.FLAPSTACK_TEST_USER_DATA, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock("../src/main/lib/harness/opencode-sidecar", async (original) => ({
  ...(await original<typeof import("../src/main/lib/harness/opencode-sidecar")>()),
  getProviderKeyAsync: async () => "fixture-key",
  getAvailableProviderModels: () => ({ source: "cache", models: [{ id: "fixture" }] }),
  runSidecarSession: mocks.session,
}))
vi.mock("../src/main/lib/checkpoints", () => ({
  captureCheckpoint: async () => ({ id: null }),
  captureRunManifest: async () => undefined,
}))
vi.mock("../src/main/lib/harness/launch-context", () => ({
  buildHarnessContextBundle: async () => ({
    context: "",
    metadata: { sourceFingerprint: "fixture" },
  }),
  getLastHarnessContextFingerprint: () => undefined,
  prependStartupContext: (prompt: string) => prompt,
}))
vi.mock("../src/main/lib/mcp-control/exposure", () => ({
  getChatMcpExposure: () => false,
  registerActiveProductMcpSession: () => () => undefined,
}))
import { closeDatabase } from "../src/main/lib/db"
import { queueChatRun } from "../src/main/lib/run-launch-service"
import { opencodeRouter } from "../src/main/lib/trpc/routers/opencode"

let directory: string, sqlite: Database.Database
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-opencode-queue-"))
  process.env.FLAPSTACK_DB_PATH = join(directory, "agents.db")
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  sqlite = new Database(process.env.FLAPSTACK_DB_PATH)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve("drizzle") })
  const db = drizzle(sqlite, { schema })
  db.insert(schema.projects).values({ id: "project", name: "Fixture", path: directory }).run()
  db.insert(schema.chats)
    .values({
      id: "chat",
      projectId: "project",
      harness: "openrouter",
      model: "openrouter/fixture",
      permissionMode: "read-only",
      worktreePath: directory,
    })
    .run()
  db.insert(schema.subChats)
    .values({
      id: "sub",
      chatId: "chat",
      harness: "openrouter",
      model: "openrouter/fixture",
      permissionMode: "read-only",
    })
    .run()
  mocks.session.mockReset().mockImplementation(async function* () {
    yield { kind: "text-delta", partId: "answer", delta: "Fixture answer" }
    yield { kind: "done" }
  })
})
afterEach(() => {
  closeDatabase()
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})
it("launches an existing durable run without inserting it again", async () => {
  const queued = queueChatRun(sqlite, {
    chatId: "chat",
    subChatId: "sub",
    initialPrompt: "Review this",
    idempotencyKey: "feedback-fixture",
  })
  if (!queued.ok) throw new Error(queued.message)
  sqlite.prepare("UPDATE sub_chats SET messages=? WHERE id='sub'").run(
    JSON.stringify([
      {
        id: "mcp-feedback-fixture",
        role: "user",
        parts: [{ type: "text", text: "Review this" }],
      },
      { id: "later", role: "user", parts: [{ type: "text", text: "Later work" }] },
    ]),
  )
  const stream = await opencodeRouter.createCaller({ getWindow: () => null }).chat({
    runId: queued.runId,
    chatId: "chat",
    subChatId: "sub",
    provider: "openrouter",
    model: "openrouter/fixture",
    prompt: "Review this",
    cwd: directory,
  })
  const chunks: any[] = []
  await new Promise<void>((resolve, reject) => {
    stream.subscribe({ next: (chunk: any) => chunks.push(chunk), error: reject, complete: resolve })
  })
  expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([])
  expect(mocks.session).toHaveBeenCalledOnce()
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
  const stored = sqlite.prepare("SELECT messages FROM sub_chats WHERE id='sub'").get() as {
    messages: string
  }
  const messages = JSON.parse(stored.messages)
  expect(
    messages.filter((message: any) => message.role === "user").map((message: any) => message.id),
  ).toEqual(["mcp-feedback-fixture", "later"])
  expect(messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"])
})

it.each(["status='success'", "harness='nanogpt'", "initial_prompt='different'"])(
  "rejects mismatched or terminal queued authority: %s",
  async (change) => {
    const queued = queueChatRun(sqlite, {
      chatId: "chat",
      subChatId: "sub",
      initialPrompt: "Review this",
      idempotencyKey: "guard-fixture",
    })
    if (!queued.ok) throw new Error(queued.message)
    sqlite.prepare(`UPDATE agent_runs SET ${change} WHERE id=?`).run(queued.runId)
    const stream = await opencodeRouter.createCaller({ getWindow: () => null }).chat({
      runId: queued.runId,
      chatId: "chat",
      subChatId: "sub",
      provider: "openrouter",
      model: "openrouter/fixture",
      prompt: "Review this",
      cwd: directory,
    })
    const chunks: any[] = []
    await new Promise<void>((resolve, reject) =>
      stream.subscribe({
        next: (chunk: any) => chunks.push(chunk),
        error: reject,
        complete: resolve,
      }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "error", errorText: expect.stringContaining("unavailable") }),
    )
    expect(mocks.session).not.toHaveBeenCalled()
    expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id='sub'").get()).toEqual({
      messages: "[]",
    })
  },
)
