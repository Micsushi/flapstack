import { basename } from "node:path"
import { z } from "zod"
import {
  captureMixedSchema,
  type DiscussionTopic,
  type DiscussionCaptureSpan,
  type MixedCaptureResult,
} from "../../../shared/discussions"
import {
  configuredProjectRecordsClient,
  type ProjectRecordsClient,
} from "../project-records/client"
import { generateDiscussionResult } from "./assistant"
import {
  DISCUSSION_ASSISTANT_POLICY,
  discussionSummarySchema,
  mixedCaptureSuggestionSchema,
  mixedCaptureReviewSchema,
} from "./assistant-policy"
import { DiscussionError, DiscussionService } from "./service"

type Generator = typeof generateDiscussionResult
type Records = Pick<ProjectRecordsClient, "list" | "read">
const candidateLimits = { topics: 3, records: 6 } as const
const dedupUnavailable =
  "Canonical comparison is unavailable. These groups are not confirmed unique against project records."

/** Lossless sentence/newline segmentation. Coalesce adjacent spans if input is unusually fragmented. */
export function segmentCaptureSource(text: string): DiscussionCaptureSpan[] {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let end = 1; end <= text.length; end++) {
    if (
      (text[end - 1] === "\n" ||
        (/[.!?]/.test(text[end - 1]!) && (end === text.length || /\s/.test(text[end]!)))) &&
      text.slice(start, end).trim()
    ) {
      ranges.push({ start, end })
      start = end
    }
  }
  if (start < text.length) {
    if (text.slice(start).trim() || !ranges.length) ranges.push({ start, end: text.length })
    else ranges[ranges.length - 1]!.end = text.length
  }
  const stride = Math.max(1, Math.ceil(ranges.length / DISCUSSION_ASSISTANT_POLICY.captureMaxSpans))
  const spans: DiscussionCaptureSpan[] = []
  for (let index = 0; index < ranges.length; index += stride) {
    const start = ranges[index]!.start,
      end = ranges[Math.min(index + stride, ranges.length) - 1]!.end
    spans.push({ id: `s${spans.length + 1}`, start, end, text: text.slice(start, end) })
  }
  return spans
}

function relevant<T>(rows: T[], original: string, label: (row: T) => string, limit: number) {
  const words = new Set(original.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  return rows
    .map((row, index) => ({
      row,
      index,
      score: (
        label(row)
          .toLocaleLowerCase()
          .match(/[\p{L}\p{N}]{3,}/gu) ?? []
      ).reduce((score, word) => score + Number(words.has(word)), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.row)
}

/** Propose, verify meaning, and optionally repair once before the atomic write. */
export async function captureMixed(
  service: DiscussionService,
  raw: z.input<typeof captureMixedSchema>,
  options: {
    generate?: Generator
    records?: () => Promise<Records>
  } = {},
): Promise<MixedCaptureResult> {
  const input = captureMixedSchema.parse(raw)
  const context = service.mixedCaptureContext(input.scope)
  const original = service.createMixedOriginal(input)
  let dedupStatus: "available" | "unavailable" = "unavailable"
  let records: Records | undefined
  let recordPath: string | undefined
  let recordRevision: string | undefined
  let canonicalRecords: Array<{ id: string; title: string; state: string }> = []
  try {
    records = await (options.records ?? configuredProjectRecordsClient)()
    // The exact repository basename must be present in the canonical index. No guessed aliases.
    const slug = basename(context.projectPath.replace(/\\/g, "/"))
    const path = `projects/${slug}/features.md`
    const index = await records.list()
    if (!index.documents.some((document) => document.path === path))
      throw new Error("Project is not indexed")
    const snapshot = await records.read(path)
    canonicalRecords = relevant(
      snapshot.document.records.filter((record) => record.kind === "feature"),
      input.body,
      (record) =>
        `${record.title} ${typeof record.description === "string" ? record.description : ""}`,
      candidateLimits.records,
    ).map((record) => ({ id: record.id, title: record.title, state: record.state }))
    recordPath = path
    recordRevision = snapshot.revision
    dedupStatus = "available"
  } catch {
    records = undefined
  }

  try {
    const existingTopics = relevant(
      context.topics,
      input.body,
      (topic) => `${topic.title} ${topic.summary}`,
      candidateLimits.topics,
    )
    const source = {
      sourceSpans: segmentCaptureSource(input.body),
      existingTopics,
      canonicalRecords,
      canonicalComparison: dedupStatus,
    }
    // Drop low-ranked candidates, never silently cut the original or a prior topic summary.
    while (
      JSON.stringify(source).length >
        DISCUSSION_ASSISTANT_POLICY.maxContextCharacters -
          DISCUSSION_ASSISTANT_POLICY.captureReviewReserveCharacters &&
      source.canonicalRecords.length
    )
      source.canonicalRecords.pop()
    while (
      JSON.stringify(source).length >
        DISCUSSION_ASSISTANT_POLICY.maxContextCharacters -
          DISCUSSION_ASSISTANT_POLICY.captureReviewReserveCharacters &&
      source.existingTopics.length
    )
      source.existingTopics.pop()
    const generate = options.generate ?? generateDiscussionResult
    type Proposal = z.infer<typeof mixedCaptureSuggestionSchema>
    let previousProposal: Proposal | undefined
    let reviewIssues: string[] = []
    let approved:
      | {
          groups: Array<
            Proposal["topics"][number] & {
              expectedRevision?: number
              spans: DiscussionCaptureSpan[]
            }
          >
          model: string
          review: { model: string; repairs: number }
        }
      | undefined
    for (let attempt = 0; attempt <= DISCUSSION_ASSISTANT_POLICY.captureRepairAttempts; attempt++) {
      const generated = await generate({
        kind: "capture",
        source: previousProposal ? { ...source, previousProposal, reviewIssues } : source,
        schema: mixedCaptureSuggestionSchema,
      })
      const suggestion = mixedCaptureSuggestionSchema.parse(generated.result)
      previousProposal = suggestion
      let groups: NonNullable<typeof approved>["groups"] | undefined
      try {
        const selectedSpans = new Set<string>(),
          seenTopics = new Set<string>()
        groups = suggestion.topics.map((group) => {
          if (new Set(group.spanIds).size !== group.spanIds.length)
            throw new DiscussionError("BAD_REQUEST", "Select each source span once within a topic")
          const spans = group.spanIds
            .map((id) => {
              const span = source.sourceSpans.find((span) => span.id === id)
              if (!span)
                throw new DiscussionError(
                  "BAD_REQUEST",
                  `Unknown source span ${id}; select only supplied source span IDs`,
                )
              selectedSpans.add(id)
              return span
            })
            .sort((a, b) => a.start - b.start)
          const existing = group.existingTopicId
            ? existingTopics.find((topic) => topic.id === group.existingTopicId)
            : undefined
          if (group.existingTopicId && (!existing || seenTopics.has(group.existingTopicId)))
            throw new DiscussionError(
              "BAD_REQUEST",
              "Use each supplied existing topic once, combining its related quotes",
            )
          if (existing) seenTopics.add(existing.id)
          if (
            new Set(group.recordIds).size !== group.recordIds.length ||
            group.recordIds.some((id) => !canonicalRecords.some((record) => record.id === id))
          )
            throw new DiscussionError(
              "BAD_REQUEST",
              "Canonical links must be supplied project feature candidates",
            )
          return { ...group, spans, expectedRevision: existing?.revision }
        })
        const missing = source.sourceSpans.filter((span) => !selectedSpans.has(span.id))
        if (missing.length)
          throw new DiscussionError(
            "BAD_REQUEST",
            `Preserve every source span; missing IDs: ${missing.map((span) => span.id).join(", ")}`,
          )
      } catch (error) {
        if (!(error instanceof DiscussionError)) throw error
        reviewIssues = [error.message]
        groups = undefined
      }
      if (!groups) continue
      const review = await generate({
        kind: "capture-review",
        source: { ...source, proposal: suggestion },
        schema: mixedCaptureReviewSchema,
      })
      const verdict = mixedCaptureReviewSchema.parse(review.result)
      if (verdict.accepted) {
        approved = {
          groups,
          model: generated.model,
          review: { model: review.model, repairs: attempt },
        }
        break
      }
      reviewIssues = verdict.issues
    }
    if (!approved)
      throw new DiscussionError(
        "BAD_REQUEST",
        "Grouping checks still failed after the bounded correction",
      )
    if (records && recordPath) {
      let latest
      try {
        latest = await records.read(recordPath)
      } catch (error) {
        dedupStatus = "unavailable"
        throw error
      }
      if (latest.revision !== recordRevision)
        throw new DiscussionError("CONFLICT", "Canonical records changed while grouping")
    }
    return service.applyMixed(original, approved.groups, {
      state: "grouped",
      dedupStatus,
      warning: dedupStatus === "unavailable" ? dedupUnavailable : null,
      model: approved.model,
      review: approved.review,
    })
  } catch {
    const warning = `Grouping could not be completed or validated. The original remains unsorted.${dedupStatus === "unavailable" ? ` ${dedupUnavailable}` : ""}`
    let saved = original
    try {
      saved = service.finishMixedOriginal(original, {
        state: "unsorted",
        dedupStatus,
        warning,
        model: null,
        topicIds: [],
      })
    } catch {
      // A late result must not overwrite owner edits, even just to change a failure label.
    }
    return {
      topics: [saved],
      originalTopicId: original.id,
      state: "unsorted",
      dedupStatus,
      warning,
      model: null,
      undo: {
        scope: original.scope,
        changes: [{ id: original.id, expectedRevision: saved.revision, targetRevision: null }],
      },
    }
  }
}

/** Call after saving a note. Failure never rolls back the already-durable capture. */
export async function refreshDiscussionSummary(
  service: DiscussionService,
  topic: DiscussionTopic,
  generate: Generator = generateDiscussionResult,
  context?: { answeredQuestionId: string },
) {
  try {
    const question = context
      ? topic.questions.find((question) => question.id === context.answeredQuestionId)
      : undefined
    const answer = question?.answers.at(-1)
    if (context && (!question || !answer))
      return { topic, model: null, warning: "No committed answer is available for the summary." }
    const generated = await generate({
      kind: "summary",
      source:
        question && answer
          ? {
              currentSummary: topic.summary,
              committedAnswer: {
                question: question.prompt,
                selectedChoices: question.choices.filter((choice) =>
                  answer.choiceIds.includes(choice.id),
                ),
                freeText: answer.text,
              },
            }
          : { currentSummary: topic.summary, latestCapture: topic.captures.at(-1) },
      schema: discussionSummarySchema,
    })
    return {
      topic: service.update({
        scope: topic.scope,
        id: topic.id,
        expectedRevision: topic.revision,
        change: { type: "summary", summary: generated.result.summary },
      }),
      model: generated.model,
      warning: null,
    }
  } catch {
    return {
      topic,
      model: null,
      warning: "The note is saved. Automatic summary was unavailable or the topic changed.",
    }
  }
}
