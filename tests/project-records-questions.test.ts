import { expect, it } from "vitest"
import {
  projectRecordSchema,
  questionNeedsOwner,
  questionReviewState,
} from "../src/shared/project-records"

const parent = {
  id: "Q1",
  kind: "question",
  title: "Test destination",
  state: "answered",
  history: [],
  answer: " Alpha ",
  answerSource: "owner",
}
const review = {
  reviewedAnswer: " Alpha ",
  reviewedAnswerSource: "owner",
  status: "confirmed",
  note: "This selects the test host.",
}
const child = {
  id: "next",
  title: "Which folder?",
  state: "open",
  context: "Choose where test files go.",
  choices: [],
  recommendation: "",
  draft: "",
  answer: "",
  affectedWork: [],
}

it("preserves legacy answers and binds review to exact saved text and provenance, never the draft", () => {
  expect(projectRecordSchema.parse({ ...parent, answerSource: "" })).toEqual({
    ...parent,
    answerSource: "",
  })
  const record = projectRecordSchema.parse({ ...parent, agentReview: review })
  expect(questionReviewState(record)).toBe("confirmed")
  expect(questionReviewState({ ...record, answer: "Alpha" })).toBe("stale")
  expect(questionReviewState({ ...record, answerSource: "ai" })).toBe("stale")
  expect(questionReviewState(projectRecordSchema.parse({ ...record, draft: "Beta" }))).toBe(
    "confirmed",
  )
  expect(questionReviewState({ ...record, answer: "" })).toBe("stale")
  expect(questionReviewState({ ...record, answer: " Alpha " })).toBe("confirmed")
  expect(
    questionReviewState(
      projectRecordSchema.parse({
        ...parent,
        answerSource: undefined,
        agentReview: { ...review, reviewedAnswerSource: null },
      }),
    ),
  ).toBe("confirmed")
  expect(questionReviewState(projectRecordSchema.parse(parent))).toBe("unrecorded")
  expect(
    projectRecordSchema.safeParse({ ...parent, agentReview: { ...review, reviewedAnswer: " " } })
      .success,
  ).toBe(false)
})

it("keeps parent-local children and unknown metadata, rejects duplicate IDs and nested questions, and accepts Undo nulls", () => {
  const record = {
    ...parent,
    agentReview: null,
    followUps: [{ ...child, custom: { keep: true }, followUps: null }],
  }
  expect(projectRecordSchema.parse(record)).toEqual(record)
  expect(projectRecordSchema.safeParse({ ...parent, followUps: [child, child] }).success).toBe(
    false,
  )
  expect(
    projectRecordSchema.safeParse({ ...parent, followUps: [{ ...child, followUps: [] }] }).success,
  ).toBe(false)
  expect(
    projectRecordSchema.safeParse({ ...parent, followUps: [{ ...child, state: "invented" }] })
      .success,
  ).toBe(false)
  expect(
    projectRecordSchema.parse({ ...parent, agentReview: null, followUps: null }).followUps,
  ).toBeNull()
})

it("keeps an answered parent waiting for its open child, while agent research requires no owner answer", () => {
  const record = projectRecordSchema.parse({ ...parent, followUps: [child] })
  expect(questionNeedsOwner(record)).toBe(true)
  expect(
    questionNeedsOwner({
      ...record,
      followUps: [{ ...record.followUps![0]!, state: "agent_research" }],
    }),
  ).toBe(false)
  expect(questionNeedsOwner({ ...record, state: "agent_research", followUps: null })).toBe(false)
  expect(questionNeedsOwner({ ...record, state: "open", followUps: null })).toBe(true)
})
