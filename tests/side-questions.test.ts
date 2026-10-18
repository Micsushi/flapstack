import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SideQuestionService,
  snapshotMessages,
  type SideQuestionGenerator,
} from "../src/main/lib/side-questions/service"
import {
  codexSideQuestionConfig,
  runCodexSideAnswer,
  runClaudeSideAnswer,
  completedLocalSideAnswer,
} from "../src/main/lib/side-questions/provider"
import type { CodexProtocolClient } from "../src/main/lib/agent-runtime/codex/protocol-client"

const databases: Database.Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function fixture(generate: SideQuestionGenerator = async () => "An answer") {
  const db = new Database(":memory:")
  databases.push(db)
  db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, project_id TEXT, task_id TEXT, scope TEXT, permission_mode TEXT, harness TEXT, model TEXT, parent_chat_id TEXT, worktree_path TEXT, branch TEXT, base_branch TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE sub_chats (id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE, name TEXT, messages TEXT, run_status TEXT, harness TEXT, model TEXT, permission_mode TEXT, mode TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE agent_activity_events (sub_chat_id TEXT, kind TEXT, payload_json TEXT, display_class TEXT, privacy_class TEXT, redaction_state TEXT, storage_id INTEGER);
  INSERT INTO chats (id, scope, harness, model) VALUES ('parent','global','codex','gpt-example');
  INSERT INTO sub_chats (id, chat_id, messages, run_status) VALUES ('source','parent','[]','running');
  INSERT INTO chats (id, scope) VALUES ('other','global');
  INSERT INTO sub_chats (id, chat_id, messages) VALUES ('elsewhere','other','[]');`)
  db.exec(readFileSync(new URL("../drizzle/0076_side_questions.sql", import.meta.url), "utf8"))
  return { db, service: new SideQuestionService(db, generate) }
}
const ask = (extra = {}) => ({
  subChatId: "source",
  requestId: randomUUID(),
  question: "What is done?",
  ...extra,
})
const settle = () => new Promise((resolve) => setImmediate(resolve))

describe("independent side questions", () => {
  it("keeps provider work and answers out of the running parent; deduplicates retries", async () => {
    const generate = vi.fn<SideQuestionGenerator>(async () => "Tests passed.")
    const { db, service } = fixture(generate)
    const input = ask()
    expect(service.ask(input).status).toBe("running")
    expect(service.ask(input).id).toBe(input.requestId)
    await settle()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(service.list("source")[0]).toMatchObject({
      status: "completed",
      answer: "Tests passed.",
      provider: "codex",
      model: "gpt-example",
    })
    expect(
      db.prepare("SELECT messages, run_status FROM sub_chats WHERE id='source'").get(),
    ).toEqual({ messages: "[]", run_status: "running" })
    expect(db.prepare("SELECT count(*) n FROM chats").get()).toEqual({ n: 2 })
  })
  it("captures streamed text and only public visible source activity", async () => {
    const generate = vi.fn<SideQuestionGenerator>(async () => "Answer")
    const { db, service } = fixture(generate)
    const insert = db.prepare("INSERT INTO agent_activity_events VALUES (?,?,?,?,?,?,?)")
    insert.run(
      "source",
      "status",
      JSON.stringify({ text: "Build passed" }),
      "status",
      "public",
      "none",
      1,
    )
    insert.run(
      "source",
      "status",
      JSON.stringify({ text: "private secret" }),
      "status",
      "private",
      "none",
      2,
    )
    insert.run(
      "elsewhere",
      "status",
      JSON.stringify({ text: "other chat" }),
      "status",
      "public",
      "none",
      3,
    )
    service.ask(
      ask({
        visibleMessages: [{ id: "streaming", role: "assistant", text: "Currently building" }],
      }),
    )
    await settle()
    const prompt = generate.mock.calls[0][0].prompt
    expect(prompt).toContain("Currently building")
    expect(prompt).toContain("Build passed")
    expect(prompt).not.toContain("private secret")
    expect(prompt).not.toContain("other chat")
  })
  it("scopes every action and prevents idempotency key reuse", async () => {
    const { service } = fixture()
    const input = ask()
    service.ask(input)
    await settle()
    expect(() => service.cancel("elsewhere", input.requestId)).toThrow("not found")
    expect(() => service.promote("elsewhere", input.requestId)).toThrow("not found")
    expect(() => service.ask({ ...input, question: "Different" })).toThrow("different question")
    expect(() => service.ask(ask({ threadId: input.requestId, subChatId: "elsewhere" }))).toThrow(
      "not found",
    )
  })
  it("cancels only its own signal and discards a late answer", async () => {
    let resolve!: (text: string) => void
    const generate = vi.fn<SideQuestionGenerator>(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { db, service } = fixture(generate)
    const entry = service.ask(ask())
    service.cancel("source", entry.id)
    expect(generate.mock.calls[0][0].signal.aborted).toBe(true)
    resolve("Late")
    await settle()
    expect(service.list("source")[0]).toMatchObject({ status: "cancelled", answer: "" })
    expect(db.prepare("SELECT run_status FROM sub_chats WHERE id='source'").get()).toEqual({
      run_status: "running",
    })
  })
  it("retry uses the original captured context and survives provider failure", async () => {
    const generate = vi
      .fn<SideQuestionGenerator>()
      .mockRejectedValueOnce(new Error("private provider failure"))
      .mockResolvedValueOnce("Recovered")
    const { service } = fixture(generate)
    const entry = service.ask(ask())
    await settle()
    expect(service.list("source")[0].error).not.toContain("private provider failure")
    service.retry("source", entry.id)
    await settle()
    expect(service.list("source")[0].status).toBe("completed")
    expect(generate.mock.calls[0][0].prompt).toBe(generate.mock.calls[1][0].prompt)
  })
  it("includes prior side answers and promotes the whole exchange once without a provider session", async () => {
    const generate = vi.fn<SideQuestionGenerator>(async () => "Answer")
    const { db, service } = fixture(generate)
    const first = service.ask(ask())
    await settle()
    const second = service.ask(ask({ threadId: first.id, question: "Explain that" }))
    await settle()
    expect(generate.mock.calls[1][0].prompt).toContain(
      '"previous":[{"question":"What is done?","answer":"Answer"}]',
    )
    const promoted = service.promote("source", second.id)
    expect(service.promote("source", first.id)).toEqual(promoted)
    const child = db
      .prepare("SELECT messages, mode FROM sub_chats WHERE id=?")
      .get(promoted.subChatId) as { messages: string; mode: string }
    expect(JSON.parse(child.messages)).toHaveLength(5)
    expect(child.mode).toBe("read")
    expect(() => service.ask(ask({ threadId: first.id }))).toThrow("separate chat")
    expect(db.prepare("SELECT messages FROM sub_chats WHERE id='source'").get()).toEqual({
      messages: "[]",
    })
  })
  it("recovers interrupted questions after restart", () => {
    const { db } = fixture()
    const entry = {
      id: randomUUID(),
      subChatId: "source",
      threadId: randomUUID(),
      question: "q",
      answer: "",
      status: "running",
      error: null,
      provider: "codex",
      model: null,
      createdAt: 1,
      updatedAt: 1,
      promotedChatId: null,
    }
    db.prepare("INSERT INTO side_questions VALUES (?,?,?,?,?,?)").run(
      entry.id,
      "source",
      entry.threadId,
      JSON.stringify(entry),
      "{}",
      1,
    )
    const service = new SideQuestionService(db, async () => "not called")
    expect(service.list("source")[0].status).toBe("failed")
  })
  it("does not create a phantom running question when the database lease is refused", () => {
    const { db } = fixture()
    const generate = vi.fn<SideQuestionGenerator>(async () => "answer")
    const service = new SideQuestionService(db, generate, () => {
      throw new Error("maintenance")
    })
    expect(() => service.ask(ask())).toThrow("maintenance")
    expect(service.list("source")).toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })
  it("can recreate a promoted chat after that separate chat is deleted", async () => {
    const { db, service } = fixture()
    const entry = service.ask(ask())
    await settle()
    const first = service.promote("source", entry.id)
    db.prepare("DELETE FROM chats WHERE id=?").run(first.chatId)
    const replacement = service.promote("source", entry.id)
    expect(replacement.chatId).not.toBe(first.chatId)
    expect(service.promote("source", entry.id)).toEqual(replacement)
  })
  it("does not pass a stale model to a different profile harness", async () => {
    const { db } = fixture()
    db.prepare("UPDATE chats SET harness='claude-code', model='claude-old' WHERE id='parent'").run()
    const generate = vi.fn<SideQuestionGenerator>(async () => "answer")
    const service = new SideQuestionService(
      db,
      generate,
      () => () => {},
      () => ({ harness: "codex", model: null }),
    )
    const entry = service.ask(ask())
    await settle()
    expect(entry).toMatchObject({ provider: "codex", model: null })
    expect(generate.mock.calls[0][0]).toMatchObject({ provider: "codex", model: null })
    const followup = service.ask(ask({ threadId: entry.id }))
    await settle()
    expect(followup.model).toBeNull()
  })
  it("preserves an explicit model when changing providers", async () => {
    const { service } = fixture()
    const entry = service.ask(ask({ provider: "claude", model: "claude-chosen" }))
    await settle()
    expect(entry).toMatchObject({ provider: "claude", model: "claude-chosen" })
  })
  it("bounds snapshots while retaining latest streaming text", () => {
    const saved = JSON.stringify([
      { id: "one", role: "assistant", parts: [{ type: "text", text: "old" }] },
    ])
    expect(
      snapshotMessages(saved, [{ id: "one", role: "assistant", text: "new" }]).messages,
    ).toEqual([{ id: "one", role: "assistant", text: "new" }])
    const result = snapshotMessages(
      JSON.stringify(
        Array.from({ length: 20 }, (_, i) => ({
          id: String(i),
          role: "user",
          content: "x".repeat(24000),
        })),
      ),
    )
    expect(result.truncated).toBe(true)
    expect(result.messages.reduce((n, m) => n + m.text.length, 0)).toBe(120000)
  })
})

describe("Codex side-answer isolation", () => {
  it("disables inherited MCP names from active config layers", () => {
    const config = codexSideQuestionConfig({
      layers: [
        { config: { mcp_servers: { files: { command: "danger" } } } },
        { config: { mcp_servers: { other: { url: "remote" } } } },
      ],
    })
    expect(config.mcp_servers).toEqual({ files: { enabled: false }, other: { enabled: false } })
    expect(config).toMatchObject({
      web_search: "disabled",
      features: { shell_tool: false, hooks: false, multi_agent: false },
      agents: { enabled: false },
    })
    expect(() => codexSideQuestionConfig({})).toThrow("configuration layers")
  })
  it("starts a fresh ephemeral tool-disabled thread and closes only its own client", async () => {
    const request = vi.fn(async (method: string) =>
      method === "config/read"
        ? { layers: [] }
        : method === "thread/start"
          ? { thread: { id: "side" } }
          : method === "turn/start"
            ? { turn: { id: "turn" } }
            : {},
    )
    const client: CodexProtocolClient = {
      request,
      close: vi.fn(async () => {}),
      setRequestHandler: vi.fn(),
      diagnostics: () => "",
      isAlive: () => true,
      async *notifications() {
        yield { method: "item/agentMessage/delta", params: { threadId: "side", delta: "Answer" } }
        yield {
          method: "turn/completed",
          params: { threadId: "side", turn: { id: "turn", status: "completed" } },
        }
      },
    }
    expect(
      await runCodexSideAnswer(
        client,
        {
          provider: "codex",
          model: "model/high",
          prompt: "question",
          signal: new AbortController().signal,
        },
        "empty",
      ),
    ).toBe("Answer")
    expect(request).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({
        ephemeral: true,
        environments: [],
        dynamicTools: [],
        approvalPolicy: "never",
        sandbox: "read-only",
        model: "model",
      }),
    )
    expect(request.mock.calls.some((call) => /resume|fork|interrupt/.test(call[0]))).toBe(false)
    expect(client.close).toHaveBeenCalledTimes(1)
  })
})

describe("Claude side-answer completion", () => {
  it("rejects partial text followed by EOF and requires a success result", async () => {
    const input = {
      provider: "claude" as const,
      model: null,
      prompt: "q",
      signal: new AbortController().signal,
    }
    async function* partial() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "Partial" }] } }
    }
    await expect(runClaudeSideAnswer(partial, input, "empty", "binary", {})).rejects.toThrow(
      "disconnected",
    )
    async function* complete() {
      yield* partial()
      yield { type: "result", subtype: "success" }
    }
    await expect(runClaudeSideAnswer(complete, input, "empty", "binary", {})).resolves.toBe(
      "Partial",
    )
  })
})

describe("side-answer output limits", () => {
  it("rejects an Ollama token-limit stop even with done true", () => {
    expect(() =>
      completedLocalSideAnswer({ response: "Partial", done: true, done_reason: "length" }),
    ).toThrow("output limit")
    expect(
      completedLocalSideAnswer({ response: "Complete", done: true, done_reason: "stop" }),
    ).toBe("Complete")
  })
  it("rejects a Claude token-limit stop even with a successful result", async () => {
    async function* stream() {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "Partial" }], stop_reason: "max_tokens" },
      }
      yield { type: "result", subtype: "success" }
    }
    await expect(
      runClaudeSideAnswer(
        stream,
        { provider: "claude", model: null, prompt: "q", signal: new AbortController().signal },
        "empty",
        "binary",
        {},
      ),
    ).rejects.toThrow("output limit")
  })
})
