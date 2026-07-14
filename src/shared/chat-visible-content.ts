export type VisibleMessagePart = {
  partIndex: number
  partType: string
  text: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function visibleAnswers(value: unknown): string[] {
  const record = asRecord(value)
  if (!record) return []
  return Object.values(record)
    .flatMap((answer) => (Array.isArray(answer) ? answer : [answer]))
    .flatMap((answer) => {
      const text = nonEmptyString(answer)
      return text ? [text] : []
    })
}

function questionAndAnswerText(part: UnknownRecord): Array<{ partType: string; text: string }> {
  const input = asRecord(part.input)
  const questions = Array.isArray(input?.questions) ? input.questions : []
  const result = asRecord(part.result)
  const output = asRecord(part.output)
  const questionText = questions
    .flatMap((question) => {
      const text = nonEmptyString(asRecord(question)?.question)
      return text ? [text] : []
    })
    .join("\n")
  const answerText = visibleAnswers(result?.answers ?? output?.answers).join("\n")
  return [
    ...(questionText ? [{ partType: "agent-input-question", text: questionText }] : []),
    ...(answerText ? [{ partType: "agent-input-answer", text: answerText }] : []),
  ]
}

/**
 * Extract only content rendered as conversation text. Arbitrary tool payloads,
 * metadata, opaque fields, private prompts, and secret-shaped fields stay out.
 */
export function extractVisibleMessageParts(message: unknown): VisibleMessagePart[] {
  const record = asRecord(message)
  if (!record || !Array.isArray(record.parts)) return []

  return record.parts.flatMap((unknownPart, partIndex) => {
    const part = asRecord(unknownPart)
    if (!part) return []
    const type = nonEmptyString(part.type)
    if (!type) return []

    if (type === "text" || type === "reasoning") {
      const text = nonEmptyString(part.text)
      return text ? [{ partIndex, partType: type, text }] : []
    }
    if (type === "tool-ReasoningOutput" || type === "tool-Thinking") {
      const text = nonEmptyString(asRecord(part.input)?.text)
      return text ? [{ partIndex, partType: type, text }] : []
    }
    if (type === "tool-AskUserQuestion") {
      return questionAndAnswerText(part).map((entry) => ({ partIndex, ...entry }))
    }
    return []
  })
}

/** Format one part for a full-history handoff without dumping private payloads. */
export function formatVisiblePartForHandoff(partValue: unknown): string[] {
  const part = asRecord(partValue)
  if (!part) return []
  const type = nonEmptyString(part.type)
  if (!type) return []

  if (type === "text") {
    const text = nonEmptyString(part.text)
    return text ? [text] : []
  }
  if (type === "reasoning") {
    const text = nonEmptyString(part.text)
    return text ? [`> Reasoning: ${text}`] : []
  }
  if (type === "tool-ReasoningOutput" || type === "tool-Thinking") {
    const text = nonEmptyString(asRecord(part.input)?.text)
    return text ? [`> Reasoning: ${text}`] : []
  }
  if (type === "tool-AskUserQuestion") {
    return questionAndAnswerText(part).map((entry) =>
      entry.partType === "agent-input-question"
        ? `> Question: ${entry.text}`
        : `> Answer: ${entry.text}`,
    )
  }
  if (type === "tool-call" || type.startsWith("tool-")) {
    const name = nonEmptyString(part.toolName) ?? (type.replace(/^tool-/, "") || "tool")
    // Tool payloads are provider-defined and may place credentials in any field.
    // The tool name is the only stable, secret-safe handoff contract.
    return [`> Tool: ${name}`]
  }
  return []
}

const HIDDEN_FILE_CONTENT = Symbol("hidden-file-content")

function omitHiddenFileContent(value: unknown): unknown | typeof HIDDEN_FILE_CONTENT {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = omitHiddenFileContent(item)
      return sanitized === HIDDEN_FILE_CONTENT ? [] : [sanitized]
    })
  }
  const record = asRecord(value)
  if (!record) return value
  if (record.type === "file-content") return HIDDEN_FILE_CONTENT
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      const sanitized = omitHiddenFileContent(item)
      return sanitized === HIDDEN_FILE_CONTENT ? [] : [[key, sanitized]]
    }),
  )
}

/** Remove agent-only file payloads before render, clipboard, or JSON export. */
export function omitHiddenFileContentFromMessage<T>(message: T): T {
  const sanitized = omitHiddenFileContent(message)
  return (sanitized === HIDDEN_FILE_CONTENT ? null : sanitized) as T
}

export function stringifyVisibleMessageJson(message: unknown): string {
  return JSON.stringify(omitHiddenFileContentFromMessage(message), null, 2)
}
