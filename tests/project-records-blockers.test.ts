import { expect, it } from "vitest"
import { projectRecordSchema } from "../src/shared/project-records"

it("accepts canonical blockers without changing legacy records and requires closure evidence", () => {
  const legacy = {
    id: "Q1",
    title: "Existing question",
    kind: "question",
    state: "answered",
    history: [],
    draft: "Draft",
    answer: "Answer",
  }
  expect(projectRecordSchema.parse(legacy)).toEqual(legacy)
  const blocker = {
    id: "B1",
    title: "Test runtime",
    kind: "blocker",
    state: "blocked",
    history: [],
    category: "environment",
    affectedWork: ["F1"],
    cause: "Native startup failed.",
    missingPrerequisite: "A supported runtime",
    whyAgentCannotResolve: "The selected runtime is incompatible.",
    resolutionSteps: ["Prepare a supported isolated runtime."],
    attemptedResolutions: [],
    evidence: [],
    independentWork: ["Continue source checks."],
    ownerAction: null,
    resolutionVerification: ["Start the exact test build."],
    sourceLinks: [],
    questionIds: [],
  }
  expect(projectRecordSchema.parse(blocker)).toEqual(blocker)
  const continuationPrompt = "  Continue B1.\nPrepare <runtime path> and verify startup.  "
  expect(projectRecordSchema.parse({ ...blocker, continuationPrompt }).continuationPrompt).toBe(
    continuationPrompt,
  )
  expect(projectRecordSchema.safeParse({ ...blocker, continuationPrompt: " " }).success).toBe(false)
  expect(projectRecordSchema.safeParse({ ...blocker, cause: " " }).success).toBe(false)
  expect(projectRecordSchema.safeParse({ ...blocker, resolutionSteps: [] }).success).toBe(false)
  expect(projectRecordSchema.safeParse({ ...blocker, state: "answered" }).success).toBe(false)
  expect(projectRecordSchema.safeParse({ ...blocker, state: "resolved" }).success).toBe(false)
  expect(
    projectRecordSchema.safeParse({
      ...blocker,
      state: "resolved",
      resolutionEvidence: ["Exact build started."],
    }).success,
  ).toBe(true)
})
