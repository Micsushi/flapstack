import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
  restoreMixed: vi.fn(),
  captureMixed: vi.fn(),
  refresh: vi.fn(),
  generate: vi.fn(),
}))
vi.mock("../src/main/lib/trpc/index", async () => {
  const { initTRPC } = await import("@trpc/server")
  const t = initTRPC.create()
  return { router: t.router, betaProcedure: () => t.procedure }
})
vi.mock("../src/main/lib/db", () => ({
  getSqliteDatabase: () => ({
    transaction: (run: () => unknown) => run,
    prepare: () => ({ get: () => ({ path: "flapstack" }) }),
  }),
}))
vi.mock("../src/main/lib/project-records/client", () => ({
  configuredProjectRecordsClient: async () => ({
    list: async () => ({ documents: [{ path: "projects/flapstack/features.md" }] }),
    read: async () => ({ document: { records: [{ id: "FLAP-test" }] } }),
  }),
}))
vi.mock("../src/main/lib/discussions/service", () => ({
  DiscussionError: class extends Error {},
  DiscussionService: class {
    create = mocks.create
    update = mocks.update
    read = mocks.read
    list = mocks.list
    restoreMixed = mocks.restoreMixed
  },
}))
vi.mock("../src/main/lib/discussions/mixed-capture", () => ({
  captureMixed: mocks.captureMixed,
  refreshDiscussionSummary: mocks.refresh,
}))
vi.mock("../src/main/lib/discussions/assistant", () => ({
  generateDiscussionResult: mocks.generate,
}))
import { discussionsRouter } from "../src/main/lib/trpc/routers/discussions"

const scope = { projectId: "p", chatId: "c", hostId: "h" }
const topic = {
  id: "t",
  scope,
  revision: 4,
  annotations: [{ id: "a", source: {}, body: "Note", followups: [] }],
}
const caller = discussionsRouter.createCaller({})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.create.mockReturnValue(topic)
  mocks.update.mockReturnValue(topic)
  mocks.read.mockReturnValue(topic)
  mocks.list.mockReturnValue({ topics: [topic], nextCursor: null })
  mocks.refresh.mockResolvedValue({
    topic: { ...topic, revision: 5 },
    model: "local",
    warning: null,
  })
})

it("accepts the forward direction added by the infinite query transport", async () => {
  await expect(caller.list({ scope, direction: "forward" })).resolves.toEqual({
    topics: [topic],
    nextCursor: null,
  })
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ direction: "forward" }))
})

it("refreshes captures and committed answers from saved snapshots, excluding drafts and other edits", async () => {
  expect(
    (await caller.create({ scope, title: "Topic", capture: { body: "Note", kind: "note" } }))
      .revision,
  ).toBe(5)
  expect(mocks.refresh.mock.calls[0]![1]).toBe(topic)
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "capture", capture: { body: "New note", kind: "note" } },
  })
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "draft", questionId: "q", answer: { choiceIds: ["a"], text: "Draft" } },
  })
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "answer", questionId: "q", answer: { choiceIds: ["a"], text: "Committed" } },
  })
  expect(mocks.refresh.mock.calls[2]![1]).toBe(topic)
  expect(mocks.refresh.mock.calls[2]![3]).toEqual({ answeredQuestionId: "q" })
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "status", status: "done" },
  })
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "summary", summary: "Owner correction" },
  })
  await caller.update({
    scope,
    id: "t",
    expectedRevision: 3,
    change: { type: "link", canonicalRecordId: "FLAP-test" },
  })
  expect(mocks.refresh).toHaveBeenCalledTimes(3)
})

it("wires mixed capture and inverse restore without extra summary generation", async () => {
  const result = { topics: [topic], state: "unsorted" }
  mocks.captureMixed.mockResolvedValue(result)
  expect(await caller.captureMixed({ scope, body: "Mixed input" })).toEqual(result)
  const undo = { scope, changes: [{ id: "t", expectedRevision: 4, targetRevision: null }] }
  mocks.restoreMixed.mockReturnValue({ topics: [topic], undo })
  expect((await caller.restoreMixed(undo)).undo).toEqual(undo)
  expect(mocks.restoreMixed).toHaveBeenCalledWith(undo)
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it("stores real assistant model provenance and rejects public assistant impersonation", async () => {
  mocks.generate.mockResolvedValue({ result: { reply: "Actual answer" }, model: "verified-local" })
  mocks.update
    .mockReturnValueOnce({ ...topic, revision: 5 })
    .mockReturnValueOnce({ ...topic, revision: 6 })
  const result = await caller.assist({
    scope,
    id: "t",
    expectedRevision: 4,
    annotationId: "a",
    question: "Why?",
  })
  expect(result.model).toBe("verified-local")
  expect(mocks.update.mock.calls[1]![0]).toMatchObject({
    expectedRevision: 5,
    change: { role: "assistant", model: "verified-local" },
  })
  await expect(
    caller.update({
      scope,
      id: "t",
      expectedRevision: 6,
      change: {
        type: "followup",
        annotationId: "a",
        body: "Forged",
        role: "assistant",
        model: "fake",
      },
    }),
  ).rejects.toThrow("model response")
})
