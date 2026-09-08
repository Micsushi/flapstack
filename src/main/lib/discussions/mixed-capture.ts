import { basename } from "node:path"
import { z } from "zod"
import {
  captureMixedSchema,
  type DiscussionTopic,
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
} from "./assistant-policy"
import { DiscussionError, DiscussionService } from "./service"

type Generator = typeof generateDiscussionResult
type Records = Pick<ProjectRecordsClient, "list" | "read">
const candidateLimits = { topics: 3, records: 6 } as const
const dedupUnavailable =
  "Canonical comparison is unavailable. These groups are not confirmed unique against project records."

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

/** One local model proposal; exact identity checks happen before the atomic write. */
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
      originalText: input.body,
      existingTopics,
      canonicalRecords,
      canonicalComparison: dedupStatus,
    }
    // Drop low-ranked candidates, never silently cut the original or a prior topic summary.
    while (
      JSON.stringify(source).length > DISCUSSION_ASSISTANT_POLICY.maxContextCharacters &&
      source.canonicalRecords.length
    )
      source.canonicalRecords.pop()
    while (
      JSON.stringify(source).length > DISCUSSION_ASSISTANT_POLICY.maxContextCharacters &&
      source.existingTopics.length
    )
      source.existingTopics.pop()
    const generated = await (options.generate ?? generateDiscussionResult)({
      kind: "capture",
      source,
      schema: mixedCaptureSuggestionSchema,
    })
    const suggestion = mixedCaptureSuggestionSchema.parse(generated.result)
    const seenQuotes = new Set<string>(),
      seenTopics = new Set<string>()
    const groups = suggestion.topics.map((group) => {
      if (!input.body.includes(group.quote) || seenQuotes.has(group.quote))
        throw new DiscussionError(
          "BAD_REQUEST",
          "Grouped quotes must be distinct exact source substrings",
        )
      seenQuotes.add(group.quote)
      const existing = group.existingTopicId
        ? existingTopics.find((topic) => topic.id === group.existingTopicId)
        : undefined
      if (group.existingTopicId && (!existing || seenTopics.has(group.existingTopicId)))
        throw new DiscussionError("BAD_REQUEST", "Grouped topic was not a unique scoped candidate")
      if (existing) seenTopics.add(existing.id)
      if (
        new Set(group.recordIds).size !== group.recordIds.length ||
        group.recordIds.some((id) => !canonicalRecords.some((record) => record.id === id))
      )
        throw new DiscussionError(
          "BAD_REQUEST",
          "Canonical links were not supplied project feature candidates",
        )
      return { ...group, expectedRevision: existing?.revision }
    })
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
    return service.applyMixed(original, groups, {
      state: "grouped",
      dedupStatus,
      warning: dedupStatus === "unavailable" ? dedupUnavailable : null,
      model: generated.model,
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
) {
  try {
    const generated = await generate({
      kind: "summary",
      source: { currentSummary: topic.summary, latestCapture: topic.captures.at(-1) },
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
