import { describe, expect, it } from "vitest"
import {
  createOnboardingVisibilitySession,
  parseOnboardingVisibilitySession,
  transitionOnboardingVisibility,
} from "../src/shared/onboarding-visibility"

describe("Stage 6 onboarding visibility state machine", () => {
  it("does not emit visibility mutation before exact review confirmation", () => {
    let session = createOnboardingVisibilitySession()
    expect(session.step).toBe("welcome")
    expect(session.apply).toBeNull()

    session = transitionOnboardingVisibility(session, { type: "continue" })
    session = transitionOnboardingVisibility(session, { type: "continue" })
    session = transitionOnboardingVisibility(session, {
      type: "answer",
      question: "collaboration",
      value: "solo-pair",
    })
    session = transitionOnboardingVisibility(session, {
      type: "answer",
      question: "workflow",
      value: "chat-first",
    })
    session = transitionOnboardingVisibility(session, {
      type: "answer",
      question: "reach",
      value: "desktop",
    })
    session = transitionOnboardingVisibility(session, {
      type: "answer",
      question: "knowledge",
      value: "notes",
    })
    session = transitionOnboardingVisibility(session, { type: "review" })

    expect(session.step).toBe("review")
    expect(session.preview?.preset).toBe("focused")
    expect(session.apply).toBeNull()

    session = transitionOnboardingVisibility(session, { type: "confirm" })
    expect(session.step).toBe("complete")
    expect(session.apply?.preset).toBe("focused")
  })

  it("makes skip review Standard instead of mutating immediately", () => {
    const review = transitionOnboardingVisibility(createOnboardingVisibilitySession(), {
      type: "skip",
    })
    expect(review).toMatchObject({
      step: "review",
      skipped: true,
      preview: { preset: "standard" },
      apply: null,
    })
    expect(transitionOnboardingVisibility(review, { type: "confirm" }).apply?.preset).toBe(
      "standard",
    )
  })

  it("round-trips every resumable step and rejects corrupt or unknown versions", () => {
    let session = createOnboardingVisibilitySession(undefined, 7)
    session = transitionOnboardingVisibility(session, { type: "continue" })
    session = transitionOnboardingVisibility(session, { type: "continue" })
    session = transitionOnboardingVisibility(session, {
      type: "answer",
      question: "collaboration",
      value: "team-swarms",
    })

    expect(parseOnboardingVisibilitySession(JSON.stringify(session))).toEqual(session)
    expect(session.baseRevision).toBe(7)
    expect(() =>
      parseOnboardingVisibilitySession(JSON.stringify({ ...session, version: 99 })),
    ).toThrow(/version/i)
    expect(() => parseOnboardingVisibilitySession('{"step":"complete"}')).toThrow()
  })

  it("supports review customization without changing safety or capability", () => {
    const review = transitionOnboardingVisibility(createOnboardingVisibilitySession(), {
      type: "skip",
    })
    const customized = transitionOnboardingVisibility(review, {
      type: "customize",
      featureId: "automations",
      visible: true,
    })
    expect(customized.preview?.result.automations).toBe(true)
    expect(customized.preview?.changes.some((change) => change.id === "automations")).toBe(false)
    expect(customized.apply).toBeNull()
  })
})
