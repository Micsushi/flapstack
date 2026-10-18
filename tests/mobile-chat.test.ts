import { formatMessageReply } from "../src/shared/message-replies"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { createMobileChat, sendMobileChat } from "../src/main/lib/mobile-actions/chat"
import { readMobileConversation } from "../src/main/lib/mobile-actions/conversation"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { drainPendingAgentRuns } from "../src/main/lib/run-launch-service"

vi.mock("../src/main/lib/permissions", () => ({
  getPermissionPreferences: () => ({
    globalDefault: "ask-before-edits",
    globalCustomPermissions: {},
  }),
}))
let directory: string
let path: string
let db: Database.Database
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mobile-chat-"))
  path = join(directory, "test.db")
  db = new Database(path)
  db.pragma("foreign_keys = ON")
  migrate(drizzle(db, { schema }), { migrationsFolder: resolve("drizzle") })
  db.prepare(
    "INSERT INTO projects (id,name,path,default_permission_mode) VALUES ('project','Example',?,'read-only')",
  ).run(directory)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it("creates a real queued conversation, inherits permissions, and launches it once", async () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "new-chat",
    message: "Explain this project",
    harness: "codex",
  })
  const conversation = readMobileConversation(db, id)
  expect(conversation.messages.map((message) => message.text)).toEqual(["Explain this project"])
  const launch = vi.fn(async () => {})
  expect(await drainPendingAgentRuns(path, launch, { waitForCompletion: true })).toBe(1)
  expect(launch).toHaveBeenCalledWith(
    expect.objectContaining({
      chatId: id,
      prompt: "Explain this project",
      permissionMode: "read-only",
      harness: "codex",
    }),
  )
  expect(await drainPendingAgentRuns(path, launch, { waitForCompletion: true })).toBe(0)
  expect(() =>
    createMobileChat(db, {
      projectId: "project",
      commandId: "new-chat",
      message: "Duplicate",
      harness: "codex",
    }),
  ).toThrow()
  expect(db.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 1 })
})

it("queues follow-ups without interrupting the active run and rejects another chat's conversation", () => {
  const first = createMobileChat(db, {
    projectId: "project",
    commandId: "first",
    message: "First",
    harness: "codex",
  })
  const second = createMobileChat(db, {
    projectId: "project",
    commandId: "second",
    message: "Second",
    harness: "codex",
  })
  const conversation = readMobileConversation(db, first)
  expect(() =>
    sendMobileChat(db, {
      chatId: second,
      subChatId: conversation.subChatId!,
      commandId: "wrong",
      message: "Wrong",
    }),
  ).toThrow()
  const input = {
    chatId: first,
    subChatId: conversation.subChatId!,
    commandId: "followup",
    message: "Then explain the tests",
  }
  expect(sendMobileChat(db, input)).toBe(true)
  expect(sendMobileChat(db, input)).toBe(true)
  expect(db.prepare("SELECT count(*) count FROM agent_runs WHERE chat_id = ?").get(first)).toEqual({
    count: 2,
  })
  expect(() => readMobileConversation(db, second, conversation.subChatId)).toThrow()
})

it("paginates all long message text while excluding reasoning and redacting credentials", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "history",
    message: "Hello",
    harness: "codex",
  })
  const conversation = readMobileConversation(db, id)
  db.prepare("UPDATE agent_runs SET status='success'").run()
  const text = "a".repeat(100000) + " password=hidden-value"
  db.prepare("UPDATE sub_chats SET messages = ? WHERE id = ?").run(
    JSON.stringify([
      {
        id: "answer",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "private reasoning" },
          { type: "text", text },
        ],
      },
    ]),
    conversation.subChatId,
  )
  const latest = readMobileConversation(db, id)
  const earlier = readMobileConversation(db, id, conversation.subChatId, latest.before!)
  const full = [...earlier.messages, ...latest.messages].map((message) => message.text).join("")
  expect(full).toContain("a".repeat(100000) + " password=[redacted]")
  expect(full).not.toContain("private reasoning")
  expect(earlier.before).toBeNull()
})

it("streams only public assistant text and replaces deltas with their completed message", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "stream",
    message: "Hello",
    harness: "codex",
  })
  db.prepare("UPDATE agent_runs SET status='running'").run()
  const run = db.prepare("SELECT id FROM agent_runs").get() as { id: string }
  const store = createAgentActivityStore(db)
  const event = {
    provider: "codex",
    kind: "agent-text" as const,
    phase: "delta" as const,
    displayClass: "provider-visible" as const,
    privacyClass: "public" as const,
    providerItemId: "item",
    payload: { text: "Hello " },
  }
  store.append(run.id, event)
  store.append(run.id, { ...event, payload: { text: "there" } })
  expect(readMobileConversation(db, id).messages.at(-1)?.text).toBe("Hello there")
  store.append(run.id, { ...event, phase: "completed", payload: { text: "Hello there!" } })
  store.append(run.id, {
    provider: "codex",
    kind: "private-metadata",
    phase: "completed",
    privacyClass: "private",
    displayClass: "private",
    payload: { eventType: "private" },
  })
  expect(readMobileConversation(db, id).messages.at(-1)?.text).toBe("Hello there!")
})

it("preserves submission order for turns queued in the same second", async () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "ordered",
    message: "First",
    harness: "codex",
  })
  const subChatId = readMobileConversation(db, id).subChatId!
  sendMobileChat(db, { chatId: id, subChatId, commandId: "next", message: "Second" })
  db.prepare("UPDATE agent_runs SET started_at = 100").run()
  const prompts: string[] = []
  const launch = async (run: { runId: string; prompt: string }) => {
    prompts.push(run.prompt)
    db.prepare("UPDATE agent_runs SET status='success' WHERE id=?").run(run.runId)
  }
  await drainPendingAgentRuns(path, launch, { waitForCompletion: true })
  await drainPendingAgentRuns(path, launch, { waitForCompletion: true })
  expect(prompts).toEqual(["First", "Second"])
  const row = db.prepare("SELECT messages FROM sub_chats WHERE id=?").get(subChatId) as {
    messages: string
  }
  expect(
    JSON.parse(row.messages).map(
      (message: { parts: Array<{ text: string }> }) => message.parts[0].text,
    ),
  ).toEqual(["First", "Second"])
})

it("sends a full 8000 character reply separately from the user message and rejects cross-chat references", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "reply",
    message: "Start",
    harness: "codex",
  })
  const subChatId = readMobileConversation(db, id).subChatId!
  const text = "x".repeat(8000)
  db.prepare("UPDATE sub_chats SET messages=? WHERE id=?").run(
    JSON.stringify([{ id: "source", role: "assistant", parts: [{ type: "text", text }] }]),
    subChatId,
  )
  const input = {
    chatId: id,
    subChatId,
    commandId: "reply-send",
    message: "Please explain",
    reply: { messageId: "source:0", role: "assistant" as const, text },
  }
  expect(sendMobileChat(db, input)).toBe(true)
  expect(sendMobileChat(db, input)).toBe(true)
  const row = db
    .prepare("SELECT initial_prompt FROM agent_runs WHERE prompt_message_id=?")
    .get("mcp-mobile-reply-send") as { initial_prompt: string }
  expect(row.initial_prompt).toBe(formatMessageReply(input.reply) + "\n\nPlease explain")
  expect(() =>
    sendMobileChat(db, {
      ...input,
      commandId: "wrong-ref",
      reply: { ...input.reply, messageId: "another-chat-message:0" },
    }),
  ).toThrow("referenced message")
})
it("decodes desktop reply references before redacting phone transcript", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "encoded",
    message: "Start",
    harness: "codex",
  })
  const subChatId = readMobileConversation(db, id).subChatId!
  const reply = formatMessageReply({
    messageId: "source",
    role: "assistant",
    text: "password=secret-value",
  })
  const text = "@[quote:preview:" + Buffer.from(reply).toString("base64") + "] Explain it"
  db.prepare("UPDATE sub_chats SET messages=? WHERE id=?").run(
    JSON.stringify([{ id: "reply", role: "user", parts: [{ type: "text", text }] }]),
    subChatId,
  )
  const visible = JSON.stringify(readMobileConversation(db, id).messages)
  expect(visible).toContain("password=[redacted]")
  expect(visible).toContain("Explain it")
  expect(visible).not.toContain("secret-value")
  expect(visible).not.toContain("@[quote:")
})

it("keeps long reply metadata intact outside the paginated text chunks", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "long-reference",
    message: "Start",
    harness: "codex",
  })
  const subChatId = readMobileConversation(db, id).subChatId!
  const reference = {
    messageId: "source",
    role: "assistant" as const,
    text: "x".repeat(8000) + " password=hidden",
  }
  const text = formatMessageReply(reference) + "\n\n" + "y".repeat(9000)
  db.prepare("UPDATE sub_chats SET messages=? WHERE id=?").run(
    JSON.stringify([{ id: "reply", role: "user", parts: [{ type: "text", text }] }]),
    subChatId,
  )
  const messages = readMobileConversation(db, id).messages.filter((m) => m.id.startsWith("reply:"))
  expect(messages.map((m) => m.text).join("")).toBe("y".repeat(9000))
  expect(messages[0].reply).toEqual({
    ...reference,
    text: "x".repeat(8000) + " password=[redacted]",
  })
  expect(JSON.parse(JSON.stringify(messages))[0].reply.text).toContain("password=[redacted]")
  expect(messages[1].reply).toBeUndefined()
})

it("decodes and redacts mixed desktop selection quotes before a reply reference", () => {
  const id = createMobileChat(db, {
    projectId: "project",
    commandId: "mixed-reference",
    message: "Start",
    harness: "codex",
  })
  const subChatId = readMobileConversation(db, id).subChatId!
  const encode = (text: string) => "@[quote:preview:" + Buffer.from(text).toString("base64") + "] "
  const text =
    "@[file:src/example.ts] " +
    encode("Selected text password=selection-secret") +
    encode(
      formatMessageReply({
        messageId: "source",
        role: "assistant",
        text: "Reply text password=reply-secret",
      }),
    ) +
    "Explain both"
  db.prepare("UPDATE sub_chats SET messages=? WHERE id=?").run(
    JSON.stringify([{ id: "mixed", role: "user", parts: [{ type: "text", text }] }]),
    subChatId,
  )
  const message = readMobileConversation(db, id).messages.find((m) => m.id === "mixed:0")!
  expect(message.reply).toEqual({
    messageId: "source",
    role: "assistant",
    text: "Reply text password=[redacted]",
  })
  expect(message.text).toContain("Selected text password=[redacted]")
  expect(message.text).toContain("Explain both")
  expect(JSON.stringify(message)).not.toMatch(/selection-secret|reply-secret|@\[quote:/)
})
