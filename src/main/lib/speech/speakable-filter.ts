const SPOKEN_HEADING =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*Spoken[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*$/imu
const SECTION_HEADING =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:Displayed|Display|Details|Detail|Code|Commands?|Logs?|Output)[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*$/imu
const SEPARATOR_LINE = /^[ \t]*[=*_-]{3,}[ \t]*$/
const FENCED_BLOCK = /```[\s\S]*?```/g
const INLINE_CODE = /`([^`\n]{1,120})`/g
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/
const STACK_TRACE = /^\s*at\s+\S.*\([^)]+:\d+:\d+\)\s*$/
const LOG_LINE = /^\s*(?:\[[^\]]+\]\s*)?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i
const DIFF_LINE = /^\s*(?:diff --git|index [a-f0-9]|@@\s|[-+]{3}\s|[-+](?![-+]))/

export type SpeakableResult = {
  shouldSpeak: boolean
  text: string
  reason: "spoken_section" | "speakable_text" | "no_speakable_text"
  source: "spoken" | "prose" | "filtered"
}

export function filterSpeakableText(input: string): SpeakableResult {
  if (typeof input !== "string" || input.trim() === "") return skipResult()

  const spoken = extractSpokenSection(input)
  if (spoken !== null) {
    const text = styleSpokenText(normalizeSpeakableText(removeUnsafeBlocks(spoken)), {
      maxSentences: 0,
    })
    if (text) return { shouldSpeak: true, text, reason: "spoken_section", source: "spoken" }
    return skipResult()
  }

  const text = styleSpokenText(normalizeSpeakableText(removeUnsafeBlocks(input)))
  if (!isSpeakable(text)) return skipResult()
  return { shouldSpeak: true, text, reason: "speakable_text", source: "prose" }
}

export function extractSpokenSection(input: string): string | null {
  const match = SPOKEN_HEADING.exec(input)
  if (!match) return null
  const rest = input.slice(match.index + match[0].length)
  const nextSection = SECTION_HEADING.exec(rest)
  return (nextSection ? rest.slice(0, nextSection.index) : rest).trim()
}

export function styleSpokenText(input: string, options: { maxSentences?: number } = {}) {
  const maxSentences = Number.isInteger(options.maxSentences) ? options.maxSentences! : 3
  const text = input
    .replace(/\bHere is\b/gi, "Here's")
    .replace(/\bI have\b/g, "I've")
    .replace(/\bI am\b/g, "I'm")
    .replace(/\bI will\b/g, "I'll")
    .replace(/\bdo not\b/gi, "don't")
    .replace(/\bdoes not\b/gi, "doesn't")
    .replace(/\bcannot\b/gi, "can't")
    .replace(/\bwill not\b/gi, "won't")
    .replace(/\bshould not\b/gi, "shouldn't")
    .replace(/\bwould not\b/gi, "wouldn't")
    .replace(/\bcould not\b/gi, "couldn't")
    .replace(/\butilize\b/gi, "use")
    .replace(/\bapproximately\b/gi, "about")
    .replace(/\btherefore\b/gi, "so")
    .replace(/\bhowever\b/gi, "but")
    .replace(/\bcommence\b/gi, "start")
    .replace(/\bterminate\b/gi, "stop")
    .replace(/\bIn conclusion,\s*/gi, "")
    .replace(/\bTo summarize,\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()

  const trimmed = maxSentences > 0 ? keepFirstUsefulSentences(text, maxSentences) : text
  return trimmed.replace(/(^|[.!?]\s+)([a-z])/g, (_match, prefix, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`
  })
}

function skipResult(): SpeakableResult {
  return { shouldSpeak: false, text: "", reason: "no_speakable_text", source: "filtered" }
}

function removeUnsafeBlocks(input: string) {
  const lines = input.replace(FENCED_BLOCK, "\n").split(/\r?\n/)
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (isJsonBlockStart(line)) {
      index = skipJsonBlock(lines, index)
      continue
    }
    if (isLongBulletListAt(lines, index)) {
      index = skipLineRun(lines, index, (candidate) => BULLET.test(candidate))
      continue
    }
    if (!shouldSkipLine(line)) output.push(line)
  }

  return stripInlineMarkdown(output.join("\n").replace(INLINE_CODE, "$1"))
}

function stripInlineMarkdown(input: string) {
  return input
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\*\*|__/g, "")
    .replace(/~~/g, "")
    .replace(/\*/g, "")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, "$1$2")
}

function shouldSkipLine(line: string) {
  return (
    SEPARATOR_LINE.test(line) ||
    TABLE_SEPARATOR.test(line) ||
    TABLE_ROW.test(line) ||
    DIFF_LINE.test(line) ||
    LOG_LINE.test(line) ||
    STACK_TRACE.test(line) ||
    looksLikeJsonLine(line)
  )
}

function isLongBulletListAt(lines: string[], start: number) {
  if (!BULLET.test(lines[start] ?? "")) return false
  let count = 0
  for (let index = start; index < lines.length && BULLET.test(lines[index] ?? ""); index += 1) {
    count += 1
  }
  return count >= 6
}

function skipLineRun(lines: string[], start: number, predicate: (line: string) => boolean) {
  let index = start
  while (index + 1 < lines.length && predicate(lines[index + 1] ?? "")) index += 1
  return index
}

function isJsonBlockStart(line: string) {
  return /^\s*[{[]\s*$/.test(line)
}

function skipJsonBlock(lines: string[], start: number) {
  let depth = 0
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    depth += (line.match(/[{[]/g) || []).length
    depth -= (line.match(/[}\]]/g) || []).length
    if (depth <= 0 && index > start) return index
  }
  return start
}

function looksLikeJsonLine(line: string) {
  return /^\s*"[^"]+"\s*:/.test(line) || /^\s*[}\]],?\s*$/.test(line)
}

function normalizeSpeakableText(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function keepFirstUsefulSentences(input: string, limit: number) {
  const sentences = input.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(" ")
    .trim()
}

function isSpeakable(text: string) {
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return wordCount >= 4 && !/:\s*$/.test(text)
}
