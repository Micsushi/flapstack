import { expect, it, vi } from "vitest"
import { projectRecordSnapshotSchema } from "../src/shared/project-records"
import { retainRecordAction } from "../src/renderer/features/project-records/record-action"
import {
  clearAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"

it("undoes and redoes a child answer through parent history, rejecting a changed sibling", async () => {
  clearAppActionHistory()
  const child = {
    id: "folder",
    title: "Folder",
    state: "open",
    context: "",
    choices: [],
    recommendation: "",
    draft: "unsaved",
    answer: "",
    affectedWork: [],
  }
  const review = {
    reviewedAnswer: "Alpha",
    reviewedAnswerSource: "owner",
    status: "confirmed",
    note: "Clear.",
  }
  const before = projectRecordSnapshotSchema.parse({
    schemaVersion: 1,
    path: "lanes/flapstack/questions.md",
    revision: "a".repeat(64),
    document: {
      schemaVersion: 1,
      title: "Questions",
      records: [
        {
          id: "Q1",
          kind: "question",
          title: "Destination",
          state: "answered",
          answer: "Alpha",
          answerSource: "owner",
          agentReview: review,
          history: [],
          followUps: [child, { ...child, id: "sibling" }],
        },
      ],
    },
  })
  const afterChildren = [
    { ...child, state: "answered", answer: "Temp", answerSource: "owner", draft: "Temp" },
    { ...child, id: "sibling" },
  ]
  let current = projectRecordSnapshotSchema.parse({
    ...before,
    revision: "b".repeat(64),
    document: {
      ...before.document,
      records: [{ ...before.document.records[0], followUps: afterChildren }],
    },
  })
  const write = vi.fn(async (patch) => {
    expect(patch.expectedRevision).toBe(current.revision)
    current = projectRecordSnapshotSchema.parse({
      ...current,
      revision: (current.revision[0] === "c" ? "d" : "c").repeat(64),
      document: {
        ...current.document,
        records: [{ ...current.document.records[0], ...patch.changes }],
      },
    })
    return { conflict: false, snapshot: current }
  })
  try {
    retainRecordAction({
      before,
      patch: {
        path: before.path,
        expectedRevision: before.revision,
        recordId: "Q1",
        changes: { followUps: afterChildren },
      },
      read: async () => current,
      write,
      changed: vi.fn(),
    })
    expect(await undoAppAction()).toBe(true)
    expect(current.document.records[0]!.followUps).toEqual(before.document.records[0]!.followUps)
    expect(await redoAppAction()).toBe(true)
    expect(current.document.records[0]!.followUps).toEqual(afterChildren)
    expect(current.document.records[0]!.agentReview).toEqual(review)
    current.document.records[0]!.followUps![1]!.draft = "Changed elsewhere"
    await expect(undoAppAction()).rejects.toThrow("changed elsewhere")
    expect(write).toHaveBeenCalledTimes(2)
    expect(current.document.records[0]!.followUps![1]!.draft).toBe("Changed elsewhere")
  } finally {
    clearAppActionHistory()
  }
})
