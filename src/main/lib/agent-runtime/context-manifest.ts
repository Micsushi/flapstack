import { createHash } from "node:crypto"
import {
  runtimeCompositionPreviewSchema,
  visibleContextManifestSchema,
  type DelegationAuthorityCeiling,
  type ExecutionTarget,
  type RuntimeCompositionPreview,
  type VisibleContextManifest,
} from "../../../shared/runtime-composition"
import {
  handoffByteBudget,
  utf8Prefix,
  type HandoffBudget,
  type HandoffConversation,
  type HandoffMessage,
} from "../chat-handoff"
import { omitTextAttachmentReferences } from "../attachments/pasted-reference"
import { PORTABLE_SECRET_PLACEHOLDER, redactText } from "../portability/secrets"

export const FULL_CONVERSATION_BYTE_LIMIT = 1_000_000

type OmissionClass = VisibleContextManifest["omissions"][number]["class"]

export type VisibleContextSelection = {
  messageIds?: readonly string[]
  fileRefs?: readonly string[]
  artifactRefs?: readonly string[]
}

export function buildVisibleContextManifest(input: {
  sourceChatId: string
  sourceRunId: string | null
  conversations: readonly HandoffConversation[]
  selection?: VisibleContextSelection
  compact?: boolean
  fullConversation?: boolean
  budget?: HandoffBudget
}): { contextText: string; manifest: VisibleContextManifest } {
  const selectedIds = input.selection?.messageIds ? new Set(input.selection.messageIds) : null
  const omissions = new Map<OmissionClass, number>()
  const sections: string[] = [
    "# Imported visible history context",
    "",
    `Source Chat: ${input.sourceChatId}`,
    "This is bounded imported context, not native provider history.",
    "",
  ]
  if (input.fullConversation) {
    sections.splice(
      0,
      sections.length,
      "# Conversation from the source chat",
      "",
      "Use this prior conversation as context for the current request.",
      "",
    )
  }
  if (input.compact) sections.splice(0, sections.length, "# Conversation handoff", "")
  const selected: VisibleContextManifest["selected"] = []
  const candidates: Array<{
    heading: string
    body: string
    ref: Omit<VisibleContextManifest["selected"][number], "contentDigest" | "byteLength">
  }> = []

  for (const conversation of input.conversations) {
    // Keep the original request and the two latest exchanges. Only public conversation
    // text enters a compact handoff; tool arguments and thoughts stay in the source.
    const eligible = input.compact
      ? conversation.messages.flatMap((message, index) =>
          (message.role === "user" || message.role === "assistant") &&
          (!selectedIds ||
            selectedIds.has(normalizedMessageId(message, conversation.subChatId, index)))
            ? [index]
            : [],
        )
      : []
    const original = eligible.find((index) => conversation.messages[index]?.role === "user")
    const recent = new Set([...eligible.slice(-4), original])
    for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex += 1) {
      const message = conversation.messages[messageIndex]!
      const messageId = normalizedMessageId(message, conversation.subChatId, messageIndex)
      if (
        (input.compact && !recent.has(messageIndex)) ||
        (input.fullConversation && message.role !== "user" && message.role !== "assistant") ||
        (selectedIds && !selectedIds.has(messageId))
      ) {
        addOmission(omissions, "unselected-message")
        continue
      }
      const rendered = renderMessage(message, omissions, input.compact || input.fullConversation)
      const candidateRole =
        typeof message.role === "string" && message.role.trim() ? message.role : "message"
      const role = containsSecret(candidateRole) ? "message" : candidateRole
      if (role !== candidateRole) addOmission(omissions, "secret-or-credential")
      const candidateConversationLabel = conversation.subChatName || conversation.subChatId
      const conversationLabel = containsSecret(candidateConversationLabel)
        ? conversation.subChatId
        : candidateConversationLabel
      if (conversationLabel !== candidateConversationLabel) {
        addOmission(omissions, "secret-or-credential")
      }
      const visible = rendered.parts
        .map((part) => part.text)
        .join("\n\n")
        .trim()
      if (input.compact && !visible) {
        addOmission(omissions, "unselected-message")
        continue
      }
      const heading = input.compact
        ? messageIndex === original
          ? "Original request"
          : role === "user"
            ? "Recent request"
            : "Assistant update"
        : input.fullConversation
          ? role === "user"
            ? "User"
            : "Assistant"
          : role + " · " + conversationLabel + " · " + messageId
      candidates.push({
        heading,
        body: visible,
        ref: {
          sourceSubChatId: conversation.subChatId,
          messageId,
          role,
          partIndexes: rendered.parts.map((part) => part.index),
        },
      })
    }
  }

  const budgetNote = "Some earlier or oversized messages were omitted to fit this handoff."
  const marker = "\n[Message excerpt]"
  let remaining =
    (input.fullConversation ? FULL_CONVERSATION_BYTE_LIMIT : handoffByteBudget(input.budget)) -
    Buffer.byteLength(sections.join("\n") + budgetNote + "\n\n")
  const included = new Map<number, string>()
  const latestUser = candidates.findLastIndex((item) => item.ref.role === "user")
  const latestAssistant = candidates.findLastIndex((item) => item.ref.role === "assistant")
  const original = candidates.findIndex((item) => item.ref.role === "user")
  const priority = new Set([
    latestUser,
    latestAssistant,
    original,
    ...candidates.map((_, index) => candidates.length - 1 - index),
  ])
  for (const index of priority) {
    const candidate = candidates[index]
    if (!candidate) continue
    const overhead = Buffer.byteLength("## " + candidate.heading + "\n\n\n\n")
    const body = candidate.body || "_(No transferable visible content)_"
    const cost = overhead + Buffer.byteLength(body)
    if (cost <= remaining) {
      included.set(index, body)
      remaining -= cost
    } else if ((index === latestUser || index === latestAssistant) && remaining > overhead + 128) {
      const allowance = Math.min(remaining, Math.max(overhead + 128, Math.floor(remaining / 2)))
      const snippet = utf8Prefix(body, allowance - overhead - Buffer.byteLength(marker)).trimEnd()
      if (snippet) {
        const excerpt = snippet + marker
        included.set(index, excerpt)
        remaining -= overhead + Buffer.byteLength(excerpt)
      }
      addOmission(omissions, "context-budget")
    } else {
      addOmission(omissions, "context-budget")
    }
  }
  if (omissions.has("context-budget")) sections.push(budgetNote, "")
  for (const [index, body] of [...included].sort(([left], [right]) => left - right)) {
    const candidate = candidates[index]!
    sections.push("## " + candidate.heading, "", body, "")
    selected.push({
      ...candidate.ref,
      contentDigest: sha256(body),
      byteLength: Buffer.byteLength(body),
    })
  }
  if (input.compact && !selected.length)
    throw new Error("No transferable conversation text is available for this handoff.")
  const contextText = sections.join("\n").trimEnd() + "\n"
  if (containsSecret(contextText)) {
    throw new Error("Cross-provider visible context still contains detected secret material.")
  }
  const base = {
    schemaVersion: 1 as const,
    sourceChatId: input.sourceChatId,
    sourceRunId: input.sourceRunId,
    selected,
    selectedFileRefs: secretSafeRefs(input.selection?.fileRefs ?? [], omissions),
    selectedArtifactRefs: secretSafeRefs(input.selection?.artifactRefs ?? [], omissions),
    omissions: [...omissions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([omissionClass, count]) => ({ class: omissionClass, count })),
    contentDigest: sha256(contextText),
  }
  return {
    contextText,
    manifest: visibleContextManifestSchema.parse({
      ...base,
      digest: sha256(canonicalJson(base)),
    }),
  }
}

export function createRuntimeCompositionPreview(input: {
  mode?: "continue" | "delegate"
  objective?: string
  requiredCapabilities?: readonly string[]
  outputSchema?: Record<string, unknown> | null
  targetSnapshot: ExecutionTarget
  visibleContextManifest: VisibleContextManifest
  authorityCeiling: DelegationAuthorityCeiling
  worktreeLease?: {
    leaseId: string | null
    path: string | null
    branch: string | null
    fingerprint: string
  }
  availability?: {
    state: "available" | "blocked" | "repair-required"
    reason: string | null
    repair: string | null
  }
}): RuntimeCompositionPreview {
  const requiredCapabilities = sortedUnique(input.requiredCapabilities ?? [])
  const base = {
    schemaVersion: 1 as const,
    mode: input.mode ?? ("continue" as const),
    objectiveDigest: sha256(input.objective?.trim() ?? ""),
    requiredCapabilities,
    outputSchemaDigest: input.outputSchema ? sha256(canonicalJson(input.outputSchema)) : null,
    targetSnapshot: input.targetSnapshot,
    visibleContextManifest: input.visibleContextManifest,
    authorityCeiling: input.authorityCeiling,
    worktreeLease: input.worktreeLease ?? {
      leaseId: input.authorityCeiling.worktreeLeaseId,
      path: input.targetSnapshot.workspace.worktreePath,
      branch: input.targetSnapshot.workspace.branch,
      fingerprint: sha256(
        canonicalJson({
          path: input.targetSnapshot.workspace.worktreePath,
          branch: input.targetSnapshot.workspace.branch,
        }),
      ),
    },
    availability: input.availability ?? {
      state: "available" as const,
      reason: null,
      repair: null,
    },
  }
  return runtimeCompositionPreviewSchema.parse({
    ...base,
    digest: sha256(canonicalJson(base)),
  })
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function renderMessage(
  message: HandoffMessage,
  omissions: Map<OmissionClass, number>,
  compact = false,
): { parts: Array<{ index: number; text: string }> } {
  if (typeof message.content === "string") {
    if (containsSecret(message.content)) {
      addOmission(omissions, "secret-or-credential")
      return { parts: [] }
    }
    return {
      parts: message.content.trim()
        ? [{ index: 0, text: withoutTextAttachments(message.content, omissions) }]
        : [],
    }
  }
  const parts = message.parts ?? (Array.isArray(message.content) ? message.content : [])
  return {
    parts: parts.flatMap((unknownPart, index) => {
      const part = asRecord(unknownPart)
      const type = stringValue(part?.type)
      if (!part || !type) {
        addOmission(omissions, "unsupported-content")
        return []
      }
      if (type === "reasoning" || type === "tool-ReasoningOutput" || type === "tool-Thinking") {
        addOmission(omissions, "private-reasoning")
        return []
      }
      if (type === "file-content") {
        addOmission(omissions, "unselected-file")
        return []
      }
      if (type === "data-image" || type === "attachment" || type === "image") {
        addOmission(omissions, "unselected-attachment")
        return []
      }
      if (type === "text" || type === "data-user-steer") {
        const text = stringValue(type === "data-user-steer" ? part.data : part.text)
        if (!text) return []
        if (containsSecret(text) || hasSecretField(part)) {
          addOmission(omissions, "secret-or-credential")
          return []
        }
        const safe = withoutTextAttachments(text, omissions)
        return [{ index, text: type === "data-user-steer" ? "You steered: " + safe : safe }]
      }
      if (type === "tool-AskUserQuestion") {
        const visible = visibleQuestionAnswers(part).filter((text) => {
          if (!containsSecret(text)) return true
          addOmission(omissions, "secret-or-credential")
          return false
        })
        if (Object.keys(part).some((key) => !["type", "input", "result", "output"].includes(key))) {
          addOmission(omissions, "hidden-tool-state")
        }
        return visible.length
          ? [{ index, text: withoutTextAttachments(visible.join("\n"), omissions) }]
          : []
      }
      if (type === "tool-call" || type.startsWith("tool-")) {
        addOmission(omissions, "hidden-tool-state")
        if (compact) return []
        const candidateName = stringValue(part.toolName) ?? (type.replace(/^tool-/, "") || "tool")
        const name = containsSecret(candidateName) ? "tool" : candidateName
        if (name !== candidateName) addOmission(omissions, "secret-or-credential")
        return [{ index, text: `> Tool: ${name}` }]
      }
      addOmission(omissions, "unsupported-content")
      return []
    }),
  }
}

function withoutTextAttachments(text: string, omissions: Map<OmissionClass, number>) {
  const safe = omitTextAttachmentReferences(text)
  if (safe !== text) addOmission(omissions, "unselected-attachment")
  return safe
}

function visibleQuestionAnswers(part: Record<string, unknown>): string[] {
  const input = asRecord(part.input)
  const questions = Array.isArray(input?.questions) ? input.questions : []
  const questionText = questions.flatMap((question) => {
    const text = stringValue(asRecord(question)?.question)
    return text ? [`> Question: ${text}`] : []
  })
  const result = asRecord(part.result) ?? asRecord(part.output)
  const answers = asRecord(result?.answers)
  const answerText = answers
    ? Object.values(answers).flatMap((answer) => {
        const values = Array.isArray(answer) ? answer : [answer]
        return values.flatMap((value) => {
          const text = stringValue(value)
          return text ? [`> Answer: ${text}`] : []
        })
      })
    : []
  return [...questionText, ...answerText]
}

function containsSecret(value: string): boolean {
  const scanned = redactText(value, {
    scopeId: "settings",
    path: "cross-provider-visible-context",
  })
  return scanned.secretFound || scanned.value.includes(PORTABLE_SECRET_PLACEHOLDER)
}

function hasSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretField)
  const record = asRecord(value)
  if (!record) return false
  return Object.entries(record).some(([key, nested]) => {
    if (/secret|credential|password|authorization|api[_-]?key|access[_-]?token/i.test(key)) {
      return nested !== null && nested !== undefined
    }
    return hasSecretField(nested)
  })
}

function normalizedMessageId(message: HandoffMessage, subChatId: string, index: number): string {
  const id = stringValue(message.id)
  return id ?? `${subChatId}:message:${index + 1}`
}

function addOmission(omissions: Map<OmissionClass, number>, omissionClass: OmissionClass): void {
  omissions.set(omissionClass, (omissions.get(omissionClass) ?? 0) + 1)
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function secretSafeRefs(
  values: readonly string[],
  omissions: Map<OmissionClass, number>,
): string[] {
  return sortedUnique(values).filter((value) => {
    if (!containsSecret(value)) return true
    addOmission(omissions, "secret-or-credential")
    return false
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
