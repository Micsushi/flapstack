import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  captureMixed,
  refreshDiscussionSummary,
  segmentCaptureSource,
  projectCaptureTopics,
} from "../src/main/lib/discussions/mixed-capture"
import { DiscussionService } from "../src/main/lib/discussions/service"
import type { generateDiscussionResult } from "../src/main/lib/discussions/assistant"
import { mixedCaptureSuggestionSchema } from "../src/main/lib/discussions/assistant-policy"

let directory: string, db: Database.Database, service: DiscussionService
const scope = { projectId: "p", chatId: "c", hostId: "test-host" }
const path = "projects/flapstack/features.md"
const snapshot = {
  schemaVersion: 1 as const,
  path,
  revision: "a".repeat(64),
  document: {
    schemaVersion: 1 as const,
    title: "Features",
    records: [
      {
        id: "FLAP-layout",
        title: "Fix layout spacing",
        kind: "feature" as const,
        state: "planned",
        history: [],
      },
    ],
  },
}
const body = "  Fix layout spacing. Later add themes.  "
const group = (spanId = "s1") => ({
  title: "Layout spacing",
  kind: "fix" as const,
  spanIds: [spanId],
  summary: "Fix layout spacing now.",
  existingTopicId: null as string | null,
  recordIds: [] as string[],
})
function records() {
  return {
    list: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      documents: [{ path, title: "Features", revision: snapshot.revision }],
    }),
    read: vi.fn().mockResolvedValue(snapshot),
  }
}
function generator(
  topics: z.infer<typeof mixedCaptureSuggestionSchema>["topics"] = [
    group(),
    { ...group("s2"), title: "Themes", kind: "idea" },
  ],
) {
  return vi.fn().mockImplementation(async (input) => ({
    result:
      input.kind === "capture-review"
        ? { accepted: true, issues: [] }
        : input.kind === "capture-match"
          ? {
              matches: topics.map((topic, index) => ({
                groupId: `g${index + 1}`,
                recordIds: topic.recordIds,
              })),
            }
          : { topics: topics.map((topic) => ({ ...topic, recordIds: [] })) },
    model: "test-local",
  })) as unknown as typeof generateDiscussionResult
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mixed-"))
  db = new Database(join(directory, "test.db"))
  db.pragma("foreign_keys = ON")
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.prepare("INSERT INTO projects (id,name,path) VALUES ('p','Project',?)").run(
    join(directory, "flapstack"),
  )
  db.exec("INSERT INTO chats (id,project_id,name) VALUES ('c','p','Chat')")
  service = new DiscussionService(db, scope.hostId)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it("groups exact quotes into scoped topics, links real canonical IDs, preserves raw source and reverses atomically", async () => {
  const existing = service.create({
    scope,
    title: "Layout",
    summary: "Keep accessibility contrast.",
    capture: { body: "Layout spacing", kind: "note" },
  })
  const client = records()
  const result = await captureMixed(
    service,
    { scope, body },
    {
      records: async () => client,
      generate: generator([
        { ...group(), existingTopicId: existing.id, recordIds: ["FLAP-layout"] },
        {
          ...group("s2"),
          title: "Themes",
          kind: "idea",
          summary: "Themes are a future idea.",
        },
      ]),
    },
  )
  expect(result.state).toBe("grouped")
  expect(result.dedupStatus).toBe("available")
  expect(client.read).toHaveBeenCalledWith(path)
  expect(result.topics[0]!.canonicalRecordIds).toEqual(["FLAP-layout"])
  expect(result.topics[0]!.captures.at(-1)!.origin?.topicId).toBe(result.originalTopicId)
  expect(result.topics[1]!.captures[0]!.kind).toBe("idea")
  expect(service.read(scope, result.originalTopicId).captures[0]!.body).toBe(body)
  expect(service.read(scope, result.originalTopicId).archived).toBe(true)
  const undone = service.restoreMixed(result.undo)
  expect(service.read(scope, existing.id).captures).toEqual(existing.captures)
  expect(service.read(scope, result.topics[1]!.id).archived).toBe(true)
  service.restoreMixed(undone.undo)
  expect(service.read(scope, result.topics[1]!.id).archived).toBe(false)
  expect(service.read(scope, existing.id).captures.at(-1)!.body.trim()).toBe("Fix layout spacing.")
})

it("rejects a canonical revision change instead of applying stale duplicate matches", async () => {
  const client = records()
  client.read
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({ ...snapshot, revision: "b".repeat(64) })
  const result = await captureMixed(
    service,
    { scope, body },
    {
      records: async () => client,
      generate: generator([
        { ...group(), recordIds: ["FLAP-layout"] },
        { ...group("s2"), title: "Themes", kind: "idea" },
      ]),
    },
  )
  expect(result.state).toBe("unsorted")
  expect(service.list({ scope }).topics).toHaveLength(1)
  expect(result.topics[0]!.canonicalRecordIds).toEqual([])
})

it("keeps canonical unavailability explicit without guessing aliases or uniqueness", async () => {
  const client = records()
  client.list.mockResolvedValue({
    schemaVersion: 1,
    documents: [
      { path: "projects/other/features.md", title: "Other", revision: snapshot.revision },
    ],
  })
  const result = await captureMixed(
    service,
    { scope, body },
    { records: async () => client, generate: generator() },
  )
  expect(client.read).not.toHaveBeenCalled()
  expect(result.state).toBe("grouped")
  expect(result.dedupStatus).toBe("unavailable")
  expect(result.warning).toContain("not confirmed unique")
  expect(service.read(scope, result.originalTopicId).captureBatch?.dedupStatus).toBe("unavailable")
})

it.each([
  { ...group(), spanIds: ["missing"] },
  { ...group(), recordIds: ["foreign-record"] },
  { ...group(), existingTopicId: "foreign-topic" },
])(
  "preserves unsorted input when deterministic validation rejects a proposal",
  async (proposal) => {
    const result = await captureMixed(
      service,
      { scope, body },
      { records: async () => records(), generate: generator([proposal]) },
    )
    expect(result.state).toBe("unsorted")
    expect(result.topics[0]!.captures[0]!.body).toBe(body)
    expect(service.list({ scope }).topics).toHaveLength(1)
    expect(result.topics[0]!.captureBatch?.warning).toContain("validated")
  },
)

it("persists fallback before unavailable model response and rolls back all grouping on late owner edits", async () => {
  const unavailable = vi
    .fn()
    .mockRejectedValue(new Error("No local model")) as unknown as typeof generateDiscussionResult
  const fallback = await captureMixed(
    service,
    { scope, body },
    { records: async () => records(), generate: unavailable },
  )
  expect(service.read(scope, fallback.originalTopicId).captureBatch?.state).toBe("unsorted")
  const existing = service.create({
    scope,
    title: "Layout",
    capture: { body: "Layout", kind: "note" },
  })
  const generate = (async (input) => {
    if (input.kind === "capture-match")
      return {
        model: "test",
        result: {
          matches: [
            { groupId: "g1", recordIds: [] },
            { groupId: "g2", recordIds: [] },
          ],
        },
      }
    if (input.kind === "capture-review")
      return { model: "test", result: { accepted: true, issues: [] } }
    service.update({
      scope,
      id: existing.id,
      expectedRevision: existing.revision,
      change: { type: "summary", summary: "Owner correction" },
    })
    return {
      model: "test",
      result: {
        topics: [
          { ...group("s2"), title: "Themes" },
          { ...group(), existingTopicId: existing.id },
        ],
      },
    }
  }) as typeof generateDiscussionResult
  const result = await captureMixed(
    service,
    { scope, body },
    { records: async () => records(), generate },
  )
  expect(result.state).toBe("unsorted")
  expect(service.read(scope, existing.id).summary).toBe("Owner correction")
  expect(service.list({ scope }).topics).toHaveLength(3)
})

it("refreshes a saved note but cannot overwrite an owner correction, and undo refuses later edits", async () => {
  const existing = service.create({
    scope,
    title: "Layout",
    capture: { body: "Layout", kind: "note" },
  })
  const generated = (async () => ({
    model: "test",
    result: { summary: "Layout needs work." },
  })) as typeof generateDiscussionResult
  const refreshed = await refreshDiscussionSummary(service, existing, generated)
  expect(refreshed.topic.summary).toBe("Layout needs work.")
  const racing = (async () => {
    service.update({
      scope,
      id: existing.id,
      expectedRevision: refreshed.topic.revision,
      change: { type: "summary", summary: "Owner correction" },
    })
    return { model: "test", result: { summary: "Stale model result" } }
  }) as typeof generateDiscussionResult
  const rejected = await refreshDiscussionSummary(service, refreshed.topic, racing)
  expect(rejected.warning).toContain("changed")
  expect(service.read(scope, existing.id).summary).toBe("Owner correction")
  const capture = await captureMixed(
    service,
    { scope, body },
    { records: async () => records(), generate: generator() },
  )
  const topic = capture.topics[0]!
  service.update({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    change: { type: "capture", capture: { body: "Later owner work", kind: "note" } },
  })
  expect(() => service.restoreMixed(capture.undo)).toThrow("changed")
  expect(service.read(scope, topic.id).archived).toBe(false)
})

it("keeps noncontiguous correction quotes in the reused topic with exact atomic undo", async () => {
  const existing = service.create({
    scope,
    title: "Layout",
    summary: "Keep accessibility contrast.",
    capture: { kind: "note", body: "Layout constraints" },
  })
  const original = "Fix layout spacing. Later add themes. Keep accessibility contrast."
  const generate = generator([
    {
      ...group(),
      existingTopicId: existing.id,
      spanIds: ["s1", "s3"],
      summary: "Fix layout spacing and keep accessibility contrast.",
    },
    {
      ...group("s2"),
      title: "Themes",
      kind: "idea",
      summary: "Consider themes later.",
    },
  ])
  const result = await captureMixed(
    service,
    { scope, body: original },
    { records: async () => records(), generate },
  )
  expect(result.state).toBe("grouped")
  expect(result.topics).toHaveLength(2)
  const reused = result.topics.find((topic) => topic.id === existing.id)!
  expect(reused.captures.slice(-2).map((capture) => capture.body.trim())).toEqual([
    "Fix layout spacing.",
    "Keep accessibility contrast.",
  ])
  expect(reused.captures.at(-1)!.origin!.start).toBe(segmentCaptureSource(original)[2]!.start)
  expect(reused.summary).toContain("keep accessibility contrast")
  expect(result.review).toEqual({ model: "test-local", repairs: 0 })
  const undone = service.restoreMixed(result.undo)
  expect(service.read(scope, existing.id).summary).toBe(existing.summary)
  expect(service.read(scope, existing.id).captures).toEqual(existing.captures)
  service.restoreMixed(undone.undo)
  expect(service.read(scope, existing.id).captures).toHaveLength(3)
})

it("repairs a semantic consolidation failure once and rechecks before saving", async () => {
  const existing = service.create({
    scope,
    title: "Layout",
    summary: "Keep accessibility contrast.",
    capture: { kind: "note", body: "Layout constraints" },
  })
  const original = "Fix layout spacing. Later add themes. Keep accessibility contrast."
  const duplicate = [
    { ...group(), existingTopicId: existing.id },
    { ...group("s3"), title: "Layout" },
    { ...group("s2"), title: "Themes", kind: "idea" },
  ]
  const repaired = [
    {
      ...group(),
      existingTopicId: existing.id,
      spanIds: ["s1", "s3"],
      summary: "Fix layout spacing and keep accessibility contrast.",
    },
    { ...group("s2"), title: "Themes", kind: "idea" },
  ]
  const generate = vi
    .fn()
    .mockResolvedValueOnce({ model: "test", result: { topics: duplicate } })
    .mockResolvedValueOnce({
      model: "test",
      result: {
        accepted: false,
        issues: [
          "The related correction was split into a duplicate topic and omitted from the reused summary.",
        ],
      },
    })
    .mockResolvedValueOnce({ model: "test", result: { topics: repaired } })
    .mockResolvedValueOnce({ model: "test", result: { accepted: true, issues: [] } })
  const result = await captureMixed(
    service,
    { scope, body: original },
    {
      records: async () => {
        throw new Error("offline")
      },
      generate: generate as typeof generateDiscussionResult,
    },
  )
  expect(result.state).toBe("grouped")
  expect(result.topics).toHaveLength(2)
  expect(result.review?.repairs).toBe(1)
  expect(generate.mock.calls.map((call) => call[0].kind)).toEqual([
    "capture",
    "capture-review",
    "capture",
    "capture-review",
  ])
  expect(generate.mock.calls[2]![0].source.reviewIssues).toHaveLength(1)
  expect(generate.mock.calls[1]![0].source.projectedTopics[0].priorSummary).toBe(existing.summary)
})

it("leaves the exact original unsorted when the one semantic repair still fails", async () => {
  const generate = vi.fn().mockImplementation(async (input) => ({
    model: "test",
    result:
      input.kind === "capture-review"
        ? { accepted: false, issues: ["The proposal drops a correction."] }
        : { topics: [group(), { ...group("s2"), title: "Themes", kind: "idea" }] },
  }))
  const result = await captureMixed(
    service,
    { scope, body },
    {
      records: async () => {
        throw new Error("offline")
      },
      generate: generate as typeof generateDiscussionResult,
    },
  )
  expect(generate).toHaveBeenCalledTimes(4)
  expect(result.state).toBe("unsorted")
  expect(result.topics[0]!.captures[0]!.body).toBe(body)
  expect(result.topics[0]!.archived).toBe(false)
  expect(service.list({ scope }).topics).toHaveLength(1)
})

it("does not merge distinct subjects merely because they share an umbrella canonical ID", async () => {
  const client = records()
  client.read.mockResolvedValue({
    ...snapshot,
    document: {
      ...snapshot.document,
      records: [{ ...snapshot.document.records[0], title: "Layout spacing and themes" }],
    },
  })
  const result = await captureMixed(
    service,
    { scope, body },
    {
      records: async () => client,
      generate: generator([
        { ...group(), recordIds: ["FLAP-layout"] },
        {
          ...group("s2"),
          title: "Themes",
          kind: "idea",
          recordIds: ["FLAP-layout"],
        },
      ]),
    },
  )
  expect(result.state).toBe("grouped")
  expect(result.topics).toHaveLength(2)
  expect(result.topics.map((topic) => topic.canonicalRecordIds)).toEqual([
    ["FLAP-layout"],
    ["FLAP-layout"],
  ])
})

it("segments complete input within bounds and retains repeated-text occurrence offsets", async () => {
  const fragmented = "A.\n".repeat(1000)
  const spans = segmentCaptureSource(fragmented)
  expect(spans.length).toBeLessThanOrEqual(64)
  expect(spans.map((span) => span.text).join("")).toBe(fragmented)
  expect(spans.every((span, index) => span.start === (index ? spans[index - 1]!.end : 0))).toBe(
    true,
  )
  const original = "Repeat.\nRepeat.\nRepeat."
  const result = await captureMixed(
    service,
    { scope, body: original },
    {
      records: async () => records(),
      generate: generator([{ ...group(), kind: "note", spanIds: ["s3", "s1", "s2"] }]),
    },
  )
  expect(result.state).toBe("grouped")
  const captures = result.topics[0]!.captures
  expect(captures[1]!.body).toBe(captures[2]!.body)
  expect(captures[1]!.origin!.start).not.toBe(captures[2]!.origin!.start)
  expect(captures.map((capture) => capture.body).join("")).toBe(original)
})

it("allows a source sentence shared by distinct subjects and rejects missing coverage", async () => {
  const shared = await captureMixed(
    service,
    { scope, body: "Fix layout spacing and later add themes." },
    {
      records: async () => records(),
      generate: generator([group(), { ...group(), kind: "idea", title: "Themes" }]),
    },
  )
  expect(shared.state).toBe("grouped")
  expect(shared.topics).toHaveLength(2)
  expect(shared.topics[0]!.captures[0]!.origin).toEqual(shared.topics[1]!.captures[0]!.origin)
  const missing = await captureMixed(
    service,
    { scope, body },
    { records: async () => records(), generate: generator([group()]) },
  )
  expect(missing.state).toBe("unsorted")
  expect(missing.topics[0]!.captures[0]!.body).toBe(body)
})

it("refreshes committed answer meaning with selected labels and free text, never a draft", async () => {
  let topic = service.create({
    scope,
    title: "Layout",
    summary: "Scope undecided.",
    capture: { kind: "note", body: "Choose scope" },
  })
  topic = service.update({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    change: {
      type: "question",
      question: {
        prompt: "Which scope?",
        choices: [
          { id: "small", label: "Fix sidebar labels only" },
          { id: "large", label: "Redesign the entire app" },
        ],
        blocking: false,
      },
    },
  })
  const questionId = topic.questions[0]!.id
  topic = service.update({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    change: {
      type: "draft",
      questionId,
      answer: { choiceIds: ["large"], text: "Uncommitted draft" },
    },
  })
  const generate = vi.fn().mockResolvedValue({
    result: { summary: "Fix sidebar labels only; keep the dark theme as a future idea." },
    model: "test",
  })
  await refreshDiscussionSummary(service, topic, generate as typeof generateDiscussionResult, {
    answeredQuestionId: questionId,
  })
  expect(generate).not.toHaveBeenCalled()
  const beforeAnswer = topic
  topic = service.update({
    scope,
    id: topic.id,
    expectedRevision: topic.revision,
    change: {
      type: "answer",
      questionId,
      answer: { choiceIds: ["small"], text: "Keep the dark theme as a future idea." },
    },
  })
  const refreshed = await refreshDiscussionSummary(
    service,
    topic,
    generate as typeof generateDiscussionResult,
    { answeredQuestionId: questionId },
  )
  expect(generate.mock.calls[0]![0].source.committedAnswer).toEqual({
    question: "Which scope?",
    selectedChoices: [{ id: "small", label: "Fix sidebar labels only" }],
    freeText: "Keep the dark theme as a future idea.",
  })
  expect(JSON.stringify(generate.mock.calls[0]![0].source)).not.toContain("Uncommitted draft")
  expect(refreshed.topic.summary).toContain("sidebar labels only")
  const undone = service.restore({
    scope,
    id: topic.id,
    expectedRevision: refreshed.topic.revision,
    targetRevision: beforeAnswer.revision,
  })
  expect(undone.questions[0]!.answers).toHaveLength(0)
  expect(undone.summary).toBe("Scope undecided.")
})

it("separates canonical association from grouping and reviews one materialized update identity", async () => {
  const existing = service.create({
    scope,
    title: "Layout",
    summary: "Preserve accessibility.",
    capture: { kind: "note", body: "Layout" },
  })
  const client = records()
  client.read.mockResolvedValue({
    ...snapshot,
    document: {
      ...snapshot.document,
      records: [
        {
          ...snapshot.document.records[0],
          description: "Repair sidebar layout spacing while preserving accessibility.",
        },
      ],
    },
  })
  const generate = generator([
    { ...group(), existingTopicId: existing.id, recordIds: ["FLAP-layout"] },
    { ...group("s2"), title: "Themes", kind: "idea" },
  ])
  const result = await captureMixed(
    service,
    { scope, body },
    { records: async () => client, generate },
  )
  expect(result.state).toBe("grouped")
  const calls = vi.mocked(generate).mock.calls
  expect(calls.map((call) => call[0].kind)).toEqual(["capture", "capture-match", "capture-review"])
  expect(calls[0]![0].source).not.toHaveProperty("canonicalRecords")
  expect((calls[1]![0].source as any).canonicalRecords[0].description).toContain("accessibility")
  const projected = (calls[2]![0].source as any).projectedTopics
  expect(projected.filter((topic: any) => topic.topicId === existing.id)).toHaveLength(1)
  expect(projected[0].priorSummary).toBe(existing.summary)
  expect(projected[0].matchedRecords[0].id).toBe("FLAP-layout")
  expect(calls[2]![0].source).not.toHaveProperty("existingTopics")
})

it("never spends a fifth call repairing a linked semantic rejection", async () => {
  const generate = vi.fn(generator()).mockImplementation(async (input: any) => {
    if (input.kind === "capture-review")
      return { model: "test", result: { accepted: false, issues: ["Unrelated canonical link"] } }
    return generator([
      { ...group(), recordIds: ["FLAP-layout"] },
      { ...group("s2"), kind: "idea", title: "Themes" },
    ])(input)
  }) as typeof generateDiscussionResult
  const result = await captureMixed(
    service,
    { scope, body },
    { records: async () => records(), generate },
  )
  expect(vi.mocked(generate)).toHaveBeenCalledTimes(3)
  expect(result.state).toBe("unsorted")
  expect(result.topics[0]!.captures[0]!.body).toBe(body)
})

it("projects retained failing proposal as one update and a separate future topic without semantic ID guessing", () => {
  const existing = {
    id: "retained-topic",
    title: "Discussion capture and short summaries",
    summary:
      "Confirmed correction: preserve original wording. Short summaries must supplement, never replace, original captures.",
  }
  const text =
    "Fix mixed-topic discussion capture and continually updated short summaries. Preserve original wording; summaries must supplement, never replace, the original capture. Later, consider an optional animated snowflake background."
  const spans = segmentCaptureSource(text)
  const projected = projectCaptureTopics(
    [existing],
    [
      {
        title: existing.title,
        summary: existing.summary,
        kind: "fix",
        existingTopicId: existing.id,
        recordIds: [],
        spans: spans.slice(0, 2),
      },
      {
        title: "Animated background consideration",
        summary: "Later, consider an optional animated snowflake background.",
        kind: "idea",
        existingTopicId: null,
        recordIds: [],
        spans: spans.slice(2),
      },
    ],
    [],
  )
  expect(projected).toHaveLength(2)
  expect(projected.filter((topic) => topic.topicId === existing.id)).toHaveLength(1)
  expect(projected[0]).toMatchObject({ priorSummary: existing.summary, matchedRecords: [] })
  expect(spans.map((span) => span.text).join("")).toBe(text)
})
