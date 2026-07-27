import { dump, load } from "js-yaml"

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  content: string
}

const OPENING_DELIMITER = "---"
const CLOSING_DELIMITER = /^---[ \t]*(?:\r?\n|$)/m

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  if (!normalized.startsWith(OPENING_DELIMITER)) return { data: {}, content: normalized }

  const opening = /^---(?:\r?\n|$)/.exec(normalized)
  if (!opening) throw new Error("Only YAML frontmatter is supported")

  const remainder = normalized.slice(opening[0].length)
  const closing = CLOSING_DELIMITER.exec(remainder)
  if (!closing) throw new Error("Frontmatter closing delimiter is missing")

  const value = load(remainder.slice(0, closing.index))
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Frontmatter must be an object")
  }

  return {
    data: (value ?? {}) as Record<string, unknown>,
    content: remainder.slice(closing.index + closing[0].length),
  }
}

export function stringifyFrontmatter(content: string, metadata: Record<string, unknown>): string {
  const body = content.endsWith("\n") ? content : `${content}\n`
  return `---\n${dump(metadata, { lineWidth: -1, noRefs: true })}---\n${body}`
}
