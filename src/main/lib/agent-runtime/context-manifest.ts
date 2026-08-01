import { createHash } from "node:crypto"
import {
  runtimeCompositionPreviewSchema,
  visibleContextManifestSchema,
  type DelegationAuthorityCeiling,
  type ExecutionTarget,
  type RuntimeCompositionPreview,
  type VisibleContextManifest,
} from "../../../shared/runtime-composition"
import type { HandoffConversation, HandoffMessage } from "../chat-handoff"
import { PORTABLE_SECRET_PLACEHOLDER, redactText } from "../portability/secrets"

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
  const selected: VisibleContextManifest["selected"] = []

  for (const conversation of input.conversations) {
    for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex += 1) {
      const message = conversation.messages[messageIndex]!
      const messageId = normalizedMessageId(message, conversation.subChatId, messageIndex)
      if (selectedIds && !selectedIds.has(messageId)) {
        addOmission(omissions, "unselected-message")
        continue
      }
      const rendered = renderMessage(message, omissions)
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
      const body = rendered.parts
        .map((part) => part.text)
        .join("\n\n")
        .trim()
      const section = [
        `## ${role} · ${conversationLabel} · ${messageId}`,
        "",
        body || "_(No transferable visible content)_",
      ].join("\n")
      sections.push(section, "")
      selected.push({
        sourceSubChatId: conversation.subChatId,
        messageId,
        role,
        partIndexes: rendered.parts.map((part) => part.index),
        contentDigest: sha256(body),
        byteLength: Buffer.byteLength(body),
      })
    }
  }

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
): { parts: Array<{ index: number; text: string }> } {
  if (typeof message.content === "string") {
    if (containsSecret(message.content)) {
      addOmission(omissions, "secret-or-credential")
      return { parts: [] }
    }
    return { parts: message.content.trim() ? [{ index: 0, text: message.content }] : [] }
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
      if (type === "text") {
        const text = stringValue(part.text)
        if (!text) return []
        if (containsSecret(text) || hasSecretField(part)) {
          addOmission(omissions, "secret-or-credential")
          return []
        }
        return [{ index, text }]
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
        return visible.length ? [{ index, text: visible.join("\n") }] : []
      }
      if (type === "tool-call" || type.startsWith("tool-")) {
        addOmission(omissions, "hidden-tool-state")
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
