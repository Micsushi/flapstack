import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { captureMixed, refreshDiscussionSummary } from "../src/main/lib/discussions/mixed-capture"
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
const group = (quote = "Fix layout spacing.") => ({
  title: "Layout spacing",
  kind: "fix" as const,
  quote,
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
function generator(topics: z.infer<typeof mixedCaptureSuggestionSchema>["topics"] = [group()]) {
  return vi.fn().mockResolvedValue({
    result: { topics },
    model: "test-local",
  }) as unknown as typeof generateDiscussionResult
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
          ...group("Later add themes."),
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
  expect(service.read(scope, existing.id).captures.at(-1)!.body).toBe("Fix layout spacing.")
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
      generate: generator([{ ...group(), recordIds: ["FLAP-layout"] }]),
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
  { ...group(), quote: "Invented quote" },
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
  const generate = (async () => {
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
          { ...group("Later add themes."), title: "Themes" },
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
