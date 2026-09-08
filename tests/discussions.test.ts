import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { DiscussionService } from "../src/main/lib/discussions/service"
import type { DiscussionChange, DiscussionSource, DiscussionTopic } from "../src/shared/discussions"

let directory: string, db: Database.Database, service: DiscussionService
const scope = { projectId: "p", chatId: "c", hostId: "test-host" }
const messages = [
  {
    id: "m",
    role: "user",
    parts: [
      { type: "text", text: "Fix the layout and save this idea" },
      { type: "data-image", data: { url: "file:///synthetic.png", filename: "synthetic.png" } },
    ],
  },
]
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-discussions-"))
  db = new Database(join(directory, "test.db"))
  db.pragma("foreign_keys = ON")
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.prepare(
    "INSERT INTO projects (id,name,path) VALUES ('p','Project',?), ('other','Other',?)",
  ).run(join(directory, "project"), join(directory, "other"))
  db.exec(
    "INSERT INTO chats (id,project_id,name) VALUES ('c','p','Chat'), ('other-chat','other','Other')",
  )
  db.prepare(
    "INSERT INTO sub_chats (id,chat_id,messages) VALUES ('s','c',?), ('outside','other-chat',?)",
  ).run(JSON.stringify(messages), JSON.stringify(messages))
  service = new DiscussionService(db, scope.hostId)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
function create() {
  return service.create({
    scope,
    title: "Mixed topics",
    capture: { body: "Repair layout", kind: "fix" },
  })
}
function change(topic: DiscussionTopic, change: DiscussionChange) {
  return service.update({ scope, id: topic.id, expectedRevision: topic.revision, change })
}
function source(): DiscussionSource {
  const message = service.sources(scope, "s", "m")[0]!
  return {
    subChatId: "s",
    messageId: message.messageId,
    revision: message.revision,
    role: message.role,
    target: { kind: "text", quote: "layout", start: 8, end: 14 },
  }
}

it("persists mixed captures, summary history, question drafts and answers across restart", () => {
  let topic = change(create(), {
    type: "capture",
    capture: { body: "Later add themes", kind: "idea" },
  })
  topic = change(topic, { type: "summary", summary: "Layout fix now; themes later" })
  topic = change(topic, {
    type: "question",
    question: { prompt: "Which theme?", choices: [{ id: "dark", label: "Dark" }], blocking: false },
  })
  const questionId = topic.questions[0]!.id
  topic = change(topic, {
    type: "draft",
    questionId,
    answer: { choiceIds: ["dark"], text: "Keep contrast" },
  })
  db.close()
  db = new Database(join(directory, "test.db"))
  service = new DiscussionService(db, scope.hostId)
  topic = service.read(scope, topic.id)
  expect(topic.questions[0]!.draft.text).toBe("Keep contrast")
  topic = change(topic, { type: "answer", questionId, answer: topic.questions[0]!.draft })
  expect(topic.captures.map((c) => c.kind)).toEqual(["fix", "idea"])
  expect(topic.summaryHistory.map((s) => s.summary)).toEqual(["", "Layout fix now; themes later"])
  expect(topic.questions[0]!.answers[0]!.choiceIds).toEqual(["dark"])
  expect(service.list({ scope }).topics[0]!.id).toBe(topic.id)
})

it("rejects cross-project/chat/host references and stale source anchors", () => {
  const topic = create()
  expect(() =>
    service.read({ ...scope, projectId: "other", chatId: "other-chat" }, topic.id),
  ).toThrow("not found")
  expect(() => service.list({ scope: { ...scope, hostId: "forged-host" } })).toThrow("host")
  expect(() => service.list({ scope: { ...scope, chatId: "other-chat" } })).toThrow("Chat")
  expect(() => service.sources(scope, "outside", "m")).toThrow("outside")
  const fullText = service.sources(scope, "s", "m")[0]!.text
  expect(() =>
    change(topic, {
      type: "annotation",
      source: {
        ...source(),
        target: { kind: "text", quote: fullText, start: 0, end: fullText.length + 1 },
      },
      body: "Invalid range",
    }),
  ).toThrow("quote")
  expect(() =>
    change(topic, {
      type: "annotation",
      source: { ...source(), target: { kind: "text", quote: "wrong", start: 8, end: 14 } },
      body: "Fix",
    }),
  ).toThrow("quote")
  const old = source()
  db.prepare("UPDATE sub_chats SET messages = ? WHERE id = 's'").run(
    JSON.stringify([{ ...messages[0], parts: [{ type: "text", text: "Changed" }] }]),
  )
  expect(() => change(topic, { type: "annotation", source: old, body: "Fix" })).toThrow("changed")
  expect(service.read(scope, topic.id).revision).toBe(1)
})

it("keeps image and text annotations local, rejects nesting, and promotes with reversible stable links", () => {
  let topic = change(create(), { type: "annotation", source: source(), body: "Tighten spacing" })
  const annotationId = topic.annotations[0]!.id
  topic = change(topic, {
    type: "followup",
    annotationId,
    body: "Use eight pixels",
    role: "assistant",
  })
  const image = service.sources(scope, "s", "m")[0]!.images[0]!
  topic = change(topic, {
    type: "annotation",
    body: "Image corner",
    source: {
      ...source(),
      target: { kind: "image", ...image, region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    },
  })
  expect(topic.annotations[1]!.source.target.kind).toBe("image")
  expect(() =>
    service.update({
      scope,
      id: topic.id,
      expectedRevision: topic.revision,
      change: {
        type: "annotation",
        body: "Nested",
        source: source(),
        parentAnnotationId: annotationId,
      },
    } as never),
  ).toThrow()
  const before = topic.revision
  topic = change(topic, { type: "promote", annotationId, title: "Spacing" })
  const promotedRevision = topic.revision,
    promotedId = topic.annotations[0]!.promotedTopicId!
  expect(service.read(scope, promotedId).promotedFrom).toEqual({ topicId: topic.id, annotationId })
  topic = service.restore({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    targetRevision: before,
  })
  expect(service.read(scope, promotedId).archived).toBe(true)
  topic = service.restore({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    targetRevision: promotedRevision,
  })
  expect(topic.annotations[0]!.promotedTopicId).toBe(promotedId)
  expect(service.read(scope, promotedId).archived).toBe(false)
  const child = service.read(scope, promotedId)
  change(child, { type: "capture", capture: { kind: "note", body: "New independent work" } })
  expect(() =>
    service.restore({
      scope,
      id: topic.id,
      expectedRevision: topic.revision,
      targetRevision: before,
    }),
  ).toThrow("Promoted discussion changed")
  expect(service.read(scope, topic.id).revision).toBe(topic.revision)
})

it("uses CAS for revisions and undo, validates answers and deduplicates canonical references", () => {
  const initial = create()
  let topic = change(initial, { type: "status", status: "needs-help" })
  expect(() => change(initial, { type: "read", read: true })).toThrow("changed")
  expect(() =>
    service.restore({ scope, id: topic.id, expectedRevision: 1, targetRevision: 1 }),
  ).toThrow("overwrite")
  topic = change(topic, { type: "link", canonicalRecordId: "flapstack/feature-42" })
  topic = change(topic, { type: "link", canonicalRecordId: "flapstack/feature-42" })
  expect(topic.canonicalRecordIds).toEqual(["flapstack/feature-42"])
  topic = change(topic, {
    type: "question",
    question: { prompt: "Choose", choices: [{ id: "a", label: "A" }], blocking: true },
  })
  const questionId = topic.questions[0]!.id
  expect(() =>
    change(topic, { type: "answer", questionId, answer: { choiceIds: ["foreign"], text: "" } }),
  ).toThrow("unknown")
  expect(() =>
    change(topic, { type: "answer", questionId, answer: { choiceIds: [], text: " " } }),
  ).toThrow("Choose")
  topic = service.restore({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    targetRevision: 1,
  })
  expect(topic.status).toBe("more-work")
  expect(topic.id).toBe(initial.id)
})

it("keeps project-level topics separate from chat topics and bounds retained undo snapshots", () => {
  const topic = create()
  const project = service.create({
    scope: { ...scope, chatId: null },
    title: "Project",
    capture: { body: "Project notes", kind: "note" },
  })
  expect(service.list({ scope: { ...scope, chatId: null } }).topics.map((t) => t.id)).toEqual([
    project.id,
  ])
  let updated = topic
  for (let i = 0; i < 55; i++) updated = change(updated, { type: "read", read: i % 2 === 0 })
  expect(
    (
      db
        .prepare("SELECT count(*) AS count FROM discussion_revisions WHERE topic_id = ?")
        .get(topic.id) as { count: number }
    ).count,
  ).toBe(52)
  expect(service.read(scope, topic.id).revision).toBe(56)
})

it("anchors assistant Markdown images to their part and revision without returning image URLs", () => {
  db.prepare("UPDATE sub_chats SET messages = ? WHERE id = 's'").run(
    JSON.stringify([
      {
        id: "assistant-image",
        role: "assistant",
        parts: [{ type: "text", text: "See ![diagram](https://example.invalid/image.png)" }],
      },
    ]),
  )
  const message = service.sources(scope, "s", "assistant-image")[0]!
  expect(message.images).toHaveLength(1)
  const topic = change(create(), {
    type: "annotation",
    body: "Corner label",
    source: {
      subChatId: "s",
      messageId: message.messageId,
      role: "assistant",
      revision: message.revision,
      target: {
        kind: "image",
        ...message.images[0]!,
        region: { x: 0, y: 0, width: 0.25, height: 0.25 },
      },
    },
  })
  expect(topic.annotations[0]!.source.role).toBe("assistant")
  expect(Object.keys(message.images[0]!)).toEqual(["partIndex", "imageIdentity"])
})

it("bounds pages by bytes and selects only the requested message with explicit size errors", () => {
  for (let i = 0; i < 4; i++) {
    const topic = create()
    topic.captures = Array.from({ length: 90 }, (_, n) => ({
      id: `capture-${n}`,
      createdAt: 1,
      kind: "note" as const,
      body: "x".repeat(16_000),
    }))
    db.prepare("UPDATE discussion_topics SET body = ? WHERE id = ?").run(
      JSON.stringify(topic),
      topic.id,
    )
  }
  const first = service.list({ scope })
  expect(Buffer.byteLength(JSON.stringify(first.topics))).toBeLessThan(4 * 1024 * 1024)
  expect(first.nextCursor).not.toBeNull()
  const second = service.list({ scope, cursor: first.nextCursor! })
  expect(new Set([...first.topics, ...second.topics].map((t) => t.id)).size).toBe(4)
  expect(second.nextCursor).toBeNull()
  db.prepare("UPDATE sub_chats SET messages = ? WHERE id = 's'").run(
    JSON.stringify([{ id: "large", role: "assistant", content: "x".repeat(600_000) }, ...messages]),
  )
  expect(service.sources(scope, "s", "m")).toHaveLength(1)
  expect(() => service.sources(scope, "s", "large")).toThrow("512 KiB")
})
