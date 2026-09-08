import type Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { z } from "zod"
import {
  createDiscussionSchema,
  captureMixedSchema,
  discussionListSchema,
  discussionScopeSchema,
  discussionSourceSchema,
  restoreDiscussionSchema,
  restoreMixedSchema,
  updateDiscussionSchema,
  type DiscussionScope,
  type DiscussionSource,
  type DiscussionTopic,
  type MixedCaptureState,
} from "../../../shared/discussions"

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
// Local origin identity, not an authentication credential or a claim of remote access.
export const discussionHostId = () => `local-${hash(hostname()).slice(0, 32)}`
export class DiscussionError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN",
    message: string,
  ) {
    super(message)
  }
}
type Row = { body: string; revision: number }
const messageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    content: z.unknown().optional(),
    parts: z.array(z.unknown()).optional(),
  })
  .passthrough()
function sourceMessage(raw: unknown) {
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) return null
  const message = parsed.data
  const parts =
    message.parts ??
    (Array.isArray(message.content)
      ? message.content
      : typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [])
  const text =
    typeof message.content === "string"
      ? message.content
      : parts
          .flatMap((p) => {
            if (
              p &&
              typeof p === "object" &&
              "type" in p &&
              p.type === "text" &&
              "text" in p &&
              typeof p.text === "string"
            )
              return [p.text]
            return []
          })
          .join("\n")
  const images = parts.flatMap((p, partIndex) => {
    if (!p || typeof p !== "object" || !("type" in p)) return []
    if (
      p.type === "data-image" ||
      p.type === "image" ||
      p.type === "image_url" ||
      (p.type === "file" &&
        "mediaType" in p &&
        typeof p.mediaType === "string" &&
        p.mediaType.startsWith("image/"))
    )
      return [{ partIndex, imageIdentity: hash(p) }]
    if (p.type === "text" && "text" in p && typeof p.text === "string") {
      // Ordinary inline Markdown images; identity never authorizes fetching their URL.
      return Array.from(
        (p.text as string).matchAll(/!\[[^\]\n]*\]\((?:<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g),
        (match) => ({
          partIndex,
          imageIdentity: hash({ markdown: match[0], offset: match.index }),
        }),
      )
    }
    return []
  })
  return { messageId: message.id, role: message.role, revision: hash(raw), text, images }
}

export class DiscussionService {
  constructor(
    private readonly db: Database.Database,
    private readonly hostId = discussionHostId(),
  ) {}

  metadata() {
    return { hostId: this.hostId }
  }

  mixedCaptureContext(scope: DiscussionScope) {
    this.scope(scope)
    const project = this.db
      .prepare("SELECT path FROM projects WHERE id = ?")
      .get(scope.projectId) as { path: string }
    const topics = this.db
      .prepare(
        "SELECT id, revision, json_extract(body, '$.title') AS title, json_extract(body, '$.summary') AS summary FROM discussion_topics WHERE project_id = ? AND chat_id IS ? AND host_id = ? AND json_extract(body, '$.archived') = 0 AND json_extract(body, '$.captureBatch') IS NULL ORDER BY updated_at DESC, id LIMIT 200",
      )
      .all(scope.projectId, scope.chatId, scope.hostId) as Array<{
      id: string
      revision: number
      title: string
      summary: string
    }>
    return { projectPath: project.path, topics }
  }

  createMixedOriginal(raw: z.input<typeof captureMixedSchema>) {
    const input = captureMixedSchema.parse(raw)
    return this.db.transaction(() => {
      const topic = this.create({
        scope: input.scope,
        title: input.title ?? input.body.trim().slice(0, 120),
        capture: { body: input.body, kind: "note" },
      })
      // Preserve the exact original once; derived captures point back to this source and range.
      topic.captures[0]!.body = input.body
      topic.captureBatch = {
        state: "unsorted",
        dedupStatus: "unavailable",
        warning: "Original saved; grouping has not completed.",
        model: null,
        topicIds: [],
      }
      topic.revision++
      return this.save(topic, 1)
    })()
  }

  finishMixedOriginal(original: DiscussionTopic, state: MixedCaptureState) {
    return this.db.transaction(() => {
      const current = this.read(original.scope, original.id)
      if (current.revision !== original.revision)
        throw new DiscussionError("CONFLICT", "Original capture changed while grouping")
      current.captureBatch = state
      current.archived = state.state === "grouped"
      current.revision++
      current.updatedAt = Date.now()
      return this.save(current, original.revision)
    })()
  }

  applyMixed(
    original: DiscussionTopic,
    groups: Array<{
      title: string
      kind: "fix" | "idea" | "note"
      quote: string
      summary: string
      existingTopicId: string | null
      expectedRevision?: number
      recordIds: string[]
    }>,
    state: Omit<MixedCaptureState, "topicIds">,
  ) {
    return this.db.transaction(() => {
      if (groups.length < 1 || groups.length > 8)
        throw new DiscussionError("BAD_REQUEST", "Capture requires one to eight groups")
      const topics: DiscussionTopic[] = []
      const changes: z.infer<typeof restoreMixedSchema>["changes"] = []
      const seen = new Set<string>()
      for (const group of groups) {
        const start = original.captures[0]!.body.indexOf(group.quote)
        if (start < 0)
          throw new DiscussionError("BAD_REQUEST", "Grouped quote is not an exact source substring")
        const prior = group.existingTopicId
          ? this.read(original.scope, group.existingTopicId)
          : null
        if (
          prior &&
          (prior.revision !== group.expectedRevision || prior.archived || prior.id === original.id)
        )
          throw new DiscussionError("CONFLICT", "An existing topic changed while grouping")
        if (prior && seen.has(prior.id))
          throw new DiscussionError("BAD_REQUEST", "Group each existing topic only once")
        let topic = prior
          ? this.update({
              scope: original.scope,
              id: prior.id,
              expectedRevision: prior.revision,
              change: { type: "capture", capture: { kind: group.kind, body: group.quote } },
            })
          : this.create({
              scope: original.scope,
              title: group.title,
              summary: group.summary,
              capture: { kind: group.kind, body: group.quote },
            })
        seen.add(topic.id)
        topic.captures[topic.captures.length - 1]!.origin = {
          topicId: original.id,
          captureId: original.captures[0]!.id,
          start,
          end: start + group.quote.length,
        }
        topic.summary = group.summary
        if (prior) topic.summaryHistory.push({ summary: group.summary, createdAt: Date.now() })
        topic.canonicalRecordIds = [...new Set([...topic.canonicalRecordIds, ...group.recordIds])]
        const version = topic.revision
        topic.revision++
        topic.updatedAt = Date.now()
        topic = this.save(topic, version)
        topics.push(topic)
        changes.push({
          id: topic.id,
          expectedRevision: topic.revision,
          targetRevision: prior?.revision ?? null,
        })
      }
      const source = this.finishMixedOriginal(original, {
        ...state,
        topicIds: topics.map((topic) => topic.id),
      })
      changes.push({ id: source.id, expectedRevision: source.revision, targetRevision: null })
      return {
        topics,
        originalTopicId: source.id,
        ...state,
        undo: { scope: source.scope, changes },
      }
    })()
  }

  restoreMixed(raw: z.input<typeof restoreMixedSchema>) {
    const input = restoreMixedSchema.parse(raw)
    return this.db.transaction(() => {
      if (new Set(input.changes.map((change) => change.id)).size !== input.changes.length)
        throw new DiscussionError("BAD_REQUEST", "Restore each topic only once")
      const topics: DiscussionTopic[] = []
      const changes: z.infer<typeof restoreMixedSchema>["changes"] = []
      for (const change of input.changes) {
        const before = this.read(input.scope, change.id)
        const topic =
          change.targetRevision === null
            ? this.update({
                scope: input.scope,
                id: change.id,
                expectedRevision: change.expectedRevision,
                change: { type: "archive", archived: true },
              })
            : this.restore({ scope: input.scope, ...change, targetRevision: change.targetRevision })
        topics.push(topic)
        changes.push({
          id: topic.id,
          expectedRevision: topic.revision,
          targetRevision: before.revision,
        })
      }
      return { topics, undo: { scope: input.scope, changes } }
    })()
  }

  private scope(raw: DiscussionScope) {
    const scope = discussionScopeSchema.parse(raw)
    if (scope.hostId !== this.hostId)
      throw new DiscussionError("FORBIDDEN", "Discussion host does not match this local host")
    const project = this.db
      .prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL")
      .get(scope.projectId)
    if (!project) throw new DiscussionError("NOT_FOUND", "Discussion project is unavailable")
    if (
      scope.chatId &&
      !this.db
        .prepare("SELECT id FROM chats WHERE id = ? AND project_id = ? AND archived_at IS NULL")
        .get(scope.chatId, scope.projectId)
    )
      throw new DiscussionError("FORBIDDEN", "Chat does not belong to the discussion project")
    return scope
  }

  sources(scope: DiscussionScope, subChatId: string, messageId: string) {
    this.scope(scope)
    const row = this.db
      .prepare(
        "SELECT CASE WHEN length(cast(j.value AS blob)) <= 8388608 THEN j.value ELSE NULL END AS message FROM sub_chats s JOIN chats c ON c.id = s.chat_id JOIN json_each(s.messages) j WHERE s.id = ? AND c.project_id = ? AND c.archived_at IS NULL AND (? IS NULL OR c.id = ?) AND json_extract(j.value, '$.id') = ? LIMIT 1",
      )
      .get(subChatId, scope.projectId, scope.chatId, scope.chatId, messageId) as
      { message: string | null } | undefined
    if (!row)
      throw new DiscussionError("FORBIDDEN", "Message source is outside this discussion scope")
    if (!row.message)
      throw new DiscussionError(
        "BAD_REQUEST",
        "Source message exceeds 8 MiB; capture a shorter excerpt in a new message",
      )
    const message = sourceMessage(JSON.parse(row.message))
    if (message && Buffer.byteLength(JSON.stringify(message)) > 512 * 1024)
      throw new DiscussionError(
        "BAD_REQUEST",
        "Source text exceeds 512 KiB; capture a shorter excerpt in a new message",
      )
    return message ? [message] : []
  }

  private validateSource(scope: DiscussionScope, raw: DiscussionSource) {
    const source = discussionSourceSchema.parse(raw)
    const message = this.sources(scope, source.subChatId, source.messageId).find(
      (m) => m.messageId === source.messageId,
    )
    if (!message || message.role !== source.role || message.revision !== source.revision)
      throw new DiscussionError(
        "CONFLICT",
        "Source message changed; select the current source again",
      )
    const target = source.target
    if (target.kind === "text") {
      if (
        target.end <= target.start ||
        target.end > message.text.length ||
        message.text.slice(target.start, target.end) !== target.quote
      )
        throw new DiscussionError("CONFLICT", "Selected quote does not match the source revision")
    } else if (
      !message.images.some(
        (image) =>
          image.partIndex === target.partIndex && image.imageIdentity === target.imageIdentity,
      )
    )
      throw new DiscussionError("CONFLICT", "Selected image does not match the source revision")
  }

  list(raw: z.input<typeof discussionListSchema>) {
    const input = discussionListSchema.parse(raw)
    const scope = this.scope(input.scope)
    const rows = this.db
      .prepare(
        "SELECT id, body, updated_at FROM discussion_topics WHERE project_id = ? AND chat_id IS ? AND host_id = ? AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id LIMIT ?",
      )
      .iterate(
        scope.projectId,
        scope.chatId,
        scope.hostId,
        input.cursor?.updatedAt ?? null,
        input.cursor?.updatedAt ?? null,
        input.cursor?.updatedAt ?? null,
        input.cursor?.id ?? null,
        input.limit + 1,
      )
    const topics: DiscussionTopic[] = []
    let bytes = 0
    let nextCursor: { updatedAt: number; id: string } | null = null
    for (const rawRow of rows) {
      const row = rawRow as { id: string; body: string; updated_at: number }
      const size = Buffer.byteLength(row.body)
      if (topics.length >= input.limit || (topics.length > 0 && bytes + size > 4 * 1024 * 1024)) {
        const last = topics[topics.length - 1]!
        nextCursor = { updatedAt: last.updatedAt, id: last.id }
        break
      }
      topics.push(JSON.parse(row.body))
      bytes += size
    }
    return { topics, nextCursor }
  }

  read(scope: DiscussionScope, id: string): DiscussionTopic {
    this.scope(scope)
    const row = this.db
      .prepare(
        "SELECT body FROM discussion_topics WHERE id = ? AND project_id = ? AND chat_id IS ? AND host_id = ?",
      )
      .get(id, scope.projectId, scope.chatId, scope.hostId) as Row | undefined
    if (!row) throw new DiscussionError("NOT_FOUND", "Discussion was not found in this scope")
    return JSON.parse(row.body)
  }

  private save(topic: DiscussionTopic, expectedRevision?: number) {
    const body = JSON.stringify(topic)
    // ponytail: bounded aggregate keeps updates atomic; normalize if real topics exceed 2 MiB.
    if (Buffer.byteLength(body) > 2 * 1024 * 1024)
      throw new DiscussionError(
        "BAD_REQUEST",
        "Discussion reached its 2 MiB limit; create another topic",
      )
    if (expectedRevision === undefined) {
      this.db
        .prepare(
          "INSERT INTO discussion_topics (id, project_id, chat_id, host_id, revision, body, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          topic.id,
          topic.scope.projectId,
          topic.scope.chatId,
          topic.scope.hostId,
          topic.revision,
          body,
          topic.updatedAt,
        )
    } else {
      const result = this.db
        .prepare(
          "UPDATE discussion_topics SET body = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
        )
        .run(body, topic.revision, topic.updatedAt, topic.id, expectedRevision)
      if (!result.changes)
        throw new DiscussionError("CONFLICT", "Discussion changed; refresh before saving")
    }
    this.db
      .prepare("INSERT INTO discussion_revisions (topic_id, revision, body) VALUES (?, ?, ?)")
      .run(topic.id, topic.revision, body)
    // Keep bounded undo snapshots plus the initial promotion snapshots used for safe reversal.
    this.db
      .prepare(
        "DELETE FROM discussion_revisions WHERE topic_id = ? AND revision > 2 AND revision <= ?",
      )
      .run(topic.id, topic.revision - 50)
    return topic
  }

  create(raw: z.input<typeof createDiscussionSchema>): DiscussionTopic {
    const input = createDiscussionSchema.parse(raw)
    return this.db.transaction(() => {
      const scope = this.scope(input.scope)
      if (input.capture.source) this.validateSource(scope, input.capture.source)
      const now = Date.now()
      return this.save({
        id: randomUUID(),
        scope,
        title: input.title,
        summary: input.summary,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        archived: false,
        read: false,
        status: "more-work",
        captures: [{ ...input.capture, id: randomUUID(), createdAt: now }],
        summaryHistory: [{ summary: input.summary, createdAt: now }],
        questions: [],
        annotations: [],
        canonicalRecordIds: [],
        promotedFrom: null,
      })
    })()
  }

  update(raw: z.input<typeof updateDiscussionSchema>): DiscussionTopic {
    const input = updateDiscussionSchema.parse(raw)
    return this.db.transaction(() => {
      const topic = this.read(input.scope, input.id)
      if (topic.revision !== input.expectedRevision)
        throw new DiscussionError("CONFLICT", "Discussion changed; refresh before saving")
      const change = input.change
      const now = Date.now()
      switch (change.type) {
        case "capture":
          if (change.capture.source) this.validateSource(topic.scope, change.capture.source)
          topic.captures.push({ ...change.capture, id: randomUUID(), createdAt: now })
          break
        case "summary":
          topic.summary = change.summary
          topic.summaryHistory.push({ summary: change.summary, createdAt: now })
          break
        case "question":
          if (
            new Set(change.question.choices.map((c) => c.id)).size !==
            change.question.choices.length
          )
            throw new DiscussionError("BAD_REQUEST", "Question choices must have unique IDs")
          topic.questions.push({
            ...change.question,
            id: randomUUID(),
            createdAt: now,
            draft: { choiceIds: [], text: "" },
            answers: [],
          })
          break
        case "draft":
        case "answer": {
          const question = topic.questions.find((q) => q.id === change.questionId)
          if (!question) throw new DiscussionError("NOT_FOUND", "Question was not found")
          if (
            new Set(change.answer.choiceIds).size !== change.answer.choiceIds.length ||
            change.answer.choiceIds.some((id) => !question.choices.some((c) => c.id === id))
          )
            throw new DiscussionError(
              "BAD_REQUEST",
              "Answer contains an unknown or repeated choice",
            )
          if (
            change.type === "answer" &&
            !change.answer.choiceIds.length &&
            !change.answer.text.trim()
          )
            throw new DiscussionError("BAD_REQUEST", "Choose an option or write an answer")
          question.draft = change.answer
          if (change.type === "answer") question.answers.push({ ...change.answer, createdAt: now })
          break
        }
        case "annotation":
          this.validateSource(topic.scope, change.source)
          topic.annotations.push({
            id: randomUUID(),
            source: change.source,
            body: change.body,
            createdAt: now,
            followups: [],
            promotedTopicId: null,
          })
          break
        case "followup": {
          const annotation = topic.annotations.find((a) => a.id === change.annotationId)
          if (!annotation) throw new DiscussionError("NOT_FOUND", "Annotation was not found")
          annotation.followups.push({
            id: randomUUID(),
            body: change.body,
            role: change.role,
            createdAt: now,
            ...(change.role === "assistant" && change.model ? { model: change.model } : {}),
          })
          break
        }
        case "promote": {
          const annotation = topic.annotations.find((a) => a.id === change.annotationId)
          if (!annotation) throw new DiscussionError("NOT_FOUND", "Annotation was not found")
          if (annotation.promotedTopicId)
            throw new DiscussionError("CONFLICT", "Annotation already has a discussion")
          // Preserve the original source even when the message has since changed.
          const promoted = this.create({
            scope: topic.scope,
            title: change.title,
            capture: { kind: "note", body: annotation.body },
          })
          promoted.promotedFrom = { topicId: topic.id, annotationId: annotation.id }
          promoted.captures[0]!.source = annotation.source
          promoted.revision++
          this.save(promoted, 1)
          annotation.promotedTopicId = promoted.id
          break
        }
        case "status":
          topic.status = change.status
          break
        case "read":
          topic.read = change.read
          break
        case "archive":
          topic.archived = change.archived
          break
        case "link":
          if (!topic.canonicalRecordIds.includes(change.canonicalRecordId))
            topic.canonicalRecordIds.push(change.canonicalRecordId)
          break
      }
      topic.revision++
      topic.updatedAt = now
      return this.save(topic, input.expectedRevision)
    })()
  }

  restore(raw: z.input<typeof restoreDiscussionSchema>): DiscussionTopic {
    const input = restoreDiscussionSchema.parse(raw)
    return this.db.transaction(() => {
      const current = this.read(input.scope, input.id)
      if (current.revision !== input.expectedRevision)
        throw new DiscussionError("CONFLICT", "Discussion changed; undo would overwrite newer work")
      const row = this.db
        .prepare("SELECT body FROM discussion_revisions WHERE topic_id = ? AND revision = ?")
        .get(input.id, input.targetRevision) as Row | undefined
      if (!row) throw new DiscussionError("NOT_FOUND", "Saved discussion revision is unavailable")
      const restored: DiscussionTopic = JSON.parse(row.body)
      const links = (topic: DiscussionTopic) =>
        new Set(topic.annotations.flatMap((a) => (a.promotedTopicId ? [a.promotedTopicId] : [])))
      const before = links(current),
        after = links(restored)
      for (const id of new Set([...before, ...after])) {
        if (before.has(id) === after.has(id)) continue
        const child = this.read(current.scope, id)
        const original = this.db
          .prepare("SELECT body FROM discussion_revisions WHERE topic_id = ? AND revision = 2")
          .get(id) as Row | undefined
        const comparable = (topic: DiscussionTopic) => ({
          ...topic,
          revision: 0,
          updatedAt: 0,
          archived: false,
        })
        if (
          !original ||
          JSON.stringify(comparable(child)) !==
            JSON.stringify(comparable(JSON.parse(original.body)))
        )
          throw new DiscussionError(
            "CONFLICT",
            "Promoted discussion changed; preserve its work before undoing promotion",
          )
        const version = child.revision
        child.archived = !after.has(id)
        child.updatedAt = Date.now()
        child.revision++
        this.save(child, version)
      }
      restored.revision = current.revision + 1
      restored.updatedAt = Date.now()
      return this.save(restored, current.revision)
    })()
  }
}
