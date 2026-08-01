import { z } from "zod"
import {
  FEATURE_VISIBILITY_REGISTRY,
  previewVisibilityPreset,
  resolveOnboardingPreset,
  type FeatureVisibilityPreset,
  type OnboardingAnswers,
  type OptionalFeatureId,
  type VisibilityPreview,
  type VisibilityState,
} from "./feature-visibility"

export type OnboardingVisibilityStep =
  "welcome" | "hierarchy" | "questionnaire" | "review" | "complete"

export type OnboardingVisibilitySession = {
  version: 1
  step: OnboardingVisibilityStep
  skipped: boolean
  answers: Partial<OnboardingAnswers>
  baseRevision: number
  baseVisibility: Record<string, boolean>
  preview: VisibilityPreview | null
  apply: {
    preset: FeatureVisibilityPreset
    visibility: Record<string, boolean>
  } | null
}

export type OnboardingVisibilityAction =
  | { type: "continue" }
  | { type: "skip" }
  | { type: "review" }
  | {
      type: "answer"
      question: keyof OnboardingAnswers
      value: OnboardingAnswers[keyof OnboardingAnswers]
    }
  | { type: "customize"; featureId: OptionalFeatureId; visible: boolean }
  | { type: "confirm" }

const answersSchema = z
  .object({
    collaboration: z.enum(["solo-pair", "team-swarms"]).optional(),
    workflow: z.enum(["chat-first", "planning"]).optional(),
    reach: z.enum(["desktop", "cross-device"]).optional(),
    knowledge: z.enum(["notes", "graph"]).optional(),
  })
  .strict()

const visibilitySchema = z.record(z.string().min(1).max(120), z.boolean())
const changeSchema = z
  .object({
    id: z.enum([
      "plan",
      "saved-workspaces",
      "automations",
      "orchestration",
      "agent-profiles",
      "runtimes",
      "voice",
      "usage",
      "mobile-companion",
      "visual-context",
      "knowledge-graph",
    ]),
    before: z.boolean(),
    after: z.boolean(),
  })
  .strict()
const previewSchema = z
  .object({
    preset: z.enum(["focused", "standard", "complete"]),
    changes: z.array(changeSchema).max(FEATURE_VISIBILITY_REGISTRY.length),
    result: visibilitySchema,
  })
  .strict()

const sessionSchema = z
  .object({
    version: z.literal(1),
    step: z.enum(["welcome", "hierarchy", "questionnaire", "review", "complete"]),
    skipped: z.boolean(),
    answers: answersSchema,
    baseRevision: z.number().int().nonnegative(),
    baseVisibility: visibilitySchema,
    preview: previewSchema.nullable(),
    apply: z
      .object({
        preset: z.enum(["focused", "standard", "complete"]),
        visibility: visibilitySchema,
      })
      .strict()
      .nullable(),
  })
  .strict()

export function createOnboardingVisibilitySession(
  baseVisibility: VisibilityState = defaultVisibleState(),
  baseRevision = 0,
): OnboardingVisibilitySession {
  return {
    version: 1,
    step: "welcome",
    skipped: false,
    answers: {},
    baseRevision,
    baseVisibility: { ...baseVisibility },
    preview: null,
    apply: null,
  }
}

export function parseOnboardingVisibilitySession(serialized: string): OnboardingVisibilitySession {
  const raw = JSON.parse(serialized) as { version?: unknown }
  if (raw?.version !== 1) {
    throw new Error(`Unsupported onboarding visibility session version: ${String(raw?.version)}`)
  }
  return sessionSchema.parse(raw)
}

export function transitionOnboardingVisibility(
  sessionValue: OnboardingVisibilitySession,
  action: OnboardingVisibilityAction,
): OnboardingVisibilitySession {
  const session = sessionSchema.parse(sessionValue)
  if (session.step === "complete") {
    throw new Error("Completed onboarding cannot be changed.")
  }

  if (action.type === "continue") {
    if (session.step === "welcome") return { ...session, step: "hierarchy" }
    if (session.step === "hierarchy") return { ...session, step: "questionnaire" }
    throw new Error(`Continue is unavailable from onboarding step ${session.step}.`)
  }

  if (action.type === "skip") {
    return {
      ...session,
      step: "review",
      skipped: true,
      preview: previewVisibilityPreset(session.baseVisibility, "standard", {
        preserveUnknown: true,
      }),
      apply: null,
    }
  }

  if (action.type === "answer") {
    if (session.step !== "questionnaire") {
      throw new Error("Questionnaire answers are accepted only during the questionnaire.")
    }
    assertAnswer(action.question, action.value)
    return {
      ...session,
      answers: { ...session.answers, [action.question]: action.value },
    }
  }

  if (action.type === "review") {
    if (session.step !== "questionnaire") {
      throw new Error("Onboarding review is available only after the questionnaire.")
    }
    const answers = completeAnswers(session.answers)
    const preset = resolveOnboardingPreset(answers)
    return {
      ...session,
      step: "review",
      preview: previewVisibilityPreset(session.baseVisibility, preset, {
        preserveUnknown: true,
      }),
      apply: null,
    }
  }

  if (action.type === "customize") {
    if (session.step !== "review" || !session.preview) {
      throw new Error("Feature customization requires an active review.")
    }
    const result = {
      ...session.preview.result,
      [action.featureId]: action.visible,
    }
    return {
      ...session,
      preview: {
        ...session.preview,
        result,
        changes: FEATURE_VISIBILITY_REGISTRY.flatMap((entry) => {
          const before = session.baseVisibility[entry.id] ?? true
          const after = result[entry.id] ?? true
          return before === after ? [] : [{ id: entry.id, before, after }]
        }),
      },
      apply: null,
    }
  }

  if (session.step !== "review" || !session.preview) {
    throw new Error("Onboarding confirmation requires an active review.")
  }
  return {
    ...session,
    step: "complete",
    apply: {
      preset: session.preview.preset,
      visibility: { ...session.preview.result },
    },
  }
}

function completeAnswers(answers: Partial<OnboardingAnswers>): OnboardingAnswers {
  if (!answers.collaboration || !answers.workflow || !answers.reach || !answers.knowledge) {
    throw new Error("Every onboarding question must be answered before review.")
  }
  return answers as OnboardingAnswers
}

function assertAnswer(
  question: keyof OnboardingAnswers,
  value: OnboardingAnswers[keyof OnboardingAnswers],
): void {
  const allowed: Record<keyof OnboardingAnswers, readonly string[]> = {
    collaboration: ["solo-pair", "team-swarms"],
    workflow: ["chat-first", "planning"],
    reach: ["desktop", "cross-device"],
    knowledge: ["notes", "graph"],
  }
  if (!allowed[question].includes(value)) {
    throw new Error(`Invalid answer for onboarding question ${question}.`)
  }
}

function defaultVisibleState(): Record<string, boolean> {
  return Object.fromEntries(FEATURE_VISIBILITY_REGISTRY.map((entry) => [entry.id, true]))
}
